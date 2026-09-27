import Link from "next/link";

export default function Home() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-black">
			<div className="flex flex-col items-center gap-8">
				<h1 className="text-4xl font-light tracking-tight text-black dark:text-white">
					0board
				</h1>
				<div className="flex gap-4">
					<Link
						href="/whiteboard"
						className="rounded-lg border border-black px-8 py-3 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
					>
						whiteboard
					</Link>
					<Link
						href="/recordings"
						className="rounded-lg border border-black px-8 py-3 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
					>
						recordings
					</Link>
				</div>
			</div>
		</main>
	);
}
