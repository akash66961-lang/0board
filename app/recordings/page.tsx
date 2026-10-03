"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
	deleteRecording,
	listRecordings,
	readRecording,
	type RecordingInfo,
} from "../lib/recordings/recordingsDb";

/** Metadata plus a playable blob URL for one stored recording. */
interface RecordingEntry extends RecordingInfo {
	url: string;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString();
}

export default function RecordingsPage() {
	const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
	const [loading, setLoading] = useState(true);
	// Object URLs are handles into blob memory, so every one handed out is
	// tracked here to be revoked when the list is rebuilt or the page unmounts.
	const urlsRef = useRef<string[]>([]);

	const refresh = useCallback(async () => {
		try {
			const metas = await listRecordings();
			const entries: RecordingEntry[] = [];
			for (const meta of metas) {
				const blob = await readRecording(meta.id);
				if (blob) entries.push({ ...meta, url: URL.createObjectURL(blob) });
			}
			for (const url of urlsRef.current) URL.revokeObjectURL(url);
			urlsRef.current = entries.map((entry) => entry.url);
			setRecordings(entries);
		} catch {
			setRecordings([]);
		} finally {
			setLoading(false);
		}
	}, []);

	// Data fetching on mount: state updates happen after the await, never
	// synchronously during render, so there is no cascading render here.
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void refresh();
		return () => {
			for (const url of urlsRef.current) URL.revokeObjectURL(url);
		};
	}, [refresh]);

	const remove = useCallback(
		async (id: string) => {
			try {
				await deleteRecording(id);
			} catch {
				return;
			}
			await refresh();
		},
		[refresh],
	);

	return (
		<main className="min-h-screen bg-white p-8 dark:bg-black">
			<div className="mx-auto max-w-5xl">
				<div className="mb-8 flex items-center justify-between">
					<h1 className="text-2xl font-light text-black dark:text-white">
						Recordings
					</h1>
					<div className="flex gap-3">
						<button
							type="button"
							onClick={refresh}
							className="rounded border border-black px-4 py-2 text-sm text-black transition-colors hover:bg-black hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
						>
							Refresh
						</button>
						<Link
							href="/whiteboard"
							className="rounded border border-black px-4 py-2 text-sm text-black transition-colors hover:bg-black hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
						>
							← Whiteboard
						</Link>
					</div>
				</div>

				{loading ? (
					<p className="text-sm text-neutral-500">Loading...</p>
				) : recordings.length === 0 ? (
					<p className="text-sm text-neutral-500">
						No recordings yet. Start recording from the whiteboard.
					</p>
				) : (
					<div className="grid gap-4">
						{recordings.map((rec) => (
							<div
								key={rec.id}
								className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
							>
								<video
									src={rec.url}
									controls
									className="mb-3 w-full rounded"
									preload="metadata"
								/>
								<div className="flex items-center justify-between text-xs text-neutral-500">
									<span>{formatDate(rec.createdAt)}</span>
									<div className="flex items-center gap-4">
										<span>{formatSize(rec.size)}</span>
										<button
											type="button"
											onClick={() => void remove(rec.id)}
											className="text-neutral-400 transition-colors hover:text-red-500"
										>
											Delete
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}

				{!loading && recordings.length > 0 && (
					<p className="mt-6 text-xs text-neutral-400">
						Recordings are stored in this browser only — they are not uploaded
						anywhere.
					</p>
				)}
			</div>
		</main>
	);
}
