import {
	Circle,
	type Canvas,
	type FabricObject,
	Polyline,
	Triangle,
} from "fabric";
import { meta } from "./diagram-meta";
import { createArrowDot, migrateLegacyArrows } from "./diagramArrows";
import { migrateAndWireStickies } from "./diagramSticky";
import { ACCENT_COLOR } from "./diagramConstants";

/**
 * Shared object styling. Applied to every selectable object and re-applied after
 * every load, since these visual defaults are not part of a saved snapshot.
 */
export function applyControlStyle(obj: FabricObject): void {
	// An erased object must answer clicks only where pixels remain, so a fully
	// erased shape can never be grabbed through the hole it left behind.
	obj.perPixelTargetFind = !!obj.clipPath;
	if (meta(obj).handleFor) return;
	obj.set({
		transparentCorners: false,
		cornerSize: 10,
		cornerColor: "#ffffff",
		cornerStrokeColor: ACCENT_COLOR,
		cornerStyle: "circle",
		borderColor: ACCENT_COLOR,
		borderScaleFactor: 2,
		padding: 4,
	});
}

function styleCanvasObjects(canvas: Canvas): void {
	for (const obj of canvas.getObjects()) {
		applyControlStyle(obj);
	}
}

/**
 * Every part of one linked construct (arrow, sticky note) carries the same
 * link id. This is the single definition used by dragging, handle visibility
 * and history restore so those features can never drift apart.
 */
export function linkIdOf(obj: FabricObject): string | undefined {
	const m = meta(obj);
	return m.arrowId ?? m.stickyPart;
}

export function findStickyParts(canvas: Canvas, id: string): FabricObject[] {
	return canvas
		.getObjects()
		.filter((o) => meta(o).stickyPart === id);
}

export function findArrowParts(
	canvas: Canvas,
	arrowId: string,
): { shaft?: Polyline; head?: Triangle; dots: Circle[] } {
	const matches = canvas
		.getObjects()
		.filter((o) => meta(o).arrowId === arrowId);
	return {
		shaft: matches.find(
			(o) => meta(o).arrowRole === "shaft",
		) as Polyline | undefined,
		head: matches.find(
			(o) => meta(o).arrowRole === "head",
		) as Triangle | undefined,
		dots: matches.filter(
			(o) => typeof meta(o).pointIndex === "number",
		) as Circle[],
	};
}

/**
 * Point dots are excluded from exports (they are selection UI), so a raw
 * snapshot of an arrow arrives without them. Rebuild the missing ones from
 * the shaft's stored points — undo, redo, page loads and PDF capture all
 * funnel through here, so an arrow can never end up un-reshapable.
 */
function ensureArrowDots(canvas: Canvas): void {
	const shafts = canvas
		.getObjects()
		.filter(
			(o) =>
				meta(o).arrowRole === "shaft" &&
				typeof meta(o).arrowId === "string",
		);
	for (const shaft of shafts) {
		const arrowId = meta(shaft).arrowId as string;
		const points = (shaft as Polyline).points ?? [];
		if (points.length < 3) continue;
		const present = new Set(
			findArrowParts(canvas, arrowId).dots.map(
				(d) => meta(d).pointIndex,
			),
		);
		for (let index = 0; index < 3; index++) {
			if (present.has(index)) continue;
			const point = points[index];
			if (!point) continue;
			canvas.add(
				createArrowDot({ x: point.x, y: point.y }, arrowId, index),
			);
		}
	}
}

/**
 * After any load, restore the invariants that a raw snapshot does not carry:
 * control styling, sticky notes split back into draggable linked parts, legacy
 * arrows rebuilt, missing arrow dots recreated, and invisible arrow handles
 * hidden.
 *
 * Every history/load path funnels through here so undo, redo, page switching
 * and PDF capture cannot diverge.
 */
export function normalizeLoadedCanvas(canvas: Canvas): void {
	styleCanvasObjects(canvas);
	migrateLegacyArrows(canvas);
	migrateAndWireStickies(canvas);
	ensureArrowDots(canvas);
	syncArrowHandleVisibility(canvas, canvas.getActiveObjects());
	canvas.renderAll();
}

export function syncArrowHandleVisibility(
	canvas: Canvas,
	selected: FabricObject[] = [],
): void {
	const visible = new Set<string>();
	for (const obj of selected) collectLinkIds(obj, visible);
	let changed = false;
	for (const obj of canvas.getObjects()) {
		const m = meta(obj);
		const link =
			m.handleFor ?? (m.pointIndex != null ? m.arrowId : undefined);
		if (link === undefined) continue;
		const shouldShow = visible.has(link);
		if (obj.visible !== shouldShow) {
			obj.set({ visible: shouldShow });
			changed = true;
		}
	}
	if (changed) canvas.renderAll();
}

function collectLinkIds(obj: FabricObject, into: Set<string>): void {
	const m = meta(obj);
	if (typeof m.arrowId === "string") into.add(m.arrowId);
	const children = (obj as unknown as { getObjects?: () => FabricObject[] })
		.getObjects?.();
	if (!children) return;
	for (const child of children) {
		const childId = meta(child).arrowId;
		if (typeof childId === "string") into.add(childId);
	}
}
