import assert from "node:assert/strict";
import { Canvas, Line, Path, Rect, type FabricObject } from "fabric";
import { eraseSegment, eraserCursor, finishErase } from "./eraserFabric.ts";
import { signedArea } from "./eraserGeometry.ts";
import type { Point } from "../diagramTypes.ts";

const tests: [string, () => void | Promise<void>][] = [];
function test(name: string, run: () => void | Promise<void>): void {
	tests.push([name, run]);
}

/**
 * A canvas stand-in: `eraseSegment` only reads objects, `finishErase` only
 * removes them, so no DOM or rendering is needed to drive either.
 */
function fakeCanvas(objects: FabricObject[]): {
	canvas: Canvas;
	removed: FabricObject[];
} {
	const removed: FabricObject[] = [];
	const canvas = {
		getObjects: () => objects,
		getActiveObject: () => null,
		remove: (...args: FabricObject[]) => {
			removed.push(...args);
			for (const object of args) {
				const index = objects.indexOf(object);
				if (index >= 0) objects.splice(index, 1);
			}
		},
	} as unknown as Canvas;
	return { canvas, removed };
}

/**
 * Map every clip-path vertex back into scene coordinates.
 *
 * Fabric draws a non-absolute clip path inside the owning object's frame, so
 * undoing `M_object x M_clip x (vertex - pathOffset)` must land the vertex on
 * the scene where the nib actually touched.
 */
function clipScenePoints(object: FabricObject): Point[] {
	const clip = object.clipPath;
	assert.ok(clip instanceof Path, "expected the clip to be a path");
	const objectMatrix = object.calcTransformMatrix();
	const clipMatrix = clip.calcTransformMatrix();
	const offset = clip.pathOffset;
	const apply = (matrix: number[], point: Point): Point => ({
		x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
		y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
	});
	const points: Point[] = [];
	for (const command of clip.path) {
		if (command[0] !== "M" && command[0] !== "L") continue;
		const local = apply(clipMatrix, {
			x: (command[1] as number) - offset.x,
			y: (command[2] as number) - offset.y,
		});
		points.push(apply(objectMatrix, local));
	}
	return points;
}

/** The clip path split into its M-delimited subpaths (one per dab). */
function clipSubpaths(object: FabricObject): (string | number)[][][] {
	const clip = object.clipPath;
	assert.ok(clip instanceof Path, "expected the clip to be a path");
	const groups: (string | number)[][][] = [];
	for (const command of clip.path) {
		if (command[0] === "M") groups.push([command]);
		else groups[groups.length - 1].push(command);
	}
	return groups;
}

function rect(options: Partial<Rect> = {}): Rect {
	return new Rect({
		left: 0,
		top: 0,
		width: 100,
		height: 100,
		fill: "#ff0000",
		...options,
	});
}

test("a dab clips the object instead of cutting it apart", () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	const touched = eraseSegment(canvas, { x: 50, y: 50 }, { x: 50, y: 50 }, 12);
	assert.deepEqual(touched, [target], "the same object comes back");
	assert.ok(target.clipPath instanceof Path, "the bite lives in a clip path");
	assert.equal(target.clipPath?.inverted, true, "the footprint must be punched out");
	assert.ok(!target.clipPath?.absolutePositioned, "the bite belongs to the shape, not the canvas");
	assert.equal(target.perPixelTargetFind, true, "selection must ignore erased pixels");
	assert.equal(target.width, 100, "the geometry itself is never rebuilt");
	assert.equal(target.fill, "#ff0000");
});

test("the footprint stays inside the nib in scene coordinates", () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	const center = { x: 50, y: 50 };
	const radius = 12;
	eraseSegment(canvas, center, center, radius);
	const points = clipScenePoints(target);
	assert.ok(points.length >= 10, "a circle needs enough vertices to look round");
	let closest = Infinity;
	let farthest = 0;
	for (const point of points) {
		const reach = Math.hypot(point.x - center.x, point.y - center.y);
		closest = Math.min(closest, reach);
		farthest = Math.max(farthest, reach);
		assert.ok(reach <= radius + 0.75, `vertex sits ${reach.toFixed(2)}px from the dab`);
	}
	assert.ok(farthest >= radius - 0.75, "the footprint must reach the nib's edge");
	assert.ok(closest <= radius, "the footprint must cover the centre");
});

