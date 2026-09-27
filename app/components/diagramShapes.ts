"use client";

import {
	Canvas,
	Circle,
	FabricObject,
	Group,
	Line,
	Polyline,
	Rect,
	Textbox,
	Triangle,
} from "fabric";

/** Custom props that must survive toJSON (page save, undo/redo). */
export const CUSTOM_PROPS = [
	"arrowId",
	"handleFor",
	"arrowRole",
	"pointIndex",
	"isSticky",
	"stickyColor",
	"stickyPart",
];

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

export function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function snapshotCanvas(canvas: Canvas): string {
	return JSON.stringify(canvas.toObject(CUSTOM_PROPS));
}

export function canvasToJSON(canvas: Canvas): Record<string, unknown> {
	return canvas.toObject(CUSTOM_PROPS) as unknown as Record<string, unknown>;
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

/** Round, high-visibility resize/rotate handles on every selectable object. */
export function applyControlStyle(obj: FabricObject): void {
	const anyObj = obj as unknown as Record<string, unknown>;
	if (anyObj["handleFor"]) return;
	obj.set({
		transparentCorners: false,
		cornerSize: 10,
		cornerColor: "#ffffff",
		cornerStrokeColor: "#5b5bd6",
		cornerStyle: "circle",
		borderColor: "#5b5bd6",
		borderScaleFactor: 2,
		padding: 4,
	});
}

export function styleCanvasObjects(canvas: Canvas): void {
	for (const obj of canvas.getObjects()) {
		applyControlStyle(obj);
	}
}

export interface ArrowGeom {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	bend: number;
}

export function arrowMidpoint(geom: ArrowGeom): { x: number; y: number } {
	const mx = (geom.x1 + geom.x2) / 2;
	const my = (geom.y1 + geom.y2) / 2;
	const dx = geom.x2 - geom.x1;
	const dy = geom.y2 - geom.y1;
	const len = Math.hypot(dx, dy) || 1;
	return {
		x: mx + (-dy / len) * geom.bend,
		y: my + (dx / len) * geom.bend,
	};
}

export interface ArrowStyle {
	stroke: string;
	strokeWidth: number;
}

export type ArrowPartRole = "shaft" | "head";

/** Position an arrowhead so its tip (not center) lands on the endpoint. */
export function placeHead(
	head: Triangle,
	x2: number,
	y2: number,
	fromX: number,
	fromY: number,
	headSize: number,
): void {
	const angle = (Math.atan2(y2 - fromY, x2 - fromX) * 180) / Math.PI;
	const rad = (angle * Math.PI) / 180;
	head.set({
		left: x2 - Math.cos(rad) * (headSize / 2),
		top: y2 - Math.sin(rad) * (headSize / 2),
		angle: angle + 90,
	});
	head.setCoords();
}

export interface ArrowPoint {
	x: number;
	y: number;
}

export interface CreatedArrow {
	shaft: Polyline;
	head: Triangle;
	dots: Circle[];
}

/**
 * Excalidraw-style arrow: one polyline shaft through draggable points
 * (start/mid/end) plus a head. All parts share absolute coordinates, so
 * bending edits points in place and moving drags every part by delta.
 */
export function createArrowParts(
	geom: ArrowGeom,
	style: ArrowStyle,
	arrowId: string,
): CreatedArrow {
	return buildArrowFromPoints(
		{ x: geom.x1, y: geom.y1 },
		arrowMidpoint(geom),
		{ x: geom.x2, y: geom.y2 },
		style,
		arrowId,
	);
}

export function buildArrowFromPoints(
	start: ArrowPoint,
	mid: ArrowPoint,
	end: ArrowPoint,
	style: ArrowStyle,
	arrowId: string,
): CreatedArrow {
	const shaft = new Polyline([start, mid, end], {
		stroke: style.stroke,
		strokeWidth: style.strokeWidth,
		fill: "",
		strokeLineCap: "round",
		strokeLineJoin: "round",
		selectable: true,
		lockScalingX: true,
		lockScalingY: true,
		lockRotation: true,
		arrowId,
		arrowRole: "shaft",
	} as unknown as Record<string, unknown>);
	applyControlStyle(shaft);
	const headSize = 10 + style.strokeWidth * 2;
	const head = new Triangle({
		width: headSize,
		height: headSize,
		fill: style.stroke,
		selectable: true,
		lockScalingX: true,
		lockScalingY: true,
		lockRotation: true,
		originX: "center",
		originY: "center",
		arrowId,
		arrowRole: "head",
	} as unknown as Record<string, unknown>);
	placeHead(head, end.x, end.y, mid.x, mid.y, headSize);
	applyControlStyle(head);
	const dots = [start, mid, end].map((p, i) =>
		createArrowDot(p, arrowId, i),
	);
	return { shaft, head, dots };
}

export function createArrowDot(
	p: ArrowPoint,
	arrowId: string,
	index: number,
): Circle {
	const isMid = index === 1;
	return new Circle({
		radius: isMid ? 7 : 5,
		fill: isMid ? "#5b5bd6" : "#ffffff",
		stroke: isMid ? "#ffffff" : "#5b5bd6",
		strokeWidth: 2,
		left: p.x,
		top: p.y,
		originX: "center",
		originY: "center",
		hasControls: false,
		hasBorders: false,
		selectable: true,
		evented: true,
		lockScalingX: true,
		lockScalingY: true,
		lockRotation: true,
		excludeFromExport: true,
		visible: false,
		hoverCursor: isMid ? "grab" : "move",
		arrowId,
		pointIndex: index,
	} as unknown as Record<string, unknown>);
}

/** Re-aim shaft + head from the live dot positions (rubber-band, no snap). */
export function reshapeArrow(
	shaft: Polyline,
	head: Triangle,
	dots: Circle[],
): void {
	const ordered = [...dots].sort(
		(a, b) =>
			((a as unknown as Record<string, unknown>)["pointIndex"] as number) -
			((b as unknown as Record<string, unknown>)["pointIndex"] as number),
	);
	const pts = ordered.map((d) => ({ x: d.left ?? 0, y: d.top ?? 0 }));
	shaft.set({ points: pts });
	shaft.setCoords();
	const mid = pts[1] ?? pts[0];
	const end = pts[pts.length - 1] ?? mid;
	placeHead(head, end.x, end.y, mid.x, mid.y, (head.width ?? 14));
}

export function findArrowParts(
	canvas: Canvas,
	arrowId: string,
): { shaft?: Polyline; head?: Triangle; dots: Circle[] } {
	const matches = canvas
		.getObjects()
		.filter(
			(o) => (o as unknown as Record<string, unknown>)["arrowId"] === arrowId,
		);
	const roleOf = (o: FabricObject) =>
		(o as unknown as Record<string, unknown>)["arrowRole"];
	return {
		shaft: matches.find((o) => roleOf(o) === "shaft") as
			| Polyline
			| undefined,
		head: matches.find((o) => roleOf(o) === "head") as Triangle | undefined,
		dots: matches.filter(
			(o) =>
				typeof (o as unknown as Record<string, unknown>)["pointIndex"] ===
				"number",
		) as Circle[],
	};
}

/** Convert previous-generation arrows (segment pairs + pivot) to point dots. */
export function migrateLegacyArrows(canvas: Canvas): void {
	const byId = new Map<string, FabricObject[]>();
	for (const o of canvas.getObjects()) {
		const r = o as unknown as Record<string, unknown>;
		if (
			typeof r["arrowId"] === "string" &&
			(r["arrowRole"] === "shaft1" || r["arrowRole"] === "shaft2")
		) {
			const arr = byId.get(r["arrowId"] as string) ?? [];
			arr.push(o);
			byId.set(r["arrowId"] as string, arr);
		}
	}
	for (const [id, parts] of byId) {
		const roleOf = (o: FabricObject) =>
			(o as unknown as Record<string, unknown>)["arrowRole"];
		const s1 = parts.find((p) => roleOf(p) === "shaft1") as Line | undefined;
		const s2 = parts.find((p) => roleOf(p) === "shaft2") as Line | undefined;
		if (!s1 || !s2) continue;
		const start = { x: s1.x1 ?? 0, y: s1.y1 ?? 0 };
		const mid = { x: s1.x2 ?? 0, y: s1.y2 ?? 0 };
		const end = { x: s2.x2 ?? 0, y: s2.y2 ?? 0 };
		const style = {
			stroke: (s1.stroke as string) ?? "#000000",
			strokeWidth: s1.strokeWidth ?? 2,
		};
		for (const o of canvas.getObjects()) {
			const r = o as unknown as Record<string, unknown>;
			if (r["arrowId"] === id || r["handleFor"] === id) canvas.remove(o);
		}
		const { shaft, head, dots } = buildArrowFromPoints(
			start,
			mid,
			end,
			style,
			id,
		);
		canvas.add(shaft, head, ...dots);
	}
	for (const o of [...canvas.getObjects()]) {
		const r = o as unknown as Record<string, unknown>;
		if (typeof r["handleFor"] === "string") canvas.remove(o);
	}
}

export interface StickyFont {
	family: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string;
}

/**
 * Fixed-size sticky note as two linked top-level objects: a background rect
 * (the fixed 200x200 look) plus an editable textbox. Dragging either moves
 * both; the textbox edits natively (double-click), no ungroup dance needed.
 */
export function createStickyNote(
	x: number,
	y: number,
	color: string,
	font: StickyFont,
): { bg: Rect; text: Textbox; id: string } {
	const id = uid();
	const bg = new Rect({
		left: x,
		top: y,
		width: STICKY_SIZE,
		height: STICKY_SIZE,
		fill: color,
		stroke: "rgba(0,0,0,0.08)",
		strokeWidth: 1,
		rx: 4,
		ry: 4,
		originX: "left",
		originY: "top",
		selectable: true,
		evented: true,
		hasControls: false,
		hasBorders: false,
		stickyPart: id,
	} as unknown as Record<string, unknown>);
	const text = new Textbox("Note", {
		left: x + STICKY_PADDING,
		top: y + STICKY_PADDING,
		width: STICKY_TEXT_WIDTH,
		fontSize: 14,
		fontFamily: font.family,
		fill: "#1f2937",
		editable: true,
		fontWeight: font.bold ? "bold" : "normal",
		fontStyle: font.italic ? "italic" : "normal",
		underline: font.underline,
		textAlign: "left",
		originX: "left",
		originY: "top",
		selectable: true,
		evented: true,
		stickyPart: id,
	} as unknown as Record<string, unknown>);
	applyControlStyle(text);
	return { bg, text, id };
}

/** Grow a note's background as its text gets longer. */
export function wireStickyGrow(
	canvas: Canvas,
	text: Textbox,
	stickyId: string,
): void {
	const rec = text as unknown as Record<string, unknown>;
	if (rec["__growWired"]) return;
	rec["__growWired"] = true;
	text.on("changed", () => {
		const bg = findStickyParts(canvas, stickyId).find((p) => p.type === "rect");
		if (!bg) return;
		const needH = Math.max(STICKY_SIZE, (text.height ?? 0) + STICKY_PADDING * 2);
		if (Math.abs((bg.height ?? 0) - needH) > 1) {
			bg.set({ height: needH });
			bg.setCoords();
			canvas.renderAll();
		}
	});
}

/**
 * Convert legacy group-based stickies (fixed previous bug: uneditable text)
 * into linked parts, then wire text growth on every note textbox.
 */
export function migrateAndWireStickies(canvas: Canvas): void {
	for (const o of [...canvas.getObjects()]) {
		const rec = o as unknown as Record<string, unknown>;
		if (
			rec["isSticky"] === true &&
			typeof (o as unknown as Group).getObjects === "function"
		) {
			const group = o as unknown as Group;
			const positioned = [...group.getObjects()].map((k) => ({
				k,
				c: k.getCenterPoint(),
			}));
			canvas.remove(group);
			for (const { k, c } of positioned) {
				k.setPositionByOrigin(c, "center", "center");
				k.setCoords();
				if (k.type === "rect") {
					k.set({
						selectable: true,
						evented: true,
						hasControls: false,
						hasBorders: false,
					});
				} else {
					k.set({ selectable: true, evented: true });
					applyControlStyle(k);
				}
				canvas.add(k);
			}
		}
	}
	for (const o of canvas.getObjects()) {
		const rec = o as unknown as Record<string, unknown>;
		if (
			typeof rec["stickyPart"] === "string" &&
			((o as FabricObject).type ?? "").includes("text")
		) {
			wireStickyGrow(canvas, o as Textbox, rec["stickyPart"] as string);
		}
		if (typeof rec["handleFor"] === "string") {
			o.set({ visible: false });
		}
	}
	canvas.renderAll();
}

/** CSS cursor value showing an eraser glyph over the canvas. */
export function eraserCursor(): string {
	const svg =
		"<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='%23ffffff' stroke='%23111111' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/></svg>";
	return `url("data:image/svg+xml,${svg}") 4 20, pointer`;
}

export function findStickyParts(canvas: Canvas, id: string): FabricObject[] {
	return canvas
		.getObjects()
		.filter(
			(o) => (o as unknown as Record<string, unknown>)["stickyPart"] === id,
		);
}
