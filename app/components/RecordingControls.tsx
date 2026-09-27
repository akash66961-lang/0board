"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FabricCanvasAPI } from "./FabricCanvas";

type RecordingState = "idle" | "recording" | "paused";

interface RecordingControlsProps {
	canvasRef: React.RefObject<FabricCanvasAPI | null>;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function RecordingControls({ canvasRef }: RecordingControlsProps) {
	const [state, setState] = useState<RecordingState>("idle");
	const [elapsed, setElapsed] = useState(0);
	const [error, setError] = useState<string | null>(null);

	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const rafRef = useRef<number>(0);
	const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const cursorRef = useRef<{ x: number; y: number } | null>(null);
	const stateRef = useRef<RecordingState>("idle");
	const isCompositingRef = useRef(false);

	const updateState = useCallback((newState: RecordingState) => {
		stateRef.current = newState;
		setState(newState);
	}, []);

	const stopTimer = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const startTimer = useCallback(() => {
		stopTimer();
		timerRef.current = setInterval(() => {
			setElapsed((e) => e + 1);
		}, 1000);
	}, [stopTimer]);

	const stopCompositing = useCallback(() => {
		isCompositingRef.current = false;
		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = 0;
		}
	}, []);

	const startCompositing = useCallback(() => {
		const composite = compositeCanvasRef.current;
		if (!composite) return;

		const ctx = composite.getContext("2d");
		if (!ctx) return;

		isCompositingRef.current = true;

		const render = () => {
			if (!isCompositingRef.current) return;

			const fabricCanvas = canvasRef.current?.getCanvasElement();
			if (fabricCanvas) {
				ctx.drawImage(fabricCanvas, 0, 0);
			}

			const cursor = cursorRef.current;
			if (cursor) {
				ctx.beginPath();
				ctx.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2);
				ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
				ctx.fill();
				ctx.strokeStyle = "#fff";
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			rafRef.current = requestAnimationFrame(render);
		};

		render();
	}, [canvasRef]);

	const startRecording = useCallback(async () => {
		setError(null);
		const canvas = canvasRef.current;
		if (!canvas) {
			setError("Canvas not ready");
			return;
		}

		try {
			const canvasEl = canvas.getCanvasElement();
			if (!canvasEl) {
				setError("Canvas not ready");
				return;
			}

			const rect = canvasEl.getBoundingClientRect();
			const composite = document.createElement("canvas");
			composite.width = canvasEl.width;
			composite.height = canvasEl.height;
			compositeCanvasRef.current = composite;

			const videoStream = composite.captureStream(30);

			let audioStream: MediaStream | null = null;
			try {
				audioStream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});
			} catch {
				// Continue without audio if mic access denied
			}

			const tracks = [
				...videoStream.getVideoTracks(),
				...(audioStream ? audioStream.getAudioTracks() : []),
			];
			const combinedStream = new MediaStream(tracks);

			const mimeType = MediaRecorder.isTypeSupported(
				"video/webm;codecs=vp9",
			)
				? "video/webm;codecs=vp9"
				: "video/webm";

			const recorder = new MediaRecorder(combinedStream, {
				mimeType,
				videoBitsPerSecond: 2_500_000,
				audioBitsPerSecond: 128_000,
			});

			chunksRef.current = [];
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};

			recorder.onstop = async () => {
				stopTimer();
				stopCompositing();
				const blob = new Blob(chunksRef.current, { type: mimeType });
				const filename = `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;

				try {
					const formData = new FormData();
					formData.append("video", blob, filename);

					await fetch("/api/recordings", {
						method: "POST",
						body: formData,
					});
				} catch {
					setError("Failed to save recording");
				}

				streamRef.current?.getTracks().forEach((t) => t.stop());
				streamRef.current = null;
				mediaRecorderRef.current = null;
				compositeCanvasRef.current = null;
				cursorRef.current = null;
				updateState("idle");
				setElapsed(0);
			};

			const handleMouseMove = (e: MouseEvent) => {
				const bounds = canvasEl.getBoundingClientRect();
				const scaleX = canvasEl.width / bounds.width;
				const scaleY = canvasEl.height / bounds.height;
				cursorRef.current = {
					x: (e.clientX - bounds.left) * scaleX,
					y: (e.clientY - bounds.top) * scaleY,
				};
			};

			canvasEl.addEventListener("mousemove", handleMouseMove);

			mediaRecorderRef.current = recorder;
			streamRef.current = combinedStream;
			recorder.start(1000);
			startCompositing();
			startTimer();
			updateState("recording");

			const originalOnStop = recorder.onstop;
			recorder.onstop = (event) => {
				canvasEl.removeEventListener("mousemove", handleMouseMove);
				originalOnStop?.call(recorder, event);
			};
		} catch {
			setError("Failed to start recording");
		}
	}, [canvasRef, startTimer, stopTimer, startCompositing, stopCompositing, updateState]);

	const pauseRecording = useCallback(() => {
		const recorder = mediaRecorderRef.current;
		if (!recorder) return;

		const currentState = stateRef.current;

		if (currentState === "recording") {
			stopCompositing();
			stopTimer();
			updateState("paused");
		} else if (currentState === "paused") {
			startCompositing();
			startTimer();
			updateState("recording");
		}
	}, [startTimer, stopTimer, startCompositing, stopCompositing, updateState]);

	const stopRecording = useCallback(() => {
		const recorder = mediaRecorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
		}
	}, []);

	useEffect(() => {
		return () => {
			stopTimer();
			stopCompositing();
			if (mediaRecorderRef.current?.state !== "inactive") {
				mediaRecorderRef.current?.stop();
			}
			streamRef.current?.getTracks().forEach((t) => t.stop());
		};
	}, [stopTimer, stopCompositing]);

	if (state === "idle" && !error) {
		return (
			<div className="recording-controls">
				<button
					type="button"
					className="recording-btn recording-start"
					onClick={startRecording}
				>
					● Record
				</button>
			</div>
		);
	}

	return (
		<div className="recording-controls">
			<div className="recording-status">
				<span
					className={`recording-dot ${state === "paused" ? "paused" : ""}`}
				/>
				<span className="recording-timer">{formatTime(elapsed)}</span>
			</div>
			{state !== "idle" && (
				<>
					<button
						type="button"
						className="recording-btn"
						onClick={pauseRecording}
					>
						{state === "paused" ? "▶ Resume" : "⏸ Pause"}
					</button>
					<button
						type="button"
						className="recording-btn recording-stop"
						onClick={stopRecording}
					>
						■ Stop
					</button>
				</>
			)}
			{error && <span className="recording-error">{error}</span>}
		</div>
	);
}
