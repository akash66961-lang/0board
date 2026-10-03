import {
	Canvas,
	Ellipse,
	type FabricObject,
	Line,
	PencilBrush,
	Rect,
	Textbox,
	Triangle,
} from "fabric";
import { applyControlStyle } from "./canvasState";
import { createArrowParts, headSizeFor, placeHead } from "./diagramArrows";
import {
	DEFAULT_FONT_FAMILY,
	DEFAULT_STICKY_COLOR,
	hexToRgba,
	MIN_SHAPE_SIZE,
	uid,
} from "./diagramConstants";
import { createStickyNote, wireStickyGrow } from "./diagramSticky";
import type { Point, Tool } from "./diagramTypes";
import { eraserCursor, eraseSegment, finishErase } from "./eraser/eraserFabric";
import {
	draftBox,
	ellipseInBox,
	isTinyBox,
	isTinyStroke,
	lineEnd,
} from "./shapeDraft";

/** Any `useRef` matches this structural shape, so the lib stays React-free. */
interface Cell<T> {
	current: T;
}

/** Live style values for the newly bound tool handlers. */
export interface ToolStyle {
	strokeColor: string;
	fillColor: string;
	strokeWidth: number;
}

/**
 * Everything the tool handlers reach for that lives outside `rebindTool`
 * itself: draft state, eraser stroke state, style refs and the component's
 * settled-transaction callbacks.
 */
export interface ToolBindingDeps {
	isLoadingRef: Cell<boolean>;
	toolRef: Cell<Tool>;
	shapeStartRef: Cell<{ x: number; y: number } | null>;
	drawingShapeRef: Cell<FabricObject | null>;
	arrowHeadRef: Cell<FabricObject | null>;
	dragSeedsRef: Cell<Map<FabricObject, { left: number; top: number }>>;
	isErasingRef: Cell<boolean>;
	lastErasePointRef: Cell<Point | null>;
	eraseTouchedRef: Cell<Set<FabricObject>>;
	finishEraseStrokeRef: Cell<(() => void) | null>;
	eraserSizeRef: Cell<number>;
	fontFamilyRef: Cell<string | undefined>;
	fontBoldRef: Cell<boolean | undefined>;
	fontItalicRef: Cell<boolean | undefined>;
	fontUnderlineRef: Cell<boolean | undefined>;
	onChangeRef: Cell<(() => void) | undefined>;
	debouncedSave: () => void;
	stopEditing: () => void;
	endShapeDraft: (acceptable: boolean) => void;
	resetCursorToSelect: () => void;
	selectAfterCreate: () => void;
	seedDragPositions: (canvas: Canvas) => void;
	waitForFonts: () => Promise<boolean>;
}

/**
 * Unbind every mouse/path handler and wire the handlers for `tool`.
 *
 * The component effect calls this whenever the tool or a style value that a
 * handler captures changes; the caller is responsible for settling in-flight
 * strokes and drafts before the swap.
 */
