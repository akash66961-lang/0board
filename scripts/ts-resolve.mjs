import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolves extensionless relative imports ("./foo") to their TypeScript file
 * so the test files can be run directly with Node's type stripping, the same
 * way the app's bundler resolves them.
 */
export async function resolve(specifier, context, next) {
	try {
		return await next(specifier, context);
	}
	catch (error) {
		if (specifier.startsWith(".") || specifier.startsWith("/")) {
			const base = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
			for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
				const candidate = new URL(specifier + suffix, base);
				if (existsSync(fileURLToPath(candidate))) {
					return {
						url: candidate.href,
						shortCircuit: true,
						format: "module-typescript",
					};
				}
			}
		}
		throw error;
	}
}
