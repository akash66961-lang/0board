import { Circle, Line, type Canvas, type FabricObject, Polyline, Triangle } from "fabric";
import { applyControlStyle } from "./canvasState";
import { meta } from "./diagram-meta";
import { ACCENT_COLOR } from "./diagramConstants";

/**
 * Arrows are stored as several top-level Fabric objects that share an
 * `arrowId`: one polyline shaft through three draggable points, a head, and the
 * point dots. All parts keep absolute coordinates so bending edits points in
 * place and moving drags every part by the same delta.
 */

export interface ArrowGeom {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	bend: number;
}

export interface ArrowPoint {
	x: number;
	y: number;
}

export interface ArrowStyle {
	stroke: string;
	strokeWidth: number;
}

export interface CreatedArrow {
	shaft: Polyline;
	head: Triangle;
	dots: Circle[];
}

export function arrowMidpoint(geom: ArrowGeom): ArrowPoint {
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

/** Position an arrowhead so its tip, not its centre, lands on the endpoint. */
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

/** Arrowhead size for a given shaft thickness. */
export function headSizeFor(strokeWidth: number): number {
	return 10 + strokeWidth * 2;
}

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
		// Reshaping happens through the dots, so scale/rotate handles would
		// only offer transformations the arrow does not support.
		hasControls: false,
		lockScalingX: true,
		lockScalingY: true,
		lockRotation: true,
		arrowId,
		arrowRole: "shaft",
	} as unknown as Record<string, unknown>);
	applyControlStyle(shaft);

	const headSize = headSizeFor(style.strokeWidth);
	const head = new Triangle({
		width: headSize,
		height: headSize,
		fill: style.stroke,
		selectable: true,
		hasControls: false,
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

	const dots = [start, mid, end].map((p, i) => createArrowDot(p, arrowId, i));
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
		fill: isMid ? ACCENT_COLOR : "#ffffff",
		stroke: isMid ? "#ffffff" : ACCENT_COLOR,
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

/** Re-aim shaft and head from the live dot positions (rubber-band, no snap). */
export function reshapeArrow(
	shaft: Polyline,
	head: Triangle,
	dots: Circle[],
): void {
	const ordered = [...dots].sort(
		(a, b) => (meta(a).pointIndex ?? 0) - (meta(b).pointIndex ?? 0),
	);
	const pts = ordered.map((d) => ({ x: d.left ?? 0, y: d.top ?? 0 }));
	shaft.set({ points: pts });
	// `set({points})` alone leaves the cached bounding box (and with it
	// pathOffset) untouched, which would render the shaft shifted away from
	// its dots. Recompute it and re-anchor so the points stay put in scene
	// coordinates.
	shaft.setBoundingBox(true);
	shaft.setCoords();
	const mid = pts[1] ?? pts[0];
	const end = pts[pts.length - 1] ?? mid;
	placeHead(head, end.x, end.y, mid.x, mid.y, head.width ?? 14);
}

/**
 * Rebuild the previous-generation arrows (segment pairs plus pivot handles) as
 * point-based ones, and drop the now-dead handles.
 */
export function migrateLegacyArrows(canvas: Canvas): void {
	const byId = new Map<string, FabricObject[]>();
	for (const obj of canvas.getObjects()) {
		const m = meta(obj);
		if (
			typeof m.arrowId === "string" &&
			(m.arrowRole === "shaft1" || m.arrowRole === "shaft2")
		) {
			const parts = byId.get(m.arrowId) ?? [];
			parts.push(obj);
			byId.set(m.arrowId, parts);
		}
	}

	for (const [id, parts] of byId) {
		const s1 = parts.find((p) => meta(p).arrowRole === "shaft1") as
			| Line
			| undefined;
		const s2 = parts.find((p) => meta(p).arrowRole === "shaft2") as
			| Line
			| undefined;
		if (!s1 || !s2) continue;

		const start = { x: s1.x1 ?? 0, y: s1.y1 ?? 0 };
		const mid = { x: s1.x2 ?? 0, y: s1.y2 ?? 0 };
		const end = { x: s2.x2 ?? 0, y: s2.y2 ?? 0 };
		const style = {
			stroke: (s1.stroke as string) ?? "#000000",
			strokeWidth: s1.strokeWidth ?? 2,
		};

		for (const obj of canvas.getObjects()) {
			const m = meta(obj);
			if (m.arrowId === id || m.handleFor === id) canvas.remove(obj);
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

	for (const obj of [...canvas.getObjects()]) {
		if (typeof meta(obj).handleFor === "string") canvas.remove(obj);
	}
}
