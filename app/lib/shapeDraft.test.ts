import assert from "node:assert/strict";
import {
	draftBox,
	ellipseInBox,
	isTinyBox,
	isTinyStroke,
	lineEnd,
	SHIFT_SNAP_ANGLE,
} from "./shapeDraft.ts";

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

test("an unshifted drag boxes the pointer in any quadrant", () => {
	const box = draftBox({ x: 100, y: 100 }, { x: 130, y: 140 }, false);
	assert.deepEqual(box, { left: 100, top: 100, width: 30, height: 40 });
	const up = draftBox({ x: 100, y: 100 }, { x: 70, y: 60 }, false);
	assert.deepEqual(up, { left: 70, top: 60, width: 30, height: 40 });
});

test("shift squares the box to the dominant axis, anchored at the start", () => {
	const tall = draftBox({ x: 0, y: 0 }, { x: 30, y: 80 }, true);
	assert.deepEqual(tall, { left: 0, top: 0, width: 80, height: 80 });
	const wide = draftBox({ x: 0, y: 0 }, { x: 90, y: 40 }, true);
	assert.deepEqual(wide, { left: 0, top: 0, width: 90, height: 90 });
	const back = draftBox({ x: 50, y: 50 }, { x: 20, y: -10 }, true);
	assert.deepEqual(back, { left: -10, top: -10, width: 60, height: 60 });
});

test("alt grows the box symmetrically around the start", () => {
	const box = draftBox({ x: 100, y: 100 }, { x: 130, y: 140 }, false, true);
	assert.deepEqual(box, { left: 70, top: 60, width: 60, height: 80 });
	const locked = draftBox({ x: 0, y: 0 }, { x: 30, y: 80 }, true, true);
	assert.deepEqual(locked, { left: -80, top: -80, width: 160, height: 160 });
});

test("the ellipse is inscribed in the drag box", () => {
	const shape = ellipseInBox(draftBox({ x: 10, y: 20 }, { x: 50, y: 60 }, false));
	assert.deepEqual(shape, { cx: 30, cy: 40, rx: 20, ry: 20 });
	const shift = ellipseInBox(draftBox({ x: 0, y: 0 }, { x: 30, y: 80 }, true));
	assert.deepEqual(shift, { cx: 40, cy: 40, rx: 40, ry: 40 });
});

test("an unshifted line ends exactly at the pointer", () => {
	const end = { x: 73, y: -19 };
	assert.equal(lineEnd({ x: 10, y: 10 }, end, false), end);
});

test("shift snaps line angles to 15 degrees in every quadrant", () => {
	const snap = (dx: number, dy: number) =>
		lineEnd({ x: 0, y: 0 }, { x: dx, y: dy }, true);
	assert.deepEqual(snap(100, 5), { x: 100, y: 0 }, "near horizontal");
	assert.deepEqual(snap(-100, -5), { x: -100, y: 0 }, "mirrored signs");
	const diagonal = snap(100, 96);
	assert.ok(
		Math.abs(diagonal.x - 100) < 1e-9 && Math.abs(diagonal.y - 100) < 1e-9,
		"45 degrees",
	);
	const thirty = snap(80, 45);
	assert.ok(
		Math.abs(Math.atan2(thirty.y, thirty.x) - 2 * SHIFT_SNAP_ANGLE) < 1e-9,
		"30 degrees lands on the grid",
	);
});

test("shift snaps near-vertical lines to fully vertical", () => {
	const snap = (dx: number, dy: number) =>
		lineEnd({ x: 10, y: 10 }, { x: 10 + dx, y: 10 + dy }, true);
	assert.deepEqual(snap(0, 100), { x: 10, y: 110 }, "already vertical");
	assert.deepEqual(snap(2, 100), { x: 10, y: 110 }, "within a grid step");
	assert.deepEqual(snap(-3, -100), { x: 10, y: -90 }, "vertical, both signs");
});

test("a zero-length drag stays a point", () => {
	assert.deepEqual(lineEnd({ x: 5, y: 5 }, { x: 5, y: 5 }, true), { x: 5, y: 5 });
});

test("tiny shapes are accidental clicks, thin ones are not", () => {
	assert.equal(isTinyBox(4, 4, 5), true, "a dot is accidental");
	assert.equal(isTinyBox(4, 40, 5), false, "a thin banner stays");
	assert.equal(isTinyBox(40, 4, 5), false, "a wide strip stays");
	assert.equal(isTinyBox(5, 5, 5), false, "exactly at the limit");
	assert.equal(isTinyStroke({ x: 0, y: 0 }, { x: 3, y: 4 }, 5), false, "5px exactly");
	assert.equal(isTinyStroke({ x: 0, y: 0 }, { x: 3, y: 3.9 }, 5), true, "under 5px");
});

console.log(`\n${passed} passed`);