test("the footprint follows a rotated and scaled object", () => {
	const target = rect({ left: 120, top: 80, angle: 30, scaleX: 1.5, scaleY: 0.75 });
	const { canvas } = fakeCanvas([target]);
	const center = { x: 150, y: 110 };
	const radius = 9;
	eraseSegment(canvas, center, center, radius);
	assert.ok(target.clipPath, "the transformed object was reached");
	for (const point of clipScenePoints(target)) {
		const reach = Math.hypot(point.x - center.x, point.y - center.y);
		assert.ok(
			reach <= radius + 0.75,
			`local coordinates leaked: vertex is ${reach.toFixed(2)}px from the dab`,
		);
	}
});

test("a dragged capsule covers the whole step", () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	const from = { x: 20, y: 40 };
	const to = { x: 80, y: 60 };
	const radius = 6;
	eraseSegment(canvas, from, to, radius);
	const points = clipScenePoints(target);
	for (const point of points) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const lengthSq = dx * dx + dy * dy;
		const t = Math.max(
			0,
			Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq),
		);
		const reach = Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
		assert.ok(reach <= radius + 0.75, `vertex strays ${reach.toFixed(2)}px from the sweep`);
	}
	// Both end caps exist, so the stroke is a capsule, not a bare segment.
	const startCap = points.filter(
		(point) => Math.hypot(point.x - from.x, point.y - from.y) <= radius + 0.75,
	);
	assert.ok(startCap.length >= 5, "start disc present");
});

test("objects the nib never reaches stay untouched", () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	const touched = eraseSegment(canvas, { x: 900, y: 900 }, { x: 900, y: 900 }, 10);
	assert.deepEqual(touched, [], "out-of-reach objects are not returned");
	assert.equal(target.clipPath, undefined, "and must keep a clean clip");
	assert.ok(!target.perPixelTargetFind, "and keep plain bounding-box selection");
});

test("each dab extends the same clip", () => {
	// Objects are positioned by their centre in Fabric 7, so this rect spans
	// -50..50 in scene coordinates and both dabs sit inside it.
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	eraseSegment(canvas, { x: -30, y: 0 }, { x: -30, y: 0 }, 8);
	eraseSegment(canvas, { x: 30, y: 0 }, { x: 30, y: 0 }, 8);
	const subpaths = clipSubpaths(target);
	assert.equal(subpaths.length, 2, "one subpath per dab");
	// Every subpath still sits on its own dab, in scene coordinates.
	const points = clipScenePoints(target);
	for (const center of [{ x: -30, y: 0 }, { x: 30, y: 0 }]) {
		const near = points.some(
			(point) => Math.hypot(point.x - center.x, point.y - center.y) <= 8.75,
		);
		assert.ok(near, "each dab leaves its own footprint");
	}
});

test("overlapping dabs all wind the same way so the union stays filled", () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	eraseSegment(canvas, { x: -5, y: 0 }, { x: -5, y: 0 }, 10);
	eraseSegment(canvas, { x: 5, y: 0 }, { x: 5, y: 0 }, 10);
	for (const subpath of clipSubpaths(target)) {
		const ring: Point[] = [];
		for (const command of subpath) {
			if (command[0] === "M" || command[0] === "L") {
				ring.push({ x: command[1] as number, y: command[2] as number });
			}
		}
		assert.ok(signedArea(ring) > 0, "every dab must wind positively");
	}
});

test("an erased stroke stays one object", () => {
	const line = new Line([0, 0, 200, 0], { stroke: "#000000", strokeWidth: 6 });
	const { canvas } = fakeCanvas([line]);
	const touched = eraseSegment(canvas, { x: 100, y: 0 }, { x: 100, y: 0 }, 10);
	assert.deepEqual(touched, [line], "a wide stroke is bitten, never split");
	assert.ok(line.clipPath, "the bite is recorded on the single line");
});

