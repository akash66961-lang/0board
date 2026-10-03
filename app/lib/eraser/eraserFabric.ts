import { Path, type Canvas, type FabricObject, util } from "fabric";
import type { Point } from "../diagramTypes";
import {
	capsulePolygon,
	discPolygon,
	distance,
	segmentIntersectsBox,
} from "./eraserGeometry";

/**
 * Pixel-accurate erasing, in the spirit of MS Paint.
 *
 * Instead of cutting a shape's outline apart (which cannot express a glyph, a
 * wide stroke or a hole without inventing geometry), the erased footprint is
 * attached to every object it touches as an *inverted clip path*: Fabric
 * renders the object into its own cache and then punches the footprint out of
 * it with `destination-out`. What disappears is therefore exactly the pixels
 * inside the nib — the rest of the object, however far it reaches, survives.
 *
 * The footprint is stored in the object's own coordinate space, so a bite
 * belongs to its shape: moving or scaling the shape carries the erased area
 * along instead of leaving it behind on the canvas.
 */

/** Clip coordinates are rounded to this many decimals to keep snapshots small. */
const COORD_DECIMALS = 2;

function round(value: number): number {
	const factor = 10 ** COORD_DECIMALS;
	return Math.round(value * factor) / factor;
}

/** CSS cursor showing the nib as a circle centred on its hotspot. */
export function eraserCursor(diameter: number): string {
	// Even diameters keep the hotspot a whole pixel; browsers cap cursor
	// bitmaps, so very large nibs fall back to the plain crosshair.
	const size = Math.max(8, Math.min(64, Math.round(diameter / 2) * 2));
	const centre = size / 2;
	const radius = centre - 1;
	const svg =
		`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
		`<circle cx='${centre}' cy='${centre}' r='${radius}' fill='none' stroke='%23ffffff' stroke-width='3'/>` +
		`<circle cx='${centre}' cy='${centre}' r='${radius}' fill='none' stroke='%23111111' stroke-width='1.25'/>` +
		`</svg>`;
	return `url("data:image/svg+xml,${svg}") ${centre} ${centre}, crosshair`;
}

/** Transient or invisible objects are not canvas content, so the eraser ignores them. */
function isErasable(object: FabricObject): boolean {
	if (object.visible === false) return false;
	if (object.excludeFromExport) return false;
	return true;
}

/**
 * Extend the object's clip path so it also covers `footprint`.
 *
 * The footprint arrives in scene coordinates and is mapped into the object's
 * own frame, which is where Fabric applies a non-absolute clip path.
 */
function clipObject(object: FabricObject, footprint: Point[]): void {
	const inverse = util.invertTransform(object.calcTransformMatrix());
	const toLocal = (point: Point): Point => ({
		x: round(inverse[0] * point.x + inverse[2] * point.y + inverse[4]),
		y: round(inverse[1] * point.x + inverse[3] * point.y + inverse[5]),
	});

	// Subpaths accumulate as one path; the nonzero fill rule unites overlapping
	// dabs. The whiteboard never attaches a clip path any other way, so an
	// existing Path is a previous dab and simply continues the stroke.
	const commands: (string | number)[][] = [];
	const existing = object.clipPath;
	if (existing instanceof Path) {
		for (const command of existing.path) commands.push([...command]);
	}

	const start = toLocal(footprint[0]);
	commands.push(["M", start.x, start.y]);
	for (const point of footprint.slice(1)) {
		const local = toLocal(point);
		commands.push(["L", local.x, local.y]);
	}
	commands.push(["Z"]);

	object.clipPath = new Path(commands as never, { inverted: true });
	object.dirty = true;
	// Selection must follow what is left of the shape, not the bounding box of
	// pixels that are already gone.
	object.perPixelTargetFind = true;
}

/**
 * Wipe the nib footprint between `from` and `to` (a single disc when they are
 * the same point) from every object it reaches.
 *
 * Returns the objects that were clipped so a whole stroke can be finalised in
 * one pass when the pointer is released.
 */
export function eraseSegment(
	canvas: Canvas,
	from: Point,
	to: Point,
	radius: number,
): FabricObject[] {
	if (!(radius > 0)) return [];
	const footprint =
		distance(from, to) < 1e-6
			? discPolygon(from, radius)
			: capsulePolygon(from, to, radius);

	const touched: FabricObject[] = [];
	for (const object of canvas.getObjects()) {
		if (!isErasable(object)) continue;
		// The bounding box already includes the stroke, so growing it by the
		// nib radius gives the region the footprint could possibly paint.
		const box = object.getBoundingRect();
		const reach = {
			left: box.left - radius,
			top: box.top - radius,
			width: box.width + 2 * radius,
			height: box.height + 2 * radius,
		};
		if (!segmentIntersectsBox(from, to, reach)) continue;
		clipObject(object, footprint);
		touched.push(object);
	}
	return touched;
}

/**
 * True when the object still paints at least one visible pixel.
 *
 * The clip path runs while the cache renders, so an object the stroke wiped
 * out completely renders as an empty bitmap — which is the one reliable way to
 * tell "fully erased" from "erased almost everywhere".
 */
function hasVisiblePixels(object: FabricObject): boolean {
	try {
		const cached = object as unknown as {
			_cacheCanvas?: HTMLCanvasElement | null;
			_cacheContext?: CanvasRenderingContext2D | null;
			dirty?: boolean;
			renderCache: () => void;
		};
		cached.dirty = true;
		cached.renderCache();
		const cache = cached._cacheCanvas;
		const context = cached._cacheContext;
		if (!cache || !context || cache.width === 0 || cache.height === 0) {
			return true;
		}
		const { data } = context.getImageData(0, 0, cache.width, cache.height);
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] > 4) return true;
		}
		return false;
	} catch {
		// Without readable pixels there is no proof the object is gone.
		return true;
	}
}

/**
 * Finish an erase stroke: drop the objects the nib emptied completely, so a
 * fully erased shape is really gone rather than an invisible object that can
 * still be hit-tested or shipped in a saved page.
 */
export function finishErase(
	canvas: Canvas,
	touched: Iterable<FabricObject>,
): void {
	const emptied: FabricObject[] = [];
	for (const object of touched) {
		if (object.canvas !== canvas || !object.clipPath) continue;
		if (!hasVisiblePixels(object)) emptied.push(object);
	}
	if (emptied.length === 0) return;

	const active = canvas.getActiveObject();
	if (active && emptied.includes(active)) canvas.discardActiveObject();
	canvas.remove(...emptied);
}
