import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Run every `*.test.ts` under app/ in its own process (Node's type stripping
 * is per-process, and one failing file must not hide the others). New test
 * files are picked up automatically, so the script never needs editing.
 */
const ROOT = process.cwd();

/** Recursively collect the test files below `dir`. */
function findTests(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...findTests(full));
		else if (entry.name.endsWith(".test.ts")) found.push(full);
	}
	return found;
}

const tests = findTests(path.join(ROOT, "app")).sort();
if (tests.length === 0) {
	console.error("No *.test.ts files found under app/");
	process.exit(1);
}

let failed = 0;
for (const test of tests) {
	console.log(`\n${path.relative(ROOT, test)}`);
	const result = spawnSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"--import",
			"./scripts/register-ts.mjs",
			test,
		],
		{ stdio: "inherit", cwd: ROOT },
	);
	if (result.status !== 0) failed++;
}

if (failed > 0) {
	console.error(`\n${failed} of ${tests.length} test file(s) failed`);
	process.exit(1);
}
console.log(`\nAll ${tests.length} test files passed`);
