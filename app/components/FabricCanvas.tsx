"use client";

import {
	Canvas,
	Circle,
	type FabricObject,
	Line,
	PencilBrush,
	Rect,
	Textbox,
	Triangle,
} from "fabric";
import {
	applyControlStyle,
	canvasToJSON,
	createArrowParts,
	createStickyNote,
	DEFAULT_STICKY_COLOR,
	findArrowParts,
	findStickyParts,
	hexToRgba,
	migrateAndWireStickies,
	migrateLegacyArrows,
	placeHead,
	eraserCursor,
	reshapeArrow,
	snapshotCanvas,
	styleCanvasObjects,
	uid,
	wireStickyGrow,
} from "./diagramShapes";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";

export type Tool =
	| "select"
	| "draw"
	| "highlighter"
	| "rect"
	| "circle"
	| "line"
	| "arrow"
	| "text"
	| "sticky"
	| "eraser";

export interface FabricCanvasAPI {
	getJSON: () => ReturnType<Canvas["toJSON"]>;
	loadJSON: (json: ReturnType<Canvas["toJSON"]>) => Promise<void>;
	undo: () => void;
	redo: () => void;
	canUndo: () => boolean;
	canRedo: () => boolean;
	clear: () => void;
	forceSave: () => void;
	flushEditing: () => void;
	isLoading: () => boolean;
	snapshotImage: () => string | null;
	capturePage: (json: Record<string, unknown>) => Promise<string | null>;
	getCanvasElement: () => HTMLCanvasElement | null;
}

interface FabricCanvasProps {
	onChange?: () => void;
	onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
	tool: Tool;
	strokeColor: string;
	fillColor: string;
	strokeWidth: number;
	fontFamily?: string;
	fontBold?: boolean;
	fontItalic?: boolean;
	fontUnderline?: boolean;
	pageJson?: Record<string, unknown>;
	pageKey?: number;
	onToolChange?: (tool: Tool) => void;
	darkMode?: boolean;
}

const MIN_SHAPE_SIZE = 5;
const FONT_LOAD_TIMEOUT = 3000;

