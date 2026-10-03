import type { Canvas } from "fabric";
import { CUSTOM_PROPS } from "./diagram-meta";
import type { CanvasJSON } from "./diagramTypes";

export const STICKY_SIZE = 200;
export const STICKY_TEXT_WIDTH = 172;
export const STICKY_PADDING = 14;
export const DEFAULT_STICKY_COLOR = "#fef08a";

export const STICKY_COLORS = [
	"#fef08a",
	"#fecdd3",
	"#bbf7d0",
	"#bfdbfe",
	"#fed7aa",
	"#e9d5ff",
];

export const PALETTE_COLORS = [
	"#000000",
	"#e53e3e",
	"#dd6b20",
	"#d69e2e",
	"#38a169",
	"#3182ce",
	"#805ad5",
	"#d53f8c",
	"#718096",
	"#ffffff",
];

export const STROKE_WIDTHS = [1, 2, 3, 5, 8];

/** Eraser nib diameters, in canvas pixels. */
export const ERASER_SIZES = [4, 8, 12, 20, 32, 48];

/** Default eraser nib diameter. */
export const DEFAULT_ERASER_SIZE = 12;

export const FONT_FAMILIES = [
	{ value: "Inter", label: "Inter" },
	{ value: "Georgia", label: "Georgia" },
	{ value: "Courier New", label: "Courier New" },
];

export const DEFAULT_FONT_FAMILY = "Inter";

/** Shapes smaller than this (in px) are treated as accidental clicks. */
export const MIN_SHAPE_SIZE = 5;

/** Undo stack depth. */
export const HISTORY_LIMIT = 50;

/** Coalesce rapid edits (drags, strokes) into one undo entry. */
export const HISTORY_DEBOUNCE_MS = 300;

/** Give up waiting for webfonts rather than blocking object creation. */
export const FONT_LOAD_TIMEOUT = 3000;

export const LIGHT_BACKGROUND = "#ffffff";
export const DARK_BACKGROUND = "#1a1a1a";

/** Selection/toolbar accent, shared by the canvas chrome and the CSS theme. */
export const ACCENT_COLOR = "#5b5bd6";

export function backgroundFor(darkMode: boolean): string {
	return darkMode ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

export function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function snapshotCanvas(canvas: Canvas): string {
	return JSON.stringify(canvas.toObject(CUSTOM_PROPS));
}

export function canvasToJSON(canvas: Canvas): CanvasJSON {
	return canvas.toObject(CUSTOM_PROPS) as CanvasJSON;
}

export function hexToRgba(hex: string, alpha: number): string {
	const normalized = hex.replace("#", "");
	const full =
		normalized.length === 3
			? normalized
					.split("")
					.map((c) => c + c)
					.join("")
			: normalized;
	const r = parseInt(full.slice(0, 2), 16);
	const g = parseInt(full.slice(2, 4), 16);
	const b = parseInt(full.slice(4, 6), 16);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
	return `rgba(${r},${g},${b},${alpha})`;
}
