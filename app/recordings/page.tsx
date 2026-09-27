"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Recording {
	filename: string;
	url: string;
	size: number;
	createdAt: string;
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
	const [recordings, setRecordings] = useState<Recording[]>([]);
	const [loading, setLoading] = useState(true);

	const fetchRecordings = useCallback(async () => {
		try {
			const res = await fetch("/api/recordings");
			const data = await res.json();
			setRecordings(data);
		} catch {
			setRecordings([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchRecordings();
	}, [fetchRecordings]);

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
							onClick={fetchRecordings}
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
								key={rec.filename}
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
									<span>{formatSize(rec.size)}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</main>
	);
}
