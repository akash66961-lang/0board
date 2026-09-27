import { readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RECORDINGS_DIR = path.join(process.cwd(), "public", "recordings");

interface RecordingInfo {
	filename: string;
	url: string;
	size: number;
	createdAt: string;
}

export async function GET() {
	try {
		await mkdir(RECORDINGS_DIR, { recursive: true });
		const files = await readdir(RECORDINGS_DIR);
		const webmFiles = files.filter((f) => f.endsWith(".webm"));

		const recordings: RecordingInfo[] = await Promise.all(
			webmFiles.map(async (filename) => {
				const filePath = path.join(RECORDINGS_DIR, filename);
				const stats = await import("fs").then((fs) => fs.promises.stat(filePath));
				return {
					filename,
					url: `/recordings/${filename}`,
					size: stats.size,
					createdAt: stats.birthtime.toISOString(),
				};
			}),
		);

		recordings.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);

		return NextResponse.json(recordings);
	} catch {
		return NextResponse.json([]);
	}
}

export async function POST(request: Request) {
	try {
		const formData = await request.formData();
		const file = formData.get("video");

		if (!file || !(file instanceof File)) {
			return NextResponse.json(
				{ error: "No video file provided" },
				{ status: 400 },
			);
		}

		await mkdir(RECORDINGS_DIR, { recursive: true });

		const buffer = Buffer.from(await file.arrayBuffer());
		const filePath = path.join(RECORDINGS_DIR, file.name);
		await writeFile(filePath, buffer);

		return NextResponse.json({ success: true, filename: file.name });
	} catch {
		return NextResponse.json(
			{ error: "Failed to save recording" },
			{ status: 500 },
		);
	}
}
