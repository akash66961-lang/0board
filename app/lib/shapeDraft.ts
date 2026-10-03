import type { Point } from "./diagramTypes";

/**
 * Pure drag math for the shape tools, mirroring Excalidraw's behaviour:
 * the drag start is the anchor, shift locks straight sides/circles to the
 * dominant axis (the cursor sticks to one side of the box) and locks line
 * endpoints to 15-degree increments, alt grows the box from its centre.
 * Keeping this out of the canvas component lets the rules be unit tested.
 */

/** Angle step shift snaps lines to, in radians (Excalidraw: 15 degrees). */
export const SHIFT_SNAP_ANGLE = Math.PI / 12;

export interface DraftBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Bounding box of a rectangle/ellipse drag from `start` to `end`.
 *
 * With shift held the box becomes a square whose side follows the dominant
 * axis, so the pointer always sticks to one of its sides instead of floating
 * inside the shape. With alt held the box grows symmetrically around `start`.
 */
export function draftBox(
	start: Point,
	end: Point,
	shift: boolean,
	fromCenter = false,
): DraftBox {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	let width = Math.abs(dx);
	let height = Math.abs(dy);
	if (shift) {
		const side = Math.max(width, height);
		width = side;
		height = side;
	}
	if (fromCenter) {
		return {
			left: start.x - width,
			top: start.y - height,
			width: width * 2,
			height: height * 2,
		};
	}
	return {
		left: dx < 0 ? start.x - width : start.x,
		top: dy < 0 ? start.y - height : start.y,
		width,
		height,
	};
}

/** Centre and radii of the ellipse inscribed in `box` (Excalidraw draws the
 * ellipse inside the drag box, so a free drag yields an ellipse and a shift
 * drag yields a circle). */
export function ellipseInBox(box: DraftBox): {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
} {
	return {
		cx: box.left + box.width / 2,
		cy: box.top + box.height / 2,
		rx: box.width / 2,
		ry: box.height / 2,
	};
}

/** Fuzz for deciding that a snapped angle landed on the vertical stop. */
const VERTICAL_EPSILON = 1e-9;

/**
 * Endpoint of a line/arrow drag from `start` to `end`.
 *
 * With shift held the direction snaps to `SHIFT_SNAP_ANGLE` increments. The
 * horizontal extent is kept exactly (or the full vertical extent when the
 * snap lands on vertical), matching Excalidraw so the pointer keeps sticking
 * to the axis it is pulling.
 */
export function lineEnd(start: Point, end: Point, shift: boolean): Point {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	if (!shift || (dx === 0 && dy === 0)) return end;
	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);
	const locked =
		Math.round(Math.atan2(absDy, absDx) / SHIFT_SNAP_ANGLE) *
		SHIFT_SNAP_ANGLE;
	if (locked === 0) return { x: start.x + Math.sign(dx) * absDx, y: start.y };
	if (locked >= Math.PI / 2 - VERTICAL_EPSILON) {
		return { x: start.x, y: start.y + Math.sign(dy) * absDy };
	}
	return {
		x: start.x + Math.sign(dx) * absDx,
		y: start.y + Math.sign(dy) * absDx * Math.tan(locked),
	};
}

/**
 * A box is an accidental click only when *both* sides are tiny, so thin
 * banners and slivers stay valid shapes.
 */
export function isTinyBox(width: number, height: number, min: number): boolean {
	return width < min && height < min;
}

/** A stroke is an accidental click when it is shorter than `min`. */
export function isTinyStroke(from: Point, to: Point, min: number): boolean {
	return Math.hypot(to.x - from.x, to.y - from.y) < min;
}
