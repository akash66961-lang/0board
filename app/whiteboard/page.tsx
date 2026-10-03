"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import ExportPdf from "../components/ExportPdf";
import type { FabricCanvasAPI, Tool } from "../components/FabricCanvas";
import type { Page } from "../components/PageSidebar";
import PageSidebar from "../components/PageSidebar";
import RecordingControls from "../components/RecordingControls";
import Toolbar from "../components/Toolbar";
import { DEFAULT_ERASER_SIZE, uid } from "../lib/diagramConstants";

const FabricCanvas = dynamic(() => import("../components/FabricCanvas"), {
	ssr: false,
	loading: () => (
		<div className="fabric-canvas-container">
			<div className="fabric-canvas-loading">Loading canvas...</div>
		</div>
	),
});

const STORAGE_KEY = "0board-pages";

/** Single-key tool shortcuts, so the keyboard handler stays a lookup. */
const TOOL_SHORTCUTS: Record<string, Tool> = {
	v: "select",
	d: "draw",
	h: "highlighter",
	r: "rect",
	c: "circle",
	l: "line",
	a: "arrow",
	t: "text",
	s: "sticky",
	e: "eraser",
};

function loadPages(): Page[] {
	if (typeof window === "undefined")
		return [{ id: uid(), name: "Page 1", json: {} }];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed) && parsed.length > 0) return parsed;
		}
	} catch {}
	return [{ id: uid(), name: "Page 1", json: {} }];
}

function savePages(pages: Page[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
	} catch {}
}

/**
 * Hydration is already done when the browser first subscribes, so the store
 * never changes: the subscribe callback simply reports that the client is live.
 */
function subscribeToHydration(onChange: () => void): () => void {
	onChange();
	return () => {};
}

