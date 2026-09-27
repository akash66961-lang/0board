"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportPdf from "../components/ExportPdf";
import type { FabricCanvasAPI, Tool } from "../components/FabricCanvas";
import type { Page } from "../components/PageSidebar";
import PageSidebar from "../components/PageSidebar";
import RecordingControls from "../components/RecordingControls";
import Toolbar from "../components/Toolbar";

const FabricCanvas = dynamic(() => import("../components/FabricCanvas"), {
	ssr: false,
	loading: () => (
		<div className="fabric-canvas-container">
			<div className="fabric-canvas-loading">Loading canvas...</div>
		</div>
	),
});

const STORAGE_KEY = "0board-pages";

function generateId() {
	return Math.random().toString(36).slice(2, 10);
}

function loadPages(): Page[] {
	if (typeof window === "undefined")
		return [{ id: generateId(), name: "Page 1", json: {} }];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed) && parsed.length > 0) return parsed;
		}
	} catch {}
	return [{ id: generateId(), name: "Page 1", json: {} }];
}

function savePages(pages: Page[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
	} catch {}
}

export default function WhiteboardPage() {
	const [pages, setPages] = useState<Page[]>([]);
	const [activePageIndex, setActivePageIndex] = useState(0);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [pageKey, setPageKey] = useState(0);

	const [activeTool, setActiveTool] = useState<Tool>("select");
	const [strokeColor, setStrokeColor] = useState("#000000");
	const [fillColor, setFillColor] = useState("transparent");
	const [strokeWidth, setStrokeWidth] = useState(2);
	const [fontFamily, setFontFamily] = useState("Inter");
	const [fontBold, setFontBold] = useState(false);
	const [fontItalic, setFontItalic] = useState(false);
	const [fontUnderline, setFontUnderline] = useState(false);
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);
	const [darkMode, setDarkMode] = useState(false);

	const canvasRef = useRef<FabricCanvasAPI | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setPages(loadPages());
		setLoaded(true);
	}, []);

	useEffect(() => {
		if (loaded) {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => savePages(pages), 500);
		}
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		};
	}, [pages, loaded]);

	const activePageIndexRef = useRef(0);

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

	const handleCanvasChange = saveCurrentPageToState;
	const forceCurrentPageSave = saveCurrentPageToState;

	const handleHistoryChange = useCallback((uc: boolean, rc: boolean) => {
		setCanUndo(uc);
		setCanRedo(rc);
	}, []);

	const handleAddPage = useCallback(() => {
		canvasRef.current?.flushEditing();
		forceCurrentPageSave();
		let maxNum = 0;
		for (const p of pages) {
			const match = p.name.match(/^Page (\d+)$/);
			if (match) maxNum = Math.max(maxNum, Number(match[1]));
		}
		const newPage: Page = {
			id: generateId(),
			name: `Page ${maxNum + 1}`,
			json: {},
		};
		setPages((prev) => [...prev, newPage]);
		goToPage(pages.length);
		setPageKey((k) => k + 1);
	}, [pages, forceCurrentPageSave, goToPage]);

	const handleDeletePage = useCallback(
		(index: number) => {
			if (pages.length <= 1) return;
			canvasRef.current?.flushEditing();
			forceCurrentPageSave();
			setPages((prev) => {
				const next = prev.filter((_, i) => i !== index);
				return next.map((p, i) => ({ ...p, name: `Page ${i + 1}` }));
			});
			const cur = activePageIndexRef.current;
			if (index < cur) goToPage(cur - 1);
			else if (index === cur) goToPage(Math.min(cur, pages.length - 2));
			setPageKey((k) => k + 1);
		},
		[pages.length, forceCurrentPageSave, goToPage],
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
			forceCurrentPageSave();
			goToPage(index);
			setPageKey((k) => k + 1);
		},
		[forceCurrentPageSave, goToPage],
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

			if (e.key === "v" || e.key === "V") setActiveTool("select");
			else if (e.key === "d" || e.key === "D") setActiveTool("draw");
			else if (e.key === "h" || e.key === "H") setActiveTool("highlighter");
			else if (e.key === "r" || e.key === "R") setActiveTool("rect");
			else if (e.key === "c" || e.key === "C") setActiveTool("circle");
			else if (e.key === "l" || e.key === "L") setActiveTool("line");
			else if (e.key === "a" || e.key === "A") setActiveTool("arrow");
			else if (e.key === "t" || e.key === "T") setActiveTool("text");
			else if (e.key === "s" || e.key === "S") setActiveTool("sticky");
			else if (e.key === "e" || e.key === "E") setActiveTool("eraser");
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

	if (!loaded) return null;

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
						onChange={handleCanvasChange}
						onHistoryChange={handleHistoryChange}
						onToolChange={setActiveTool}
						tool={activeTool}
						strokeColor={strokeColor}
						fillColor={fillColor}
						strokeWidth={strokeWidth}
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
