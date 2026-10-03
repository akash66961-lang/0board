/**
 * Recordings storage, backed by the browser's IndexedDB.
 *
 * A server route cannot work on a host like Vercel: serverless instances have
 * an ephemeral, read-only filesystem, so files dropped into `public/` vanish
 * between invocations and can never be listed again. Keeping the videos in
 * IndexedDB sidesteps servers entirely — no upload, no storage bucket, no
 * per-user auth — at the documented cost that recordings belong to the browser
 * and device that captured them.
 *
 * Only metadata leaves this module; the Blobs stay in the database until
 * `readRecording` asks for one, so listing the gallery never loads video data.
 */

const DB_NAME = "0board";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

/** A stored recording's metadata, safe to serialize into component state. */
export interface RecordingInfo {
	/** Stable identity, independent of the display filename. */
	id: string;
	filename: string;
	size: number;
	createdAt: string;
}

interface StoredRecording extends RecordingInfo {
	blob: Blob;
}

/** Strip the video out of a stored record so listings stay lightweight. */
function toInfo({ id, filename, size, createdAt }: StoredRecording): RecordingInfo {
	return { id, filename, size, createdAt };
}

/** One IndexedDB transaction wrapped in a promise. */
function run<T>(
	mode: IDBTransactionMode,
	action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
	return openDatabase().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				let result: T;
				const succeed = () => {
					db.close();
					resolve(result);
				};
				try {
					const transaction = db.transaction(STORE_NAME, mode);
					const fail = () => {
						db.close();
						reject(transaction.error ?? new Error("Recording storage failed"));
					};
					transaction.oncomplete = succeed;
					transaction.onerror = fail;
					transaction.onabort = fail;
					const request = action(transaction.objectStore(STORE_NAME));
					request.onsuccess = () => {
						result = request.result as T;
					};
				} catch (error) {
					db.close();
					reject(error);
				}
			}),
	);
}

function openDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === "undefined") {
		return Promise.reject(new Error("This browser has no IndexedDB"));
	}
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("Could not open recording storage"));
		request.onblocked = () =>
			reject(new Error("Recording storage is blocked by another tab"));
	});
}

/**
 * Store one finished recording and return its metadata.
 *
 * The blob is written in the same transaction as its metadata, so a recording
 * can never be listed without the video behind it.
 */
export async function saveRecording(
	blob: Blob,
	filename: string,
): Promise<RecordingInfo> {
	const record: StoredRecording = {
		id: crypto.randomUUID(),
		filename,
		size: blob.size,
		createdAt: new Date().toISOString(),
		blob,
	};
	await run<void>("readwrite", (store) => store.put(record));
	return toInfo(record);
}

/** Newest-first metadata for the gallery; no video data is read. */
export async function listRecordings(): Promise<RecordingInfo[]> {
	const records = await run<StoredRecording[]>("readonly", (store) =>
		store.getAll(),
	);
	return records
		.map(toInfo)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The video for one recording, or null when it has since been deleted. */
export async function readRecording(id: string): Promise<Blob | null> {
	const record = await run<StoredRecording | undefined>("readonly", (store) =>
		store.get(id),
	);
	return record?.blob ?? null;
}

/** Drop one recording and its video together. */
export async function deleteRecording(id: string): Promise<void> {
	await run<void>("readwrite", (store) => store.delete(id));
}