export default function WhiteboardPage() {
	// Pages come from localStorage, so they are read lazily on the client only.
	// Rendering nothing until hydration finishes keeps server markup consistent.
	const hydrated = useSyncExternalStore(
		subscribeToHydration,
		() => true,
		() => false,
	);
	const [pages, setPages] = useState<Page[]>(loadPages);
	const [activePageIndex, setActivePageIndex] = useState(0);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [pageKey, setPageKey] = useState(0);

	const [activeTool, setActiveTool] = useState<Tool>("select");
	const [strokeColor, setStrokeColor] = useState("#000000");
	const [fillColor, setFillColor] = useState("transparent");
	const [strokeWidth, setStrokeWidth] = useState(2);
	const [eraserSize, setEraserSize] = useState(DEFAULT_ERASER_SIZE);
	const [fontFamily, setFontFamily] = useState("Inter");
	const [fontBold, setFontBold] = useState(false);
	const [fontItalic, setFontItalic] = useState(false);
	const [fontUnderline, setFontUnderline] = useState(false);
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);
	const [darkMode, setDarkMode] = useState(false);

	const canvasRef = useRef<FabricCanvasAPI | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Latest committed pages, so an unmount flush never saves stale state. */
	const pagesRef = useRef(pages);
	const activePageIndexRef = useRef(0);

	useEffect(() => {
		pagesRef.current = pages;
	}, [pages]);

	useEffect(() => {
		if (!hydrated) return;
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => savePages(pages), 500);
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		};
	}, [pages, hydrated]);

	/**
	 * The debounced save above must never lose its last batch: a tab close
	 * or refresh is flushed from the live canvas here, and a client-side
	 * unmount falls back to the latest committed state.
	 */
	useEffect(() => {
		const flush = () => {
			const canvas = canvasRef.current;
			let next = pagesRef.current;
			const idx = activePageIndexRef.current;
			if (canvas && !canvas.isLoading() && next[idx]) {
				next = [...next];
				next[idx] = { ...next[idx], json: canvas.getJSON() };
				pagesRef.current = next;
			}
			savePages(next);
		};
		window.addEventListener("pagehide", flush);
		return () => {
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, []);

	const goToPage = useCallback((index: number) => {
		activePageIndexRef.current = index;
		setActivePageIndex(index);
	}, []);

	const saveCurrentPageToState = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || canvas.isLoading()) return;
		const json = canvas.getJSON();
		const idx = activePageIndexRef.current;
		setPages((prev) => {
			if (!prev[idx]) return prev;
			const updated = [...prev];
			updated[idx] = { ...updated[idx], json };
			return updated;
		});
	}, []);

	const handleHistoryChange = useCallback((uc: boolean, rc: boolean) => {
		setCanUndo(uc);
		setCanRedo(rc);
	}, []);

	const handleAddPage = useCallback(() => {
		canvasRef.current?.flushEditing();
		saveCurrentPageToState();
		let maxNum = 0;
		for (const p of pages) {
			const match = p.name.match(/^Page (\d+)$/);
			if (match) maxNum = Math.max(maxNum, Number(match[1]));
		}
		const newPage: Page = {
			id: uid(),
			name: `Page ${maxNum + 1}`,
			json: {},
		};
		setPages((prev) => [...prev, newPage]);
		goToPage(pages.length);
		setPageKey((k) => k + 1);
	}, [pages, saveCurrentPageToState, goToPage]);

	const handleDeletePage = useCallback(
		(index: number) => {
			if (pages.length <= 1) return;
			canvasRef.current?.flushEditing();
			saveCurrentPageToState();
			setPages((prev) => {
				const next = prev.filter((_, i) => i !== index);
				return next.map((p, i) => ({ ...p, name: `Page ${i + 1}` }));
			});
			const cur = activePageIndexRef.current;
			if (index < cur) goToPage(cur - 1);
			else if (index === cur) goToPage(Math.min(cur, pages.length - 2));
			setPageKey((k) => k + 1);
		},
		[pages.length, saveCurrentPageToState, goToPage],
	);

	const handleRenamePage = useCallback((index: number, name: string) => {
		setPages((prev) => {
			const updated = [...prev];
			updated[index] = { ...updated[index], name };
			return updated;
		});
	}, []);

	const handleSelectPage = useCallback(
		(index: number) => {
			canvasRef.current?.flushEditing();
			saveCurrentPageToState();
			goToPage(index);
			setPageKey((k) => k + 1);
		},
		[saveCurrentPageToState, goToPage],
	);

	const handleUndo = useCallback(() => canvasRef.current?.undo(), []);
	const handleRedo = useCallback(() => canvasRef.current?.redo(), []);
	const handleClear = useCallback(() => canvasRef.current?.clear(), []);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			const target = e.target as HTMLElement;
			if (target.isContentEditable) return;

			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				e.preventDefault();
				canvasRef.current?.undo();
				return;
			}
			if (
				(e.metaKey || e.ctrlKey) &&
				(e.key === "y" || (e.key === "z" && e.shiftKey))
			) {
				e.preventDefault();
				canvasRef.current?.redo();
				return;
			}

			// Never steal keys that belong to the browser or OS...
			if (e.ctrlKey || e.metaKey || e.altKey) return;

			// ...but Delete/Backspace removes the selection (and with it every
			// linked part of an arrow or sticky note).
			if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				canvasRef.current?.deleteSelection();
				return;
			}

			const tool = TOOL_SHORTCUTS[e.key.toLowerCase()];
			if (tool) setActiveTool(tool);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleExportPage = useCallback(
		async (pageIndex: number): Promise<string | null> => {
			const canvas = canvasRef.current;
			if (!canvas) return null;
			if (pageIndex === activePageIndexRef.current) {
				return canvas.snapshotImage();
			}
			const target = pages[pageIndex];
			if (!target) return null;
			return canvas.capturePage(target.json);
		},
		[pages],
	);

	const currentPage = useMemo(
		() => pages[activePageIndex],
		[pages, activePageIndex],
	);

	if (!hydrated) return null;

	return (
		<div className="app-layout">
			<PageSidebar
				pages={pages}
				activePageIndex={activePageIndex}
				onSelectPage={handleSelectPage}
				onAddPage={handleAddPage}
				onDeletePage={handleDeletePage}
				onRenamePage={handleRenamePage}
				collapsed={sidebarCollapsed}
				onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
			/>
			<div className="app-main">
				<div className="app-toolbar">
					<span className="app-page-indicator">
						{currentPage?.name || "Untitled"}{" "}
						({activePageIndex + 1}/{pages.length})
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setDarkMode(!darkMode)}
							className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
						>
							{darkMode ? "☀" : "☾"}
						</button>
						<Link
							href="/recordings"
							className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
						>
							Recordings
						</Link>
						<ExportPdf pages={pages} onExportPage={handleExportPage} />
					</div>
				</div>
				<Toolbar
					activeTool={activeTool}
					onToolChange={setActiveTool}
					strokeColor={strokeColor}
					onStrokeColorChange={setStrokeColor}
					fillColor={fillColor}
					onFillColorChange={setFillColor}
					strokeWidth={strokeWidth}
					onStrokeWidthChange={setStrokeWidth}
					eraserSize={eraserSize}
					onEraserSizeChange={setEraserSize}
					fontFamily={fontFamily}
					onFontFamilyChange={setFontFamily}
					fontBold={fontBold}
					onFontBoldChange={setFontBold}
					fontItalic={fontItalic}
					onFontItalicChange={setFontItalic}
					fontUnderline={fontUnderline}
					onFontUnderlineChange={setFontUnderline}
					canUndo={canUndo}
					canRedo={canRedo}
					onUndo={handleUndo}
					onRedo={handleRedo}
					onClear={handleClear}
				/>
				<div className="app-canvas">
					<FabricCanvas
						ref={canvasRef}
						onChange={saveCurrentPageToState}
						onHistoryChange={handleHistoryChange}
						onToolChange={setActiveTool}
						tool={activeTool}
						strokeColor={strokeColor}
						fillColor={fillColor}
						strokeWidth={strokeWidth}
						eraserSize={eraserSize}
						fontFamily={fontFamily}
						fontBold={fontBold}
						fontItalic={fontItalic}
						fontUnderline={fontUnderline}
						pageJson={currentPage?.json}
						pageKey={pageKey}
						darkMode={darkMode}
					/>
					<RecordingControls canvasRef={canvasRef} />
				</div>
			</div>
		</div>
	);
}
