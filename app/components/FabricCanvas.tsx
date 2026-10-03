"use client";

import {
	Canvas,
	type FabricObject,
	Textbox,
} from "fabric";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import {
	canRedo,
	canUndo,
	createHistory,
	pushHistory,
	redoHistory,
	resetHistory,
	undoHistory,
	type HistoryStack,
} from "../lib/canvasHistory";
import {
	applyControlStyle,
	findArrowParts,
	findStickyParts,
	linkIdOf,
	normalizeLoadedCanvas,
	syncArrowHandleVisibility,
} from "../lib/canvasState";
import { reshapeArrow } from "../lib/diagramArrows";
import {
	backgroundFor,
	canvasToJSON,
	DEFAULT_ERASER_SIZE,
	FONT_LOAD_TIMEOUT,
	HISTORY_DEBOUNCE_MS,
	HISTORY_LIMIT,
	snapshotCanvas,
} from "../lib/diagramConstants";
import type {
	FabricCanvasAPI,
	Point,
	Tool,
} from "../lib/diagramTypes";
import { rebindTool } from "../lib/toolBindings";

export type { FabricCanvasAPI, Tool };

interface FabricCanvasProps {
	onChange?: () => void;
	onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
	tool: Tool;
	strokeColor: string;
	fillColor: string;
	strokeWidth: number;
	eraserSize?: number;
	fontFamily?: string;
	fontBold?: boolean;
	fontItalic?: boolean;
	fontUnderline?: boolean;
	pageJson?: Record<string, unknown>;
	pageKey?: number;
	onToolChange?: (tool: Tool) => void;
	darkMode?: boolean;
}

