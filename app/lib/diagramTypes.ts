import type { Canvas } from "fabric";

export type Tool =
	| "select"
	| "draw"
	| "highlighter"
	| "rect"
	| "circle"
	| "line"
	| "arrow"
	| "text"
	| "sticky"
	| "eraser";

export type CanvasJSON = ReturnType<Canvas["toJSON"]>;

/** Imperative surface the whiteboard page drives the canvas through. */
export interface FabricCanvasAPI {
	getJSON: () => Record<string, unknown>;
	undo: () => void;
	redo: () => void;
	clear: () => void;
	/** Delete the selection together with every linked part of it. */
	deleteSelection: () => void;
	flushEditing: () => void;
	isLoading: () => boolean;
	snapshotImage: () => string | null;
	capturePage: (json: Record<string, unknown>) => Promise<string | null>;
	getCanvasElement: () => HTMLCanvasElement | null;
}

export interface Point {
	x: number;
	y: number;
}
