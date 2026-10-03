import assert from "node:assert/strict";
import {
	canRedo,
	canUndo,
	createHistory,
	pushHistory,
	redoHistory,
	resetHistory,
	undoHistory,
} from "./canvasHistory.ts";

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

test("a fresh history holds only its base entry", () => {
	const h = createHistory(50);
	pushHistory(h, "base");
	assert.equal(canUndo(h), false, "nothing to undo yet");
	assert.equal(undoHistory(h), null, "undo must not eat the base state");
	assert.equal(canRedo(h), false);
});

test("undo walks backwards and redo replays forwards", () => {
	const h = createHistory(50);
	pushHistory(h, "a");
	pushHistory(h, "b");
	pushHistory(h, "c");
	assert.equal(canUndo(h), true);
	assert.equal(undoHistory(h), "b");
	assert.equal(undoHistory(h), "a");
	assert.equal(undoHistory(h), null, "bottom of the stack");
	assert.equal(canRedo(h), true);
	assert.equal(redoHistory(h), "b");
	assert.equal(redoHistory(h), "c");
	assert.equal(redoHistory(h), null, "top of the stack");
});

test("pushing after an undo discards the redo branch", () => {
	const h = createHistory(50);
	pushHistory(h, "a");
	pushHistory(h, "b");
	pushHistory(h, "c");
	undoHistory(h);
	assert.equal(canRedo(h), true);
	pushHistory(h, "d");
	assert.equal(canRedo(h), false, "the undone future is unreachable");
	assert.equal(undoHistory(h), "b", "the branch point stays undoable");
});

test("the stack never grows past its limit", () => {
	const h = createHistory(3);
	for (const name of ["a", "b", "c", "d", "e"]) pushHistory(h, name);
	assert.equal(h.undoStack.length, 3);
	assert.deepEqual(h.undoStack, ["c", "d", "e"]);
	assert.equal(undoHistory(h), "d");
});

test("reset clears both branches", () => {
	const h = createHistory(50);
	pushHistory(h, "a");
	pushHistory(h, "b");
	undoHistory(h);
	resetHistory(h);
	assert.equal(h.undoStack.length, 0);
	assert.equal(canUndo(h), false);
	assert.equal(canRedo(h), false);
});

console.log(`\n${passed} passed`);
