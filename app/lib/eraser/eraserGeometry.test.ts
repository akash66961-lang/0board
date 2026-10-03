import assert from "node:assert/strict";
import {
	capsulePolygon,
	circleSegments,
	discPolygon,
	distance,
	MAX_CIRCLE_SEGMENTS,
	MIN_CIRCLE_SEGMENTS,
	polygonArea,
	segmentIntersectsBox,
	signedArea,
} from "./eraserGeometry.ts";
import type { Point } from "../diagramTypes.ts";

let passed = 0;
function test(name: string, fn: () => void) {
	try {
		fn();
		passed++;
		console.log(`  ok  ${name}`);
	} catch (error) {
		console.error(`FAIL  ${name}`);
		console.error(error);
		process.exitCode = 1;
	}
}

/** Closest distance from a point to a segment. */
function distanceToSegment(from: Point, to: Point, point: Point): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const lengthSq = dx * dx + dy * dy;
	const t =
		lengthSq === 0
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						((point.x - from.x) * dx + (point.y - from.y) * dy) /
							lengthSq,
					),
				);
	return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

test("segment count honours the sagitta tolerance and stays bounded", () => {
	for (const radius of [1, 4, 12, 40, 300]) {
		const segments = circleSegments(radius, 0.4);
		assert.ok(
			segments >= MIN_CIRCLE_SEGMENTS,
			`${radius}px needs at least the minimum`,
		);
		assert.ok(segments <= MAX_CIRCLE_SEGMENTS, `${radius}px must stay capped`);
		const sagitta = radius * (1 - Math.cos(Math.PI / segments));
		if (radius > 8) {
			assert.ok(
				sagitta <= 0.4,
				`${radius}px circle strays ${sagitta.toFixed(3)}px`,
			);
		}
	}
});

test("a larger nib is approximated more finely", () => {
	assert.ok(circleSegments(200) > circleSegments(20));
});

test("a disc polygon sits on the circle and has area", () => {
	const center = { x: 40, y: -15 };
	const points = discPolygon(center, 9);
	assert.ok(points.length >= MIN_CIRCLE_SEGMENTS);
	for (const point of points) {
		assert.ok(
			Math.abs(distance(point, center) - 9) <= 0.4,
			"every vertex belongs on the nib",
		);
	}
	assert.ok(signedArea(points) > 0, "discs must all wind positively");
});

test("discs taken anywhere wind identically so their union cannot cancel", () => {
	const signs = [
		discPolygon({ x: 0, y: 0 }, 5),
		discPolygon({ x: 100, y: 50 }, 30),
		discPolygon({ x: -7, y: 3 }, 0.5),
	].map((ring) => Math.sign(signedArea(ring)));
	assert.deepEqual(signs, [1, 1, 1]);
});

test("a capsule covers the sweep between its endpoints and nothing beyond", () => {
	const from = { x: 10, y: 20 };
	const to = { x: 90, y: 44 };
	const radius = 7;
	const points = capsulePolygon(from, to, radius);
	assert.ok(points.length >= 8);
	for (const point of points) {
		const reach = distanceToSegment(from, to, point);
		assert.ok(
			reach <= radius + 0.4,
			`point ${JSON.stringify(point)} sits ${reach.toFixed(2)}px from the sweep`,
		);
	}
	// Both end discs are present: a handful of vertices must sit exactly on
	// each endpoint's circle.
	const startCap = points.filter(
		(point) => Math.abs(distance(point, from) - radius) <= 0.4,
	);
	const endCap = points.filter(
		(point) => Math.abs(distance(point, to) - radius) <= 0.4,
	);
	assert.ok(startCap.length >= 5, "start disc present");
	assert.ok(endCap.length >= 5, "end disc present");
});

test("capsules wind identically whatever direction the drag takes", () => {
	const signs: number[] = [];
	for (let i = 0; i < 8; i++) {
		const angle = (i / 8) * Math.PI * 2;
		const capsule = capsulePolygon(
			{ x: 0, y: 0 },
			{ x: Math.cos(angle) * 50, y: Math.sin(angle) * 50 },
			6,
		);
		signs.push(Math.sign(signedArea(capsule)));
	}
	assert.deepEqual(signs, Array(8).fill(1));
});

test("a zero-length drag degenerates into a plain disc", () => {
	const center = { x: 3, y: 4 };
	const capsule = capsulePolygon(center, { ...center }, 6);
	for (const point of capsule) {
		assert.ok(Math.abs(distance(point, center) - 6) <= 0.4);
	}
});

test("segmentIntersectsBox reports real crossings", () => {
	const box = { left: 100, top: 100, width: 50, height: 50 };
	const through: [Point, Point][] = [
		[{ x: 50, y: 125 }, { x: 200, y: 125 }],
		[{ x: 125, y: 50 }, { x: 125, y: 200 }],
		[{ x: 90, y: 90 }, { x: 180, y: 180 }],
	];
	for (const [from, to] of through) {
		assert.ok(
			segmentIntersectsBox(from, to, box),
			`${from.x},${from.y} -> ${to.x},${to.y}`,
		);
	}
	const misses: [Point, Point][] = [
		[{ x: 0, y: 0 }, { x: 50, y: 50 }],
		[{ x: 125, y: 300 }, { x: 125, y: 400 }],
		[{ x: 0, y: 125 }, { x: 90, y: 125 }],
	];
	for (const [from, to] of misses) {
		assert.ok(
			!segmentIntersectsBox(from, to, box),
			`${from.x},${from.y} -> ${to.x},${to.y}`,
		);
	}
});

test("an endpoint inside the box counts as a hit", () => {
	const box = { left: 0, top: 0, width: 10, height: 10 };
	assert.ok(segmentIntersectsBox({ x: 5, y: 5 }, { x: 500, y: 500 }, box));
});

test("degenerate boxes still answer for segments that touch them", () => {
	const box = { left: 0, top: 0, width: 0, height: 0 };
	assert.ok(segmentIntersectsBox({ x: -5, y: 0 }, { x: 5, y: 0 }, box));
	assert.ok(!segmentIntersectsBox({ x: -5, y: 1 }, { x: 5, y: 1 }, box));
});

test("signedArea and polygonArea agree on a known square", () => {
	const square: Point[] = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	];
	assert.equal(polygonArea(square), 100);
	assert.ok(signedArea(square) > 0);
	assert.equal(polygonArea([...square].reverse()), 100);
});

console.log(`\n${passed} passed`);
