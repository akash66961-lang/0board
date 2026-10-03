/**
 * Pure undo/redo stacks for the canvas. Snapshots are opaque JSON strings:
 * pushing records the present, undo/redo hand back the snapshot the caller
 * must render. Keeping the bookkeeping free of Fabric lets the off-by-one
 * rules (why an empty redo stack blocks redo, why one entry cannot be undone)
 * live in one small, tested place.
 */
export interface HistoryStack {
	/** Oldest first; the last entry is the current state. */
	undoStack: string[];
	redoStack: string[];
	/** Maximum number of undo entries kept. */
	limit: number;
}

export function createHistory(limit: number): HistoryStack {
	return { undoStack: [], redoStack: [], limit };
}

/**
 * Record the current state. Any pending redo branch is discarded: editing
 * after an undo makes the undone future unreachable, as in every editor.
 * The oldest entry is dropped once the depth limit is reached.
 */
export function pushHistory(history: HistoryStack, snapshot: string): void {
	history.undoStack.push(snapshot);
	history.redoStack.length = 0;
	if (history.undoStack.length > history.limit) {
		history.undoStack.shift();
	}
}

/** Step back and return the snapshot to render, or null at the bottom. */
export function undoHistory(history: HistoryStack): string | null {
	if (history.undoStack.length <= 1) return null;
	const current = history.undoStack.pop();
	if (current === undefined) return null;
	history.redoStack.push(current);
	return history.undoStack[history.undoStack.length - 1] ?? null;
}

/** Step forward and return the snapshot to render, or null at the top. */
export function redoHistory(history: HistoryStack): string | null {
	const next = history.redoStack.pop();
	if (next === undefined) return null;
	history.undoStack.push(next);
	return next;
}

/** True when at least one entry above the base state exists. */
export function canUndo(history: HistoryStack): boolean {
	return history.undoStack.length > 1;
}

/** True when a step forward is available. */
export function canRedo(history: HistoryStack): boolean {
	return history.redoStack.length > 0;
}

/** Forget both branches (page switch, fresh load). */
export function resetHistory(history: HistoryStack): void {
	history.undoStack.length = 0;
	history.redoStack.length = 0;
}
