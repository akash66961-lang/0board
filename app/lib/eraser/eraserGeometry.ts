import type { Point } from "../diagramTypes";

/**
 * Geometry for the eraser's round nib.
 *
 * The eraser works like MS Paint: every pointer step is a disc (or, between two
 * pointer events, the capsule swept by that disc), and exactly the pixels
 * inside that footprint are wiped from whatever it passes over. These helpers
 * build the footprint as a polygon and decide which objects it can reach, so
 * the fabric layer only has to hand shapes to the canvas clipper.
 *
 * Footprints always wind the same way: they are combined into one path filled
 * with the nonzero rule, where two subpaths winding against each other would
 * cancel and punch a hole back into the drawing.
 */

/** Points closer than this are treated as duplicates. */
const EPSILON = 1e-9;

/** Never approximate a circle with fewer segments than this. */
export const MIN_CIRCLE_SEGMENTS = 8;

/** Never approximate a circle with more segments than this. */
export const MAX_CIRCLE_SEGMENTS = 64;

/**
 * How far the polygonal approximation may stray from the true circle, in
 * canvas pixels. Below half a pixel the difference is invisible, and the cap
 * keeps a huge nib from generating hundreds of points per step.
 */
export const DEFAULT_SEGMENT_TOLERANCE = 0.4;

export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed area doubled; positive for one winding direction, negative for the other. */
export function signedArea(contour: Point[]): number {
	let total = 0;
	for (let i = 0; i < contour.length; i++) {
		const a = contour[i];
		const b = contour[(i + 1) % contour.length];
		total += a.x * b.y - b.x * a.y;
	}
	return total;
}

export function polygonArea(contour: Point[]): number {
	if (contour.length < 3) return 0;
	return Math.abs(signedArea(contour) / 2);
}

/**
 * How many segments approximate a circle of `radius` within `tolerance`.
 *
 * A regular n-gon strays from its circle by `r * (1 - cos(pi / n))`, so the
 * needed segment count follows directly from that sagitta.
 */
export function circleSegments(
	radius: number,
	tolerance = DEFAULT_SEGMENT_TOLERANCE,
): number {
	if (!(radius > 0)) return MIN_CIRCLE_SEGMENTS;
	const ratio = Math.max(-1, Math.min(1, 1 - tolerance / radius));
	const halfStep = Math.max(Math.acos(ratio), 1e-6);
	const needed = Math.ceil(Math.PI / halfStep);
	return Math.max(MIN_CIRCLE_SEGMENTS, Math.min(MAX_CIRCLE_SEGMENTS, needed));
}

/** Flip the footprint when needed so every erase step winds one way. */
function consistentWinding(points: Point[]): Point[] {
	return signedArea(points) < 0 ? [...points].reverse() : points;
}

/** The erase disc as a polygon, wound consistently with every other footprint. */
export function discPolygon(
	center: Point,
	radius: number,
	tolerance = DEFAULT_SEGMENT_TOLERANCE,
): Point[] {
	const segments = circleSegments(radius, tolerance);
	const points: Point[] = [];
	for (let i = 0; i < segments; i++) {
		const angle = (i / segments) * Math.PI * 2;
		points.push({
			x: center.x + Math.cos(angle) * radius,
			y: center.y + Math.sin(angle) * radius,
		});
	}
	return consistentWinding(points);
}

/**
 * The region a disc of `radius` covers while travelling from `from` to `to` —
 * a capsule, i.e. both end discs plus the rectangle between them.
 *
 * One capsule per pointer event covers the whole step, so a fast sweep cannot
 * leave the gaps a sparse series of separate discs would.
 */
export function capsulePolygon(
	from: Point,
	to: Point,
	radius: number,
	tolerance = DEFAULT_SEGMENT_TOLERANCE,
): Point[] {
	const reach = distance(from, to);
	if (reach < EPSILON) return discPolygon(from, radius, tolerance);

	// Half a turn starts on the leading flank, so the start disc's arc bows
	// away from `to` and the end disc's arc bows away from `from`.
	const angle = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
	const steps = Math.max(4, Math.ceil(circleSegments(radius, tolerance) / 2));
	const points: Point[] = [];

	// Half a turn around the start disc, from the leading flank to the trailing one.
	for (let i = 0; i <= steps; i++) {
		const theta = angle + (Math.PI * i) / steps;
		points.push({
			x: from.x + Math.cos(theta) * radius,
			y: from.y + Math.sin(theta) * radius,
		});
	}
	// Half a turn around the end disc; the straight flanks fall out of the
	// polygon's closing edges.
	for (let i = 0; i <= steps; i++) {
		const theta = angle + Math.PI + (Math.PI * i) / steps;
		points.push({
			x: to.x + Math.cos(theta) * radius,
			y: to.y + Math.sin(theta) * radius,
		});
	}
	return consistentWinding(points);
}

/**
 * True when the segment passes through the box (Liang-Barsky clipping).
 *
 * The caller inflates the box by the nib radius first, so "reaches the box"
 * means "could touch the object at all".
 */
export function segmentIntersectsBox(
	from: Point,
	to: Point,
	box: Box,
): boolean {
	const minX = box.left;
	const minY = box.top;
	const maxX = box.left + box.width;
	const maxY = box.top + box.height;
	const dx = to.x - from.x;
	const dy = to.y - from.y;

	let start = 0;
	let end = 1;
	const clip = (p: number, q: number): boolean => {
		if (Math.abs(p) < EPSILON) return q >= 0;
		const t = q / p;
		if (p < 0) {
			if (t > end) return false;
			if (t > start) start = t;
		} else {
			if (t < start) return false;
			if (t < end) end = t;
		}
		return true;
	};

	return (
		clip(-dx, from.x - minX) &&
		clip(dx, maxX - from.x) &&
		clip(-dy, from.y - minY) &&
		clip(dy, maxY - from.y)
	);
}