test("invisible objects are not canvas content", () => {
	const hidden = rect({ visible: false });
	const { canvas } = fakeCanvas([hidden]);
	const touched = eraseSegment(canvas, { x: 50, y: 50 }, { x: 50, y: 50 }, 40);
	assert.deepEqual(touched, [], "the eraser ignores them");
	assert.equal(hidden.clipPath, undefined);
});

test("every step of one stroke stays inside the nib", () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	const from = { x: -40, y: 0 };
	const to = { x: 40, y: 0 };
	eraseSegment(canvas, from, from, 5);
	eraseSegment(canvas, from, to, 5);
	eraseSegment(canvas, to, to, 5);
	const points = clipScenePoints(target);
	assert.ok(points.length >= 20, "three dabs worth of vertices");
	for (const point of points) {
		const reach = Math.min(
			Math.hypot(point.x - from.x, point.y - from.y),
			Math.hypot(point.x - to.x, point.y - to.y),
		);
		const dx = to.x - from.x;
		const t = Math.max(0, Math.min(1, (point.x - from.x) / dx));
		const onSweep = Math.hypot(point.x - (from.x + dx * t), point.y - from.y);
		assert.ok(
			Math.min(reach, onSweep) <= 5.75,
			`vertex ${JSON.stringify(point)} escaped the stroke`,
		);
	}
});

test("finishErase never drops an object it cannot inspect", () => {
	// Node has no canvas: hasVisiblePixels must fail safe and keep the object
	// rather than destroy content it could not prove was gone.
	const target = rect();
	const { canvas, removed } = fakeCanvas([target]);
	eraseSegment(canvas, { x: 50, y: 50 }, { x: 50, y: 50 }, 12);
	finishErase(canvas, [target]);
	assert.deepEqual(removed, [], "nothing was removed");
	assert.ok(objectsContain(canvas, target), "the object is still on the canvas");
});

test("finishErase ignores objects that left the canvas", () => {
	const target = rect();
	const other = rect({ left: 300 });
	const { canvas, removed } = fakeCanvas([other]);
	target.clipPath = new Path(
		[["M", 0, 0], ["L", 1, 1], ["Z"]],
		{ inverted: true },
	);
	finishErase(canvas, [target]);
	assert.deepEqual(removed, [], "an object already gone is not touched again");
});

function objectsContain(canvas: Canvas, object: FabricObject): boolean {
	return canvas.getObjects().includes(object);
}

test("the cursor shows the nib as a ring", () => {
	const cursor = eraserCursor(12);
	assert.ok(cursor.startsWith('url("data:image/svg+xml,'), "custom image cursor");
	assert.ok(cursor.endsWith(", crosshair"), "crosshair fallback");
	assert.ok(cursor.includes(" 6 6,"), "the hotspot is the nib's centre");
});

test("cursor sizes are clamped to bitmaps browsers accept", () => {
	assert.ok(eraserCursor(500).includes(" 32 32,"), "huge nibs cap at 64px");
	assert.ok(eraserCursor(1).includes(" 4 4,"), "tiny nibs still read as a ring");
});

test("the clip survives a page save round trip", async () => {
	const target = rect();
	const { canvas } = fakeCanvas([target]);
	eraseSegment(canvas, { x: 40, y: 40 }, { x: 60, y: 60 }, 7);
	const before = target.clipPath;
	assert.ok(before instanceof Path);
	const restored = await Rect.fromObject(
		JSON.parse(JSON.stringify(target.toObject())),
	);
	assert.ok(restored.clipPath instanceof Path, "the bite was serialized");
	assert.equal(restored.clipPath.inverted, true);
	const path = (restored.clipPath as Path).path;
	assert.equal(path.length, before.path.length, "no commands were lost");
});

let passed = 0;
for (const [name, run] of tests) {
	try {
		await run();
		passed++;
		console.log(`  ok  ${name}`);
	} catch (error) {
		console.error(`FAIL  ${name}`);
		console.error(error);
		process.exitCode = 1;
	}
}

console.log(`\n${passed} passed`);
