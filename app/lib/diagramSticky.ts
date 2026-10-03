import { type Canvas, Group, Rect, Textbox } from "fabric";
import { applyControlStyle, findStickyParts } from "./canvasState";
import { meta } from "./diagram-meta";
import {
	STICKY_PADDING,
	STICKY_SIZE,
	STICKY_TEXT_WIDTH,
	uid,
} from "./diagramConstants";

/**
 * A sticky note is two linked top-level objects: a background rect carrying the
 * fixed 200x200 look and an editable textbox. Dragging either moves both, the
 * textbox edits natively on double click, and no ungroup dance is needed.
 */

export interface StickyFont {
	family: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string;
}

export function createStickyNote(
	x: number,
	y: number,
	color: string,
	font: StickyFont,
): { bg: Rect; text: Textbox; id: string } {
	const id = uid();
	const bg = new Rect({
		left: x,
		top: y,
		width: STICKY_SIZE,
		height: STICKY_SIZE,
		fill: color,
		stroke: "rgba(0,0,0,0.08)",
		strokeWidth: 1,
		rx: 4,
		ry: 4,
		originX: "left",
		originY: "top",
		selectable: true,
		evented: true,
		hasControls: false,
		hasBorders: false,
		stickyPart: id,
	} as unknown as Record<string, unknown>);

	const text = new Textbox("Note", {
		left: x + STICKY_PADDING,
		top: y + STICKY_PADDING,
		width: STICKY_TEXT_WIDTH,
		fontSize: 14,
		fontFamily: font.family,
		fill: font.color,
		editable: true,
		fontWeight: font.bold ? "bold" : "normal",
		fontStyle: font.italic ? "italic" : "normal",
		underline: font.underline,
		textAlign: "left",
		originX: "left",
		originY: "top",
		selectable: true,
		evented: true,
		stickyPart: id,
	} as unknown as Record<string, unknown>);
	applyControlStyle(text);

	return { bg, text, id };
}

/** Grow a note's background as its text gets longer. */
export function wireStickyGrow(
	canvas: Canvas,
	text: Textbox,
	stickyId: string,
): void {
	const record = text as unknown as Record<string, unknown>;
	if (record["__growWired"]) return;
	record["__growWired"] = true;
	text.on("changed", () => {
		const bg = findStickyParts(canvas, stickyId).find(
			(p) => p.type === "rect",
		);
		if (!bg) return;
		const needed = Math.max(STICKY_SIZE, (text.height ?? 0) + STICKY_PADDING * 2);
		if (Math.abs((bg.height ?? 0) - needed) > 1) {
			bg.set({ height: needed });
			bg.setCoords();
			canvas.renderAll();
		}
	});
}

/**
 * Convert legacy group-based stickies into linked parts, then wire text growth
 * on every note textbox and hide leftover drag handles.
 */
export function migrateAndWireStickies(canvas: Canvas): void {
	for (const obj of [...canvas.getObjects()]) {
		if (
			meta(obj).isSticky === true &&
			typeof (obj as unknown as Group).getObjects === "function"
		) {
			const group = obj as unknown as Group;
			// Capture the centres before the group is removed, since removing it
			// drops the children's world transforms.
			const positioned = [...group.getObjects()].map((child) => ({
				child,
				center: child.getCenterPoint(),
			}));
			canvas.remove(group);
			for (const { child, center } of positioned) {
				child.setPositionByOrigin(center, "center", "center");
				child.setCoords();
				if (child.type === "rect") {
					child.set({
						selectable: true,
						evented: true,
						hasControls: false,
						hasBorders: false,
					});
				} else {
					child.set({ selectable: true, evented: true });
					applyControlStyle(child);
				}
				canvas.add(child);
			}
		}
	}

	for (const obj of canvas.getObjects()) {
		const m = meta(obj);
		if (typeof m.stickyPart === "string" && (obj.type ?? "").includes("text")) {
			wireStickyGrow(canvas, obj as Textbox, m.stickyPart);
		}
		if (typeof m.handleFor === "string") {
			obj.set({ visible: false });
		}
	}
	canvas.renderAll();
}