const FabricCanvas = forwardRef<FabricCanvasAPI, FabricCanvasProps>(
	(
	{
		onChange,
		onHistoryChange,
		tool,
		strokeColor,
		fillColor,
		strokeWidth,
		eraserSize = DEFAULT_ERASER_SIZE,
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
	const historyRef = useRef<HistoryStack>(createHistory(HISTORY_LIMIT));
	const isLoadingRef = useRef(false);
	const drawingShapeRef = useRef<FabricObject | null>(null);
	const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
	const initializedRef = useRef(false);
	const fontLoadedRef = useRef(false);
	const lastLoadedPageKeyRef = useRef<number>(-1);
	const arrowHeadRef = useRef<FabricObject | null>(null);
	/** Eraser stroke state, so a drag erases continuously. */
	const isErasingRef = useRef(false);
	const lastErasePointRef = useRef<Point | null>(null);
	/** Objects the current stroke clipped, settled when the stroke ends. */
	const eraseTouchedRef = useRef<Set<FabricObject>>(new Set());
	/** Live stroke finaliser, so a tool switch cannot abandon a half stroke. */
	const finishEraseStrokeRef = useRef<(() => void) | null>(null);
	/** Where every object sat before the drag, so linked parts move as one. */
	const dragSeedsRef = useRef(
		new Map<FabricObject, { left: number; top: number }>(),
	);

	const toolRef = useRef(tool);
	toolRef.current = tool;
	const strokeColorRef = useRef(strokeColor);
	strokeColorRef.current = strokeColor;
	const fillColorRef = useRef(fillColor);
	fillColorRef.current = fillColor;
	const strokeWidthRef = useRef(strokeWidth);
	strokeWidthRef.current = strokeWidth;
	const eraserSizeRef = useRef(eraserSize);
	eraserSizeRef.current = eraserSize;
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
		/** Tool the handlers were last bound for, to detect real switches. */
		const lastToolRef = useRef<Tool | null>(null);

		const selectAfterCreate = useCallback(() => {
			onToolChangeRef.current?.("select");
		}, []);

		const notifyHistory = useCallback(() => {
			onHistoryChangeRef.current?.(
				canUndo(historyRef.current),
				canRedo(historyRef.current),
			);
		}, []);

		const debouncedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(
			null,
		);

		/** Drop a queued coalesced commit without recording it. */
		const cancelPendingSave = useCallback(() => {
			if (debouncedSaveRef.current) {
				clearTimeout(debouncedSaveRef.current);
				debouncedSaveRef.current = null;
			}
		}, []);

		/**
		 * Push the current canvas onto the undo stack. The single
		 * save path, so drawing, modifying, undo, redo and clear can
		 * never record history differently.
		 */
		const commitSnapshot = useCallback(
			(notifyChange = false) => {
				// An immediate commit supersedes the queued one; without this a
				// drag would record a duplicate snapshot whose undo looks dead.
				cancelPendingSave();
				const canvas = fabricRef.current;
				if (!canvas || isLoadingRef.current) return;
				pushHistory(historyRef.current, snapshotCanvas(canvas));
				notifyHistory();
				if (notifyChange) onChangeRef.current?.();
			},
			[cancelPendingSave, notifyHistory],
		);

		const debouncedSave = useCallback(() => {
			if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
			debouncedSaveRef.current = setTimeout(() => {
				debouncedSaveRef.current = null;
				commitSnapshot(true);
			}, HISTORY_DEBOUNCE_MS);
		}, [commitSnapshot]);

		/** Record a queued edit right now (undo/redo/load must see it). */
		const flushPendingSave = useCallback(() => {
			if (!debouncedSaveRef.current) return;
			cancelPendingSave();
			commitSnapshot(true);
		}, [cancelPendingSave, commitSnapshot]);

		/** Leave live text editing, which re-flows while its object changes. */
		const stopEditing = useCallback(() => {
			const canvas = fabricRef.current;
			if (!canvas) return;
			for (const object of canvas.getObjects()) {
				const record = object as unknown as {
					isEditing?: boolean;
					exitEditing?: () => void;
				};
				if (record.isEditing && record.exitEditing) record.exitEditing();
			}
		}, []);

		/** Undo the world cursor, which shape tools turn into crosshairs. */
		const resetCursorToSelect = () => {
			const canvas = fabricRef.current;
			if (!canvas) return;
			canvas.defaultCursor = "default";
			canvas.hoverCursor = "move";
		};

		/**
		 * Drop a shape that is still being dragged out. Handlers are torn
		 * down on every tool switch, so without this a mid-drag switch would
		 * strand an unselectable half shape on the canvas forever.
		 */
		const abortShapeDraft = useCallback(() => {
			const canvas = fabricRef.current;
			const parts: FabricObject[] = [];
			if (drawingShapeRef.current) parts.push(drawingShapeRef.current);
			if (arrowHeadRef.current) parts.push(arrowHeadRef.current);
			if (canvas && parts.length > 0) {
				canvas.remove(...parts);
				canvas.renderAll();
			}
			drawingShapeRef.current = null;
			arrowHeadRef.current = null;
			shapeStartRef.current = null;
		}, []);

		/**
		 * Common mouse-up for shape drafts: accidental clicks are dropped
		 * without a history entry (a duplicate snapshot would make the next
		 * undo appear to do nothing), real shapes become the selection.
		 */
		const endShapeDraft = (acceptable: boolean) => {
			const canvas = fabricRef.current;
			const obj = drawingShapeRef.current;
			drawingShapeRef.current = null;
			arrowHeadRef.current = null;
			shapeStartRef.current = null;
			if (!canvas || !obj) return;
			canvas.selection = false;
			resetCursorToSelect();
			// The page swapped underneath the drag; the load owns the canvas now.
			if (isLoadingRef.current) return;
			if (acceptable) {
				obj.set({ selectable: true });
				applyControlStyle(obj);
				canvas.setActiveObject(obj);
				debouncedSave();
				onChangeRef.current?.();
			} else {
				canvas.remove(obj);
			}
			selectAfterCreate();
			canvas.renderAll();
		};

		const resetDragTracking = useCallback(() => {
			dragSeedsRef.current.clear();
		}, []);

		/**
		 * Snapshot where everything sits just before a drag starts. Linked
		 * parts then move as exact offsets of this baseline — re-seeded on
		 * every press — instead of chasing each other's previous position,
		 * which used to drift after undo and jump sticky text off its note.
		 */
		const seedDragPositions = useCallback((canvas: Canvas) => {
			const seeds = new Map<FabricObject, { left: number; top: number }>();
			for (const object of canvas.getObjects()) {
				seeds.set(object, {
					left: object.left ?? 0,
					top: object.top ?? 0,
				});
			}
			dragSeedsRef.current = seeds;
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
		undo: () => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return;
			// Settle whatever is mid-flight: an erase stroke or a half shape
			// predates this undo, and a queued commit must not land after it.
			finishEraseStrokeRef.current?.();
			abortShapeDraft();
			flushPendingSave();
			const previous = undoHistory(historyRef.current);
			if (previous === null) return;
			isLoadingRef.current = true;
			canvas
				.loadFromJSON(previous)
				.then(() => {
					normalizeLoadedCanvas(canvas);
					resetDragTracking();
					isLoadingRef.current = false;
					onChangeRef.current?.();
					notifyHistory();
				})
				.catch(() => {
					isLoadingRef.current = false;
				});
		},
		redo: () => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return;
			finishEraseStrokeRef.current?.();
			abortShapeDraft();
			flushPendingSave();
			const next = redoHistory(historyRef.current);
			if (next === null) return;
			isLoadingRef.current = true;
			canvas
				.loadFromJSON(next)
				.then(() => {
					normalizeLoadedCanvas(canvas);
					resetDragTracking();
					isLoadingRef.current = false;
					onChangeRef.current?.();
					notifyHistory();
				})
				.catch(() => {
					isLoadingRef.current = false;
				});
		},
		clear: () => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return;
			finishEraseStrokeRef.current?.();
			abortShapeDraft();
			flushPendingSave();
			canvas.clear();
			canvas.backgroundColor = backgroundFor(darkMode);
			canvas.renderAll();
			commitSnapshot(true);
		},
		deleteSelection: () => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return;
			const active = canvas.getActiveObjects();
			if (active.length === 0) return;
			stopEditing();
			// Deleting one part must delete its whole linked construct, or an
			// arrow head or sticky background would be left stranded behind.
			const links = new Set(
				active
					.map(linkIdOf)
					.filter((id): id is string => id !== undefined),
			);
			const doomed = new Set<FabricObject>(active);
			if (links.size > 0) {
				for (const object of canvas.getObjects()) {
					const id = linkIdOf(object);
					if (id !== undefined && links.has(id)) doomed.add(object);
				}
			}
			canvas.discardActiveObject();
			canvas.remove(...doomed);
			canvas.renderAll();
			commitSnapshot(true);
		},
		flushEditing: () => {
			stopEditing();
		},
			isLoading: () => isLoadingRef.current,
			snapshotImage: () => {
				const canvas = fabricRef.current;
				if (!canvas) return null;
				// Arrow dots are selection UI; keep them out of the export but
				// restore the user's selection afterwards.
				const selected = canvas.getActiveObjects();
				syncArrowHandleVisibility(canvas, []);
				try {
					return canvas.toDataURL({ format: "png", multiplier: 2 });
				} catch {
					return null;
				} finally {
					syncArrowHandleVisibility(canvas, selected);
				}
			},
		capturePage: async (json) => {
			const canvas = fabricRef.current;
			if (!canvas || isLoadingRef.current) return null;
			// A commit queued right now would be swallowed by the load below.
			flushPendingSave();
			const prevSnapshot = snapshotCanvas(canvas);
			const prevHistory = [...historyRef.current.undoStack];
			const prevRedo = [...historyRef.current.redoStack];
			isLoadingRef.current = true;
			try {
				await canvas.loadFromJSON(json);
				normalizeLoadedCanvas(canvas);
				return canvas.toDataURL({ format: "png", multiplier: 2 });
			} catch {
				return null;
			} finally {
				try {
					await canvas.loadFromJSON(JSON.parse(prevSnapshot));
					normalizeLoadedCanvas(canvas);
				} finally {
					isLoadingRef.current = false;
				}
				historyRef.current.undoStack = prevHistory;
				historyRef.current.redoStack = prevRedo;
				notifyHistory();
			}
		},
		getCanvasElement: () => canvasElRef.current,
	}));

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

				// Linked parts (arrow shaft/head/dots, sticky bg/text) move by
				// the dragged object's delta from its own pre-drag position.
				const linkId = linkIdOf(target);
				if (!linkId) return;
				const seeds = dragSeedsRef.current;
				const targetSeed = seeds.get(target);
				if (!targetSeed) return;
				const dx = (target.left ?? 0) - targetSeed.left;
				const dy = (target.top ?? 0) - targetSeed.top;
				if (dx === 0 && dy === 0) return;
				for (const object of canvas.getObjects()) {
					if (object === target) continue;
					if (linkIdOf(object) !== linkId) continue;
					const seed = seeds.get(object);
					if (!seed) continue;
					object.set({
						left: seed.left + dx,
						top: seed.top + dy,
					});
					object.setCoords();
				}
			},
			[debouncedSave],
		);

		const handleObjectModified = useCallback(() => {
			// All part coordinates are absolute, so a transform only needs saving.
			if (!fabricRef.current || isLoadingRef.current) return;
			commitSnapshot(true);
		}, [commitSnapshot]);

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
			backgroundColor: backgroundFor(darkMode),
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
				syncArrowHandleVisibility(canvas, opt.selected),
			);
			canvas.on("selection:updated", (opt) =>
				syncArrowHandleVisibility(canvas, opt.selected),
			);
			canvas.on("selection:cleared", () =>
				syncArrowHandleVisibility(canvas),
			);
			commitSnapshot(false);
			initializedRef.current = true;
			return () => {
				// A queued commit would fire against a disposed canvas.
				cancelPendingSave();
				resizeObserver.disconnect();
				canvas.dispose();
				fabricRef.current = null;
				initializedRef.current = false;
			};
		// The canvas is created once and torn down once; the handlers read
		// live values through refs, so re-running on prop changes is wrong.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);

		useEffect(() => {
			const canvas = fabricRef.current;
			if (!canvas || !initializedRef.current) return;
			canvas.backgroundColor = backgroundFor(darkMode);
			canvas.renderAll();
		}, [darkMode]);

		// Load page JSON on page switch, or clear canvas for new pages
		useEffect(() => {
			const canvas = fabricRef.current;
			if (!canvas || !initializedRef.current) return;

			const hasData = pageJson && Object.keys(pageJson).length > 0;

			if (pageKey !== lastLoadedPageKeyRef.current) {
				lastLoadedPageKeyRef.current = pageKey ?? 0;
				// Settle anything in flight before the canvas is swapped out.
				finishEraseStrokeRef.current?.();
				abortShapeDraft();
				cancelPendingSave();
				resetDragTracking();
				canvas.discardActiveObject();
				if (hasData) {
					isLoadingRef.current = true;
					resetHistory(historyRef.current);
					canvas.loadFromJSON(pageJson)
						.then(() => {
							normalizeLoadedCanvas(canvas);
							pushHistory(
								historyRef.current,
								snapshotCanvas(canvas),
							);
							isLoadingRef.current = false;
							notifyHistory();
						})
						.catch(() => {
							isLoadingRef.current = false;
						});
	} else {
			canvas.clear();
			canvas.backgroundColor = backgroundFor(darkMode);
			canvas.renderAll();
			resetHistory(historyRef.current);
				pushHistory(historyRef.current, snapshotCanvas(canvas));
				notifyHistory();
			}
			}
		// Loading a page is driven purely by pageJson and pageKey; darkMode
		// has its own effect and resetDragTracking only clears a cache.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [pageJson, pageKey]);

		// biome-ignore lint/correctness/useExhaustiveDependencies: refs handle updates
		useEffect(() => {
			const canvas = fabricRef.current;
			if (!canvas || !initializedRef.current) return;

			// A tool switch (or colour change) while the nib is down ends the
			// stroke first, so its erased objects and undo entry are settled
			// before the handlers they belong to are torn down.
			finishEraseStrokeRef.current?.();

			const toolChanged = toolRef.current !== lastToolRef.current;
			lastToolRef.current = toolRef.current;
			if (toolChanged) {
				// The old handlers are about to go, so leave nothing behind:
				// exit text editing and discard a half-dragged shape.
				stopEditing();
				abortShapeDraft();
			}

			// All tool and style values reach the handlers as explicit inputs;
			// everything else is read live through the refs in this object.
			rebindTool(
				canvas,
				toolRef.current,
				{
					strokeColor: strokeColorRef.current,
					fillColor: fillColorRef.current,
					strokeWidth: strokeWidthRef.current,
				},
				{
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
				},
			);
		// Font, eraser size and the settle helpers are stable and read
		// current values via refs, so the props above are the only inputs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [tool, strokeColor, fillColor, strokeWidth, eraserSize, debouncedSave]);

		return (
			<div ref={containerRef} className="fabric-canvas-container">
				<canvas ref={canvasElRef} />
			</div>
		);
	},
);

FabricCanvas.displayName = "FabricCanvas";
export default FabricCanvas;