const FabricCanvas = forwardRef<FabricCanvasAPI, FabricCanvasProps>(
	(
		{
			onChange,
			onHistoryChange,
			tool,
			strokeColor,
			fillColor,
			strokeWidth,
			fontFamily,
			fontBold,
			fontItalic,
			fontUnderline,
		pageJson,
		pageKey,
		onToolChange,
		darkMode = false,
	}: FabricCanvasProps,
	ref,
) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const canvasElRef = useRef<HTMLCanvasElement>(null);
		const fabricRef = useRef<Canvas | null>(null);
		const historyRef = useRef<string[]>([]);
		const redoStackRef = useRef<string[]>([]);
		const isLoadingRef = useRef(false);
		const drawingShapeRef = useRef<FabricObject | null>(null);
		const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
		const isDrawingRef = useRef(false);
		const initializedRef = useRef(false);
		const fontLoadedRef = useRef(false);
		const lastLoadedPageKeyRef = useRef<number>(-1);
		const arrowHeadRef = useRef<FabricObject | null>(null);

		const toolRef = useRef(tool);
		toolRef.current = tool;
		const strokeColorRef = useRef(strokeColor);
		strokeColorRef.current = strokeColor;
		const fillColorRef = useRef(fillColor);
		fillColorRef.current = fillColor;
		const strokeWidthRef = useRef(strokeWidth);
		strokeWidthRef.current = strokeWidth;
		const fontFamilyRef = useRef(fontFamily);
		fontFamilyRef.current = fontFamily;
		const fontBoldRef = useRef(fontBold);
		fontBoldRef.current = fontBold;
		const fontItalicRef = useRef(fontItalic);
		fontItalicRef.current = fontItalic;
		const fontUnderlineRef = useRef(fontUnderline);
		fontUnderlineRef.current = fontUnderline;

		const onChangeRef = useRef(onChange);
		onChangeRef.current = onChange;
		const onHistoryChangeRef = useRef(onHistoryChange);
		onHistoryChangeRef.current = onHistoryChange;
		const onToolChangeRef = useRef(onToolChange);
		onToolChangeRef.current = onToolChange;
		/** Last known position per linked part set, for dragging parts together. */
		const lastPosRef = useRef(new Map<string, { left: number; top: number }>());
		const selectAfterCreate = useCallback(() => {
			onToolChangeRef.current?.("select");
		}, []);

		const forceSaveRef = useRef(() => {});
		forceSaveRef.current = useCallback(() => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return;
			const json = snapshotCanvas(canvas);
			historyRef.current.push(json);
			redoStackRef.current = [];
			if (historyRef.current.length > 50) historyRef.current.shift();
			onHistoryChangeRef.current?.(historyRef.current.length > 1, false);
			onChangeRef.current?.();
		}, []);

		const saveHistory = useCallback(() => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return;
			const json = snapshotCanvas(canvas);
			historyRef.current.push(json);
			redoStackRef.current = [];
			if (historyRef.current.length > 50) historyRef.current.shift();
			onHistoryChangeRef.current?.(historyRef.current.length > 1, false);
		}, []);

		const debouncedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const debouncedSave = useCallback(() => {
			if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
			debouncedSaveRef.current = setTimeout(() => {
				forceSaveRef.current();
			}, 300);
		}, []);

		const waitForFonts = useCallback(async (): Promise<boolean> => {
			if (fontLoadedRef.current) return true;
			if (typeof document === "undefined") return false;
			if (!("fonts" in document)) return false;
			try {
				await Promise.race([
					document.fonts.ready,
					new Promise<boolean>((_, reject) =>
						setTimeout(() => reject(new Error("Font timeout")), FONT_LOAD_TIMEOUT),
					),
				]);
				fontLoadedRef.current = true;
				return true;
			} catch {
				fontLoadedRef.current = true;
				return false;
			}
		}, []);

		useImperativeHandle(ref, () => ({
			getJSON: () =>
				fabricRef.current ? canvasToJSON(fabricRef.current) : {},
		loadJSON: async (json) => {
			const canvas = fabricRef.current;
			if (!canvas) return;
			isLoadingRef.current = true;
			historyRef.current = [];
			redoStackRef.current = [];
			try {
				await canvas.loadFromJSON(json);
				canvas.backgroundColor = darkMode ? "#1a1a1a" : "#ffffff";
				canvas.renderAll();
				styleCanvasObjects(canvas);
				migrateAndWireStickies(canvas);
				migrateLegacyArrows(canvas);
				resetDragTracking();
				historyRef.current.push(snapshotCanvas(canvas));
			} finally {
				isLoadingRef.current = false;
			}
			onHistoryChangeRef.current?.(false, false);
		},
			undo: () => {
				const canvas = fabricRef.current;
				if (!canvas || historyRef.current.length <= 1) return;
				const current = historyRef.current.pop();
				if (!current) return;
				redoStackRef.current.push(current);
				const prev = historyRef.current[historyRef.current.length - 1];
				isLoadingRef.current = true;
				canvas.loadFromJSON(prev)
					.then(() => {
						canvas.renderAll();
						styleCanvasObjects(canvas);
						migrateAndWireStickies(canvas);
						migrateLegacyArrows(canvas);
						resetDragTracking();
						isLoadingRef.current = false;
						onChangeRef.current?.();
						onHistoryChangeRef.current?.(
							historyRef.current.length > 1,
							redoStackRef.current.length > 0,
						);
					})
					.catch(() => {
						isLoadingRef.current = false;
					});
			},
			redo: () => {
				const canvas = fabricRef.current;
				if (!canvas || redoStackRef.current.length === 0) return;
				const next = redoStackRef.current.pop();
				if (!next) return;
				historyRef.current.push(next);
				isLoadingRef.current = true;
				canvas.loadFromJSON(next)
					.then(() => {
						canvas.renderAll();
						styleCanvasObjects(canvas);
						migrateAndWireStickies(canvas);
						migrateLegacyArrows(canvas);
						resetDragTracking();
						isLoadingRef.current = false;
						onChangeRef.current?.();
						onHistoryChangeRef.current?.(
							historyRef.current.length > 1,
							redoStackRef.current.length > 0,
						);
					})
					.catch(() => {
						isLoadingRef.current = false;
					});
			},
			canUndo: () => historyRef.current.length > 1,
			canRedo: () => redoStackRef.current.length > 0,
		clear: () => {
			const canvas = fabricRef.current;
			if (!canvas) return;
			canvas.clear();
			canvas.backgroundColor = darkMode ? "#1a1a1a" : "#ffffff";
			canvas.renderAll();
			saveHistory();
			onChangeRef.current?.();
		},
			forceSave: () => {
				const canvas = fabricRef.current;
				if (!canvas || isLoadingRef.current) return;
				const json = snapshotCanvas(canvas);
				historyRef.current.push(json);
				redoStackRef.current = [];
				if (historyRef.current.length > 50) historyRef.current.shift();
				onHistoryChangeRef.current?.(historyRef.current.length > 1, false);
				onChangeRef.current?.();
			},
			flushEditing: () => {
				const canvas = fabricRef.current;
				if (!canvas) return;
				for (const o of canvas.getObjects()) {
					const rec = o as unknown as {
						isEditing?: boolean;
						exitEditing?: () => void;
					};
					if (rec.isEditing && rec.exitEditing) rec.exitEditing();
				}
			},
			isLoading: () => isLoadingRef.current,
			snapshotImage: () => {
				const canvas = fabricRef.current;
				if (!canvas) return null;
				try {
					return canvas.toDataURL({ format: "png", multiplier: 2 });
				} catch {
					return null;
				}
			},
		capturePage: async (json) => {
			const canvas = fabricRef.current;
			if (!canvas) return null;
			const prevSnapshot = snapshotCanvas(canvas);
			const prevHistory = [...historyRef.current];
			const prevRedo = [...redoStackRef.current];
			isLoadingRef.current = true;
			try {
				await canvas.loadFromJSON(json);
				canvas.renderAll();
				return canvas.toDataURL({ format: "png", multiplier: 2 });
			} catch {
				return null;
			} finally {
				try {
					await canvas.loadFromJSON(JSON.parse(prevSnapshot));
					canvas.renderAll();
				} finally {
					isLoadingRef.current = false;
				}
				historyRef.current = prevHistory;
				redoStackRef.current = prevRedo;
				onHistoryChangeRef.current?.(
					prevHistory.length > 1,
					prevRedo.length > 0,
				);
			}
		},
		getCanvasElement: () => canvasElRef.current,
	}));

		const resetDragTracking = useCallback(() => {
			lastPosRef.current.clear();
		}, []);

		const syncHandleVisibility = useCallback((selected?: FabricObject[]) => {
			const canvas = fabricRef.current;
			if (!canvas) return;
			const ids = new Set<string>();
			const collect = (o?: FabricObject) => {
				if (!o) return;
				const r = o as unknown as Record<string, unknown>;
				if (typeof r["arrowId"] === "string") ids.add(r["arrowId"] as string);
				const kids =
					(o as unknown as { getObjects?: () => FabricObject[] }).getObjects?.() ??
					[];
				for (const k of kids) {
					const kr = k as unknown as Record<string, unknown>;
					if (typeof kr["arrowId"] === "string")
						ids.add(kr["arrowId"] as string);
				}
			};
			for (const o of selected ?? []) collect(o);
			let changed = false;
			for (const o of canvas.getObjects()) {
				const r = o as unknown as Record<string, unknown>;
				const link =
					(r["handleFor"] ??
					(r["pointIndex"] != null ? r["arrowId"] : undefined)) as
					| string
					| undefined;
				if (typeof link === "string") {
					const vis = ids.has(link);
					if (((o as FabricObject).visible ?? true) !== vis) {
						o.set({ visible: vis });
						changed = true;
					}
				}
			}
			if (changed) canvas.renderAll();
		}, []);

		const handleObjectMoving = useCallback(
			(opt: { target?: FabricObject; e: Event }) => {
				const canvas = fabricRef.current;
				if (!canvas || isLoadingRef.current) return;
				const target = opt.target;
				if (!target) return;
				const rec = target as unknown as Record<string, unknown>;

				// Arrow point dot: reshape the shaft around the dragged point.
				// The dot itself stays exactly where the user put it (no fight).
				const pointIndex = rec["pointIndex"] as number | undefined;
				const dotArrowId = rec["arrowId"] as string | undefined;
				if (pointIndex != null && dotArrowId) {
					const { shaft, head, dots } = findArrowParts(canvas, dotArrowId);
					if (!shaft || !head || dots.length === 0) return;
					reshapeArrow(shaft, head, dots);
					canvas.renderAll();
					debouncedSave();
					return;
				}

				// Linked parts (arrow shafts, sticky bg/text): drag them together.
				const linkId = (rec["arrowId"] ?? rec["stickyPart"]) as
					| string
					| undefined;
				if (!linkId || rec["isSticky"] === true) return;
				const key = `link:${linkId}`;
				const cur = {
					left: (target as FabricObject).left ?? 0,
					top: (target as FabricObject).top ?? 0,
				};
				const last = lastPosRef.current.get(key);
				if (last) {
					const dx = cur.left - last.left;
					const dy = cur.top - last.top;
					if (dx !== 0 || dy !== 0) {
						for (const o of canvas.getObjects()) {
							if (o === target) continue;
							const r = o as unknown as Record<string, unknown>;
							if (
								r["arrowId"] === linkId ||
								r["stickyPart"] === linkId ||
								r["handleFor"] === linkId
							) {
								o.set({
									left: (o.left ?? 0) + dx,
									top: (o.top ?? 0) + dy,
								});
								o.setCoords();
							}
						}
					}
				}
				lastPosRef.current.set(key, cur);
			},
			[debouncedSave],
		);

		const handleObjectModified = useCallback(() => {
			// All part coordinates are absolute, so a transform only needs saving.
			if (!fabricRef.current || isLoadingRef.current) return;
			forceSaveRef.current();
		}, []);

		const handleStickyDblClick = useCallback(
			(opt: { target?: FabricObject }) => {
				const canvas = fabricRef.current;
				if (!canvas || isLoadingRef.current) return;
				const target = opt.target as unknown as
					| Record<string, unknown>
					| undefined;
				if (!target) return;
				const stickyId = target["stickyPart"] as string | undefined;
				if (!stickyId) return;
				const tb = findStickyParts(canvas, stickyId).find((o) =>
					((o as FabricObject).type ?? "").includes("text"),
				) as Textbox | undefined;
				if (!tb) return;
				canvas.setActiveObject(tb);
				tb.enterEditing();
				tb.selectAll();
				canvas.renderAll();
			},
			[],
		);

		// biome-ignore lint/correctness/useExhaustiveDependencies: init only once
		useEffect(() => {
			if (!canvasElRef.current || !containerRef.current) return;
			const container = containerRef.current;
			const w = container.clientWidth;
			const h = container.clientHeight;
		const canvas = new Canvas(canvasElRef.current, {
			width: w,
			height: h,
			backgroundColor: darkMode ? "#1a1a1a" : "#ffffff",
			selection: true,
		});
			fabricRef.current = canvas;

			const handleResize = () => {
				canvas.setDimensions({
					width: container.clientWidth,
					height: container.clientHeight,
				});
				canvas.renderAll();
			};
			const resizeObserver = new ResizeObserver(handleResize);
			resizeObserver.observe(container);
			canvas.on("object:moving", handleObjectMoving);
			canvas.on("object:modified", handleObjectModified);
			canvas.on("mouse:dblclick", handleStickyDblClick);
			canvas.on("selection:created", (opt) =>
				syncHandleVisibility(opt.selected),
			);
			canvas.on("selection:updated", (opt) =>
				syncHandleVisibility(opt.selected),
			);
			canvas.on("selection:cleared", () => syncHandleVisibility(undefined));
			saveHistory();
			initializedRef.current = true;
			return () => {
				resizeObserver.disconnect();
				canvas.dispose();
				fabricRef.current = null;
				initializedRef.current = false;
			};
		}, []);

		useEffect(() => {
			const canvas = fabricRef.current;
			if (!canvas || !initializedRef.current) return;
			canvas.backgroundColor = darkMode ? "#1a1a1a" : "#ffffff";
			canvas.renderAll();
		}, [darkMode]);

		// Load page JSON on page switch, or clear canvas for new pages
		useEffect(() => {
			const canvas = fabricRef.current;
			if (!canvas || !initializedRef.current) return;

			const hasData = pageJson && Object.keys(pageJson).length > 0;

			if (pageKey !== lastLoadedPageKeyRef.current) {
				lastLoadedPageKeyRef.current = pageKey ?? 0;
				resetDragTracking();
				canvas.discardActiveObject();
				if (hasData) {
					isLoadingRef.current = true;
					historyRef.current = [];
					redoStackRef.current = [];
					canvas.loadFromJSON(pageJson)
						.then(() => {
							canvas.renderAll();
							styleCanvasObjects(canvas);
							migrateAndWireStickies(canvas);
						migrateLegacyArrows(canvas);
							historyRef.current.push(snapshotCanvas(canvas));
							isLoadingRef.current = false;
							onHistoryChangeRef.current?.(false, false);
						})
						.catch(() => {
							isLoadingRef.current = false;
						});
			} else {
				canvas.clear();
				canvas.backgroundColor = darkMode ? "#1a1a1a" : "#ffffff";
				canvas.renderAll();
				historyRef.current = [];
				redoStackRef.current = [];
				historyRef.current.push(snapshotCanvas(canvas));
				onHistoryChangeRef.current?.(false, false);
			}
			}
		}, [pageJson, pageKey]);

		const resetCursorToSelect = () => {
			const canvas = fabricRef.current;
			if (!canvas) return;
			canvas.defaultCursor = "default";
			canvas.hoverCursor = "move";
		};

		// biome-ignore lint/correctness/useExhaustiveDependencies: refs handle updates
		useEffect(() => {
			const canvas = fabricRef.current;
			if (!canvas || !initializedRef.current) return;

			const currentTool = toolRef.current;
			const currentStrokeColor = strokeColorRef.current;
			const currentFillColor = fillColorRef.current;
			const currentStrokeWidth = strokeWidthRef.current;

			canvas.isDrawingMode = false;
			canvas.selection = true;
			canvas.defaultCursor = "default";
			canvas.hoverCursor = "default";
			canvas.off("mouse:down");
			canvas.off("mouse:move");
			canvas.off("mouse:up");
			canvas.off("path:created");

			if (!isDrawingRef.current && drawingShapeRef.current) {
				canvas.remove(drawingShapeRef.current);
				drawingShapeRef.current = null;
			}
			if (!isDrawingRef.current && arrowHeadRef.current) {
				canvas.remove(arrowHeadRef.current);
				arrowHeadRef.current = null;
			}
			shapeStartRef.current = null;

			switch (currentTool) {
				case "select": {
					canvas.selection = true;
					canvas.defaultCursor = "default";
					canvas.hoverCursor = "move";
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
						const path = (
							e as unknown as { path?: FabricObject }
						).path;
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
					const pointer = canvas.getScenePoint(opt.e);
						shapeStartRef.current = { x: pointer.x, y: pointer.y };
						isDrawingRef.current = true;
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
						const startX = shapeStartRef.current.x;
						const startY = shapeStartRef.current.y;
						const rect = drawingShapeRef.current as Rect;
						const w = pointer.x - startX;
						const h = pointer.y - startY;
						rect.set({
							left: w < 0 ? pointer.x : startX,
							top: h < 0 ? pointer.y : startY,
							width: Math.abs(w),
							height: Math.abs(h),
						});
						canvas.renderAll();
					});
					canvas.on("mouse:up", () => {
						if (drawingShapeRef.current) {
							const obj = drawingShapeRef.current;
							const w = obj.width ?? 0;
							const h = obj.height ?? 0;
							if (w < MIN_SHAPE_SIZE && h < MIN_SHAPE_SIZE) {
								canvas.remove(obj);
							} else {
								obj.set({ selectable: true });
								applyControlStyle(obj);
								canvas.setActiveObject(obj);
							}
							drawingShapeRef.current = null;
							shapeStartRef.current = null;
							isDrawingRef.current = false;
							canvas.selection = false;
							resetCursorToSelect();
							debouncedSave();
							onChangeRef.current?.();
							selectAfterCreate();
						}
					});
					break;
				}
			case "circle": {
				canvas.selection = false;
				canvas.defaultCursor = "crosshair";
				canvas.on("mouse:down", (opt) => {
					const pointer = canvas.getScenePoint(opt.e);
						shapeStartRef.current = { x: pointer.x, y: pointer.y };
						isDrawingRef.current = true;
						const circle = new Circle({
							left: pointer.x,
							top: pointer.y,
							radius: 0,
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
						canvas.add(circle);
						drawingShapeRef.current = circle;
					});
					canvas.on("mouse:move", (opt) => {
						if (!shapeStartRef.current || !drawingShapeRef.current) return;
						const pointer = canvas.getScenePoint(opt.e);
						const startX = shapeStartRef.current.x;
						const startY = shapeStartRef.current.y;
						const radius =
							Math.sqrt(
								(pointer.x - startX) ** 2 +
									(pointer.y - startY) ** 2,
							) / 2;
						const circle = drawingShapeRef.current as Circle;
						circle.set({
							left: Math.min(startX, pointer.x),
							top: Math.min(startY, pointer.y),
							radius,
						});
						canvas.renderAll();
					});
					canvas.on("mouse:up", () => {
						if (drawingShapeRef.current) {
							const obj = drawingShapeRef.current;
							const r = (obj as Circle).radius ?? 0;
							if (r < MIN_SHAPE_SIZE / 2) {
								canvas.remove(obj);
							} else {
								obj.set({ selectable: true });
								applyControlStyle(obj);
								canvas.setActiveObject(obj);
							}
							drawingShapeRef.current = null;
							shapeStartRef.current = null;
							isDrawingRef.current = false;
							canvas.selection = false;
							resetCursorToSelect();
							debouncedSave();
							onChangeRef.current?.();
							selectAfterCreate();
						}
					});
					break;
				}
			case "line": {
				canvas.selection = false;
				canvas.defaultCursor = "crosshair";
				canvas.on("mouse:down", (opt) => {
					const pointer = canvas.getScenePoint(opt.e);
						shapeStartRef.current = { x: pointer.x, y: pointer.y };
						isDrawingRef.current = true;
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
						const line = drawingShapeRef.current as Line;
						line.set({ x2: pointer.x, y2: pointer.y });
						canvas.renderAll();
					});
					canvas.on("mouse:up", () => {
						if (drawingShapeRef.current) {
							const obj = drawingShapeRef.current;
							const line = obj as Line;
							const dx = (line.x2 ?? 0) - (line.x1 ?? 0);
							const dy = (line.y2 ?? 0) - (line.y1 ?? 0);
							if (Math.sqrt(dx * dx + dy * dy) < MIN_SHAPE_SIZE) {
								canvas.remove(obj);
							} else {
								obj.set({ selectable: true });
								applyControlStyle(obj);
								canvas.setActiveObject(obj);
							}
							drawingShapeRef.current = null;
							shapeStartRef.current = null;
							isDrawingRef.current = false;
							canvas.selection = false;
							resetCursorToSelect();
							debouncedSave();
							onChangeRef.current?.();
							selectAfterCreate();
						}
					});
					break;
				}
			case "arrow": {
				canvas.selection = false;
				canvas.defaultCursor = "crosshair";
				canvas.on("mouse:down", (opt) => {
					const pointer = canvas.getScenePoint(opt.e);
						shapeStartRef.current = { x: pointer.x, y: pointer.y };
						isDrawingRef.current = true;
						const line = new Line(
							[pointer.x, pointer.y, pointer.x, pointer.y],
							{
								stroke: currentStrokeColor,
								strokeWidth: currentStrokeWidth,
								selectable: false,
								evented: false,
							},
						);
						const headSize = 10 + currentStrokeWidth * 2;
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
						if (!shapeStartRef.current || !drawingShapeRef.current) return;
						const header = arrowHeadRef.current as Triangle | null;
						if (!header) return;
						const pointer = canvas.getScenePoint(opt.e);
						const line = drawingShapeRef.current as Line;
						line.set({ x2: pointer.x, y2: pointer.y });
						const startX = shapeStartRef.current.x;
						const startY = shapeStartRef.current.y;
						placeHead(
							header,
							pointer.x,
							pointer.y,
							startX,
							startY,
							10 + currentStrokeWidth * 2,
						);
						canvas.renderAll();
					});
					canvas.on("mouse:up", () => {
						const lineObj = drawingShapeRef.current as Line | null;
						const headObj = arrowHeadRef.current as Triangle | null;
						drawingShapeRef.current = null;
						arrowHeadRef.current = null;
						shapeStartRef.current = null;
						isDrawingRef.current = false;
						if (lineObj && headObj) {
							const x1 = lineObj.x1 ?? 0;
							const y1 = lineObj.y1 ?? 0;
							const x2 = lineObj.x2 ?? 0;
							const y2 = lineObj.y2 ?? 0;
							const dx = x2 - x1;
							const dy = y2 - y1;
							canvas.remove(lineObj, headObj);
							if (Math.sqrt(dx * dx + dy * dy) >= MIN_SHAPE_SIZE) {
								const arrowId = uid();
								const { shaft, head, dots } = createArrowParts(
									{ x1, y1, x2, y2, bend: 0 },
									{
										stroke: currentStrokeColor,
										strokeWidth: currentStrokeWidth,
									},
									arrowId,
								);
								canvas.add(shaft, head, ...dots);
								for (const d of dots) {
									d.set({ visible: true });
									canvas.bringObjectToFront(d);
								}
								canvas.setActiveObject(shaft);
								lastPosRef.current.set(`link:${arrowId}`, {
									left: shaft.left ?? 0,
									top: shaft.top ?? 0,
								});
							}
							canvas.selection = false;
							resetCursorToSelect();
							debouncedSave();
							onChangeRef.current?.();
							selectAfterCreate();
						}
					});
					break;
				}
			case "text": {
				canvas.selection = false;
				canvas.defaultCursor = "text";
				canvas.on("mouse:down", async (opt) => {
					await waitForFonts();
						const pointer = canvas.getScenePoint(opt.e);
						const text = new Textbox("Text", {
							left: pointer.x,
							top: pointer.y,
							fontSize: 16,
							fontFamily: fontFamilyRef.current ?? "Inter",
							fill: currentStrokeColor,
							width: 200,
							editable: true,
							originX: "left",
							originY: "top",
							fontWeight: fontBoldRef.current
								? "bold"
								: "normal",
							fontStyle: fontItalicRef.current
								? "italic"
								: "normal",
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
					await waitForFonts();
						const pointer = canvas.getScenePoint(opt.e);
						const stickyColor =
							currentFillColor === "transparent"
								? DEFAULT_STICKY_COLOR
								: currentFillColor;
						const { bg, text, id } = createStickyNote(
							pointer.x,
							pointer.y,
							stickyColor,
							{
								family: fontFamilyRef.current ?? "Inter",
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
						lastPosRef.current.set(`link:${id}`, {
							left: text.left ?? 0,
							top: text.top ?? 0,
						});
						canvas.renderAll();
						debouncedSave();
						onChangeRef.current?.();
						selectAfterCreate();
					});
					break;
				}
				case "eraser": {
					canvas.selection = false;
					const eraserCursorValue = eraserCursor();
					canvas.defaultCursor = eraserCursorValue;
					canvas.hoverCursor = eraserCursorValue;
					canvas.on("mouse:down", (opt) => {
						const target = opt.target as unknown as Record<
							string,
							unknown
						> | null;
						if (!target) return;
						const toRemove = new Set<FabricObject>([
							target as unknown as FabricObject,
						]);
						const linkId = (target["arrowId"] ??
							target["handleFor"] ??
							target["stickyPart"]) as string | undefined;
						if (linkId) {
							for (const o of canvas.getObjects()) {
								const r = o as unknown as Record<string, unknown>;
								if (
									r["arrowId"] === linkId ||
									r["handleFor"] === linkId ||
									(r["stickyPart"] === linkId && r["isSticky"] !== true)
								) {
									toRemove.add(o);
								}
							}
						}
						for (const obj of toRemove) canvas.remove(obj);
						canvas.renderAll();
						debouncedSave();
						onChangeRef.current?.();
					});
					break;
				}
			}

			canvas.renderAll();
		}, [tool, strokeColor, fillColor, strokeWidth, debouncedSave]);

		return (
			<div ref={containerRef} className="fabric-canvas-container">
				<canvas ref={canvasElRef} />
			</div>
		);
	},
);

FabricCanvas.displayName = "FabricCanvas";
export default FabricCanvas;