export function rebindTool(
	canvas: Canvas,
	tool: Tool,
	style: ToolStyle,
	deps: ToolBindingDeps,
): void {
	const {
		isLoadingRef,
		toolRef,
		shapeStartRef,
		drawingShapeRef,
		arrowHeadRef,
		dragSeedsRef,
		isErasingRef,
		lastErasePointRef,
		eraseTouchedRef,
		finishEraseStrokeRef,
		eraserSizeRef,
		fontFamilyRef,
		fontBoldRef,
		fontItalicRef,
		fontUnderlineRef,
		onChangeRef,
		debouncedSave,
		stopEditing,
		endShapeDraft,
		resetCursorToSelect,
		selectAfterCreate,
		seedDragPositions,
		waitForFonts,
	} = deps;
	const { strokeColor: currentStrokeColor, fillColor: currentFillColor } =
		style;
	const currentStrokeWidth = style.strokeWidth;

	canvas.isDrawingMode = false;
	canvas.selection = true;
	canvas.defaultCursor = "default";
	canvas.hoverCursor = "default";
	canvas.off("mouse:down");
	canvas.off("mouse:move");
	canvas.off("mouse:up");
	canvas.off("path:created");

	switch (tool) {
		case "select": {
			canvas.selection = true;
			canvas.defaultCursor = "default";
			canvas.hoverCursor = "move";
			canvas.on("mouse:down", () => {
				if (isLoadingRef.current) return;
				seedDragPositions(canvas);
			});
			canvas.on("mouse:up", () => {
				dragSeedsRef.current.clear();
			});
			break;
		}
		case "draw": {
			canvas.isDrawingMode = true;
			canvas.selection = false;
			const brush = new PencilBrush(canvas);
			brush.color = currentStrokeColor;
			brush.width = currentStrokeWidth;
			canvas.freeDrawingBrush = brush;
			canvas.on("path:created", (e) => {
				const path = (e as unknown as { path?: FabricObject }).path;
				if (path) applyControlStyle(path);
				debouncedSave();
				onChangeRef.current?.();
			});
			break;
		}
		case "highlighter": {
			canvas.isDrawingMode = true;
			canvas.selection = false;
			const brush = new PencilBrush(canvas);
			brush.color = hexToRgba(currentStrokeColor, 0.35);
			brush.width = Math.max(currentStrokeWidth * 3, 10);
			brush.strokeLineCap = "round";
			brush.strokeLineJoin = "round";
			canvas.freeDrawingBrush = brush;
			canvas.on("path:created", (e) => {
				const path = (e as unknown as { path?: FabricObject }).path;
				if (path) {
					path.set({
						selectable: true,
						evented: true,
						globalCompositeOperation: "multiply",
					});
					applyControlStyle(path);
					canvas.renderAll();
				}
				debouncedSave();
				onChangeRef.current?.();
			});
			break;
		}
		case "rect": {
			canvas.selection = false;
			canvas.defaultCursor = "crosshair";
			canvas.on("mouse:down", (opt) => {
				if (isLoadingRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				shapeStartRef.current = { x: pointer.x, y: pointer.y };
				const rect = new Rect({
					left: pointer.x,
					top: pointer.y,
					width: 0,
					height: 0,
					fill:
						currentFillColor === "transparent"
							? ""
							: currentFillColor,
					stroke: currentStrokeColor,
					strokeWidth: currentStrokeWidth,
					selectable: false,
					originX: "left",
					originY: "top",
				});
				canvas.add(rect);
				drawingShapeRef.current = rect;
			});
			canvas.on("mouse:move", (opt) => {
				if (!shapeStartRef.current || !drawingShapeRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				const box = draftBox(
					shapeStartRef.current,
					{ x: pointer.x, y: pointer.y },
					opt.e.shiftKey,
					opt.e.altKey,
				);
				(drawingShapeRef.current as Rect).set(box);
				canvas.renderAll();
			});
			canvas.on("mouse:up", () => {
				const obj = drawingShapeRef.current;
				endShapeDraft(
					!!obj &&
						!isTinyBox(
							obj.width ?? 0,
							obj.height ?? 0,
							MIN_SHAPE_SIZE,
						),
				);
			});
			break;
		}
		case "circle": {
			canvas.selection = false;
			canvas.defaultCursor = "crosshair";
			canvas.on("mouse:down", (opt) => {
				if (isLoadingRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				shapeStartRef.current = { x: pointer.x, y: pointer.y };
				// The ellipse is inscribed in the drag box, so a free drag
				// draws any ellipse and shift locks it to a circle — the
				// Excalidraw behaviour (its "circle" tool is this tool).
				const ellipse = new Ellipse({
					left: pointer.x,
					top: pointer.y,
					rx: 0,
					ry: 0,
					fill:
						currentFillColor === "transparent"
							? ""
							: currentFillColor,
					stroke: currentStrokeColor,
					strokeWidth: currentStrokeWidth,
					selectable: false,
					originX: "center",
					originY: "center",
				});
				canvas.add(ellipse);
				drawingShapeRef.current = ellipse;
			});
			canvas.on("mouse:move", (opt) => {
				if (!shapeStartRef.current || !drawingShapeRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				const box = draftBox(
					shapeStartRef.current,
					{ x: pointer.x, y: pointer.y },
					opt.e.shiftKey,
					opt.e.altKey,
				);
				const { cx, cy, rx, ry } = ellipseInBox(box);
				(drawingShapeRef.current as Ellipse).set({
					left: cx,
					top: cy,
					rx,
					ry,
				});
				canvas.renderAll();
			});
			canvas.on("mouse:up", () => {
				const obj = drawingShapeRef.current;
				endShapeDraft(
					!!obj &&
						!isTinyBox(
							obj.width ?? 0,
							obj.height ?? 0,
							MIN_SHAPE_SIZE,
						),
				);
			});
			break;
		}
		case "line": {
			canvas.selection = false;
			canvas.defaultCursor = "crosshair";
			canvas.on("mouse:down", (opt) => {
				if (isLoadingRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				shapeStartRef.current = { x: pointer.x, y: pointer.y };
				const line = new Line(
					[pointer.x, pointer.y, pointer.x, pointer.y],
					{
						stroke: currentStrokeColor,
						strokeWidth: currentStrokeWidth,
						selectable: false,
					},
				);
				canvas.add(line);
				drawingShapeRef.current = line;
			});
			canvas.on("mouse:move", (opt) => {
				if (!shapeStartRef.current || !drawingShapeRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				const end = lineEnd(
					shapeStartRef.current,
					{ x: pointer.x, y: pointer.y },
					opt.e.shiftKey,
				);
				(drawingShapeRef.current as Line).set({
					x2: end.x,
					y2: end.y,
				});
				canvas.renderAll();
			});
			canvas.on("mouse:up", () => {
				const start = shapeStartRef.current;
				const line = drawingShapeRef.current as Line | null;
				const acceptable =
					!!start &&
					!!line &&
					!isTinyStroke(
						start,
						{ x: line.x2 ?? 0, y: line.y2 ?? 0 },
						MIN_SHAPE_SIZE,
					);
				endShapeDraft(acceptable);
			});
			break;
		}
		case "arrow": {
			canvas.selection = false;
			canvas.defaultCursor = "crosshair";
			const headSize = headSizeFor(currentStrokeWidth);
			canvas.on("mouse:down", (opt) => {
				if (isLoadingRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				shapeStartRef.current = { x: pointer.x, y: pointer.y };
				const line = new Line(
					[pointer.x, pointer.y, pointer.x, pointer.y],
					{
						stroke: currentStrokeColor,
						strokeWidth: currentStrokeWidth,
						selectable: false,
						evented: false,
					},
				);
				const head = new Triangle({
					left: pointer.x,
					top: pointer.y,
					width: headSize,
					height: headSize,
					fill: currentStrokeColor,
					selectable: false,
					evented: false,
					originX: "center",
					originY: "center",
				});
				canvas.add(line, head);
				drawingShapeRef.current = line;
				arrowHeadRef.current = head;
			});
			canvas.on("mouse:move", (opt) => {
				const start = shapeStartRef.current;
				const lineObj = drawingShapeRef.current;
				const headObj = arrowHeadRef.current;
				if (!start || !lineObj || !headObj) return;
				const pointer = canvas.getScenePoint(opt.e);
				const end = lineEnd(
					start,
					{ x: pointer.x, y: pointer.y },
					opt.e.shiftKey,
				);
				(lineObj as Line).set({ x2: end.x, y2: end.y });
				placeHead(
					headObj as Triangle,
					end.x,
					end.y,
					start.x,
					start.y,
					headSize,
				);
				canvas.renderAll();
			});
			canvas.on("mouse:up", () => {
				const start = shapeStartRef.current;
				const lineObj = drawingShapeRef.current as Line | null;
				const headObj = arrowHeadRef.current as Triangle | null;
				drawingShapeRef.current = null;
				arrowHeadRef.current = null;
				shapeStartRef.current = null;
				if (!lineObj || !headObj || !start) return;
				const from = { x: start.x, y: start.y };
				const to = {
					x: lineObj.x2 ?? start.x,
					y: lineObj.y2 ?? start.y,
				};
				canvas.remove(lineObj, headObj);
				// The load below owns the canvas; the preview is gone with it.
				if (isLoadingRef.current) return;
				// A click too small to be an arrow leaves no trace in history.
				if (isTinyStroke(from, to, MIN_SHAPE_SIZE)) {
					canvas.selection = false;
					resetCursorToSelect();
					selectAfterCreate();
					canvas.renderAll();
					return;
				}
				const arrowId = uid();
				const { shaft, head, dots } = createArrowParts(
					{ x1: from.x, y1: from.y, x2: to.x, y2: to.y, bend: 0 },
					{
						stroke: currentStrokeColor,
						strokeWidth: currentStrokeWidth,
					},
					arrowId,
				);
				canvas.add(shaft, head, ...dots);
				canvas.setActiveObject(shaft);
				canvas.selection = false;
				resetCursorToSelect();
				debouncedSave();
				onChangeRef.current?.();
				selectAfterCreate();
				canvas.renderAll();
			});
			break;
		}
		case "text": {
			canvas.selection = false;
			canvas.defaultCursor = "text";
			canvas.on("mouse:down", async (opt) => {
				if (isLoadingRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				await waitForFonts();
				// The tool can change (or the page can swap) while fonts load;
				// creating the textbox anyway would orphan it mid-switch.
				if (toolRef.current !== "text" || isLoadingRef.current) return;
				const text = new Textbox("Text", {
					left: pointer.x,
					top: pointer.y,
					fontSize: 16,
					fontFamily: fontFamilyRef.current ?? DEFAULT_FONT_FAMILY,
					fill: currentStrokeColor,
					width: 200,
					editable: true,
					originX: "left",
					originY: "top",
					fontWeight: fontBoldRef.current ? "bold" : "normal",
					fontStyle: fontItalicRef.current ? "italic" : "normal",
					underline: fontUnderlineRef.current ?? false,
				});
				canvas.add(text);
				canvas.setActiveObject(text);
				applyControlStyle(text);
				text.enterEditing();
				text.selectAll();
				debouncedSave();
				onChangeRef.current?.();
				selectAfterCreate();
			});
			break;
		}
		case "sticky": {
			canvas.selection = false;
			canvas.defaultCursor = "copy";
			canvas.hoverCursor = "move";
			canvas.on("mouse:down", async (opt) => {
				if (isLoadingRef.current) return;
				const pointer = canvas.getScenePoint(opt.e);
				await waitForFonts();
				// See the text tool: never create shapes for a stale tool.
				if (toolRef.current !== "sticky" || isLoadingRef.current)
					return;
				const stickyColor =
					currentFillColor === "transparent"
						? DEFAULT_STICKY_COLOR
						: currentFillColor;
				const { bg, text, id } = createStickyNote(
					pointer.x,
					pointer.y,
					stickyColor,
					{
						family:
							fontFamilyRef.current ?? DEFAULT_FONT_FAMILY,
						bold: fontBoldRef.current ?? false,
						italic: fontItalicRef.current ?? false,
						underline: fontUnderlineRef.current ?? false,
						color: "#1f2937",
					},
				);
				canvas.add(bg, text);
				wireStickyGrow(canvas, text, id);
				canvas.setActiveObject(text);
				text.enterEditing();
				text.selectAll();
				canvas.renderAll();
				debouncedSave();
				onChangeRef.current?.();
				selectAfterCreate();
			});
			break;
		}
		case "eraser": {
			canvas.selection = false;
			const nibCursor = eraserCursor(eraserSizeRef.current);
			canvas.defaultCursor = nibCursor;
			canvas.hoverCursor = nibCursor;
			const nibRadius = () => eraserSizeRef.current / 2;

			// One capsule covers the whole step between pointer events,
			// so a fast sweep erases continuously with no gaps.
			const dab = (from: Point, to: Point) => {
				for (const object of eraseSegment(
					canvas,
					from,
					to,
					nibRadius(),
				)) {
					eraseTouchedRef.current.add(object);
				}
				canvas.renderAll();
			};

			const finishStroke = () => {
				if (!isErasingRef.current) return;
				isErasingRef.current = false;
				lastErasePointRef.current = null;
				finishEraseStrokeRef.current = null;
				const touched = eraseTouchedRef.current;
				eraseTouchedRef.current = new Set();
				finishErase(canvas, touched);
				canvas.renderAll();
				// Clicking empty canvas erases nothing, so it must not
				// push a duplicate undo entry.
				if (touched.size === 0) return;
				debouncedSave();
				onChangeRef.current?.();
			};
			finishEraseStrokeRef.current = finishStroke;

			canvas.on("mouse:down", (opt) => {
				if (isLoadingRef.current) return;
				// A release the canvas never saw would leave a stroke open.
				if (isErasingRef.current) finishStroke();
				finishEraseStrokeRef.current = finishStroke;
				stopEditing();
				canvas.discardActiveObject();
				eraseTouchedRef.current.clear();
				isErasingRef.current = true;
				const pointer = canvas.getScenePoint(opt.e);
				const point = { x: pointer.x, y: pointer.y };
				lastErasePointRef.current = point;
				dab(point, point);
			});
			canvas.on("mouse:move", (opt) => {
				if (!isErasingRef.current) return;
				// A release outside the canvas never fires mouse:up,
				// so watch the button to end the stroke.
				const buttons = (
					opt.e as unknown as { buttons?: number }
				).buttons;
				if (typeof buttons === "number" && !(buttons & 1)) {
					finishStroke();
					return;
				}
				const pointer = canvas.getScenePoint(opt.e);
				const to = { x: pointer.x, y: pointer.y };
				const from = lastErasePointRef.current;
				dab(from ?? to, to);
				lastErasePointRef.current = to;
			});
			canvas.on("mouse:up", finishStroke);
			break;
		}
	}

	canvas.renderAll();
}
