"use client";

import { memo, type ReactNode } from "react";
import { STICKY_COLORS } from "./diagramShapes";
import type { Tool } from "./FabricCanvas";

interface ToolbarProps {
	activeTool: Tool;
	onToolChange: (tool: Tool) => void;
	strokeColor: string;
	onStrokeColorChange: (color: string) => void;
	fillColor: string;
	onFillColorChange: (color: string) => void;
	strokeWidth: number;
	onStrokeWidthChange: (width: number) => void;
	fontFamily: string;
	onFontFamilyChange: (font: string) => void;
	fontBold: boolean;
	onFontBoldChange: (bold: boolean) => void;
	fontItalic: boolean;
	onFontItalicChange: (italic: boolean) => void;
	fontUnderline: boolean;
	onFontUnderlineChange: (underline: boolean) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onClear: () => void;
}

const SelectIcon = (
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="currentColor"
		aria-hidden="true"
	>
		<path
			d="M6 3.2 19.2 12 11.7 13 9.2 20.3 6 3.2Z"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
		/>
	</svg>
);

const EraserIcon = (
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
		<path d="M22 21H7" />
		<path d="m5 11 9 9" />
	</svg>
);

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
	{ id: "select", label: "Select (V)", icon: SelectIcon },
	{ id: "draw", label: "Draw (D)", icon: "✎" },
	{ id: "highlighter", label: "Highlighter (H)", icon: "🖍" },
	{ id: "rect", label: "Rectangle (R)", icon: "□" },
	{ id: "circle", label: "Circle (C)", icon: "○" },
	{ id: "line", label: "Line (L)", icon: "/" },
	{ id: "arrow", label: "Arrow (A)", icon: "→" },
	{ id: "text", label: "Text (T)", icon: "T" },
	{ id: "sticky", label: "Sticky note (S)", icon: "🗒" },
	{ id: "eraser", label: "Eraser (E)", icon: EraserIcon },
];

const COLORS = [
	"#000000",
	"#e53e3e",
	"#dd6b20",
	"#d69e2e",
	"#38a169",
	"#3182ce",
	"#805ad5",
	"#d53f8c",
	"#718096",
	"#ffffff",
];

const STROKE_WIDTHS = [1, 2, 3, 5, 8];

const FONT_FAMILIES = [
	{ value: "Inter", label: "Inter" },
	{ value: "Georgia", label: "Georgia" },
	{ value: "Courier New", label: "Courier New" },
];

function ToolbarComponent({
	activeTool,
	onToolChange,
	strokeColor,
	onStrokeColorChange,
	fillColor,
	onFillColorChange,
	strokeWidth,
	onStrokeWidthChange,
	fontFamily,
	onFontFamilyChange,
	fontBold,
	onFontBoldChange,
	fontItalic,
	onFontItalicChange,
	fontUnderline,
	onFontUnderlineChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onClear,
}: ToolbarProps) {
	return (
		<div className="toolbar">
			<div className="toolbar-group">
				{TOOLS.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`toolbar-btn ${activeTool === t.id ? "active" : ""}`}
						onClick={() => onToolChange(t.id)}
						title={t.label}
					>
						{t.icon}
					</button>
				))}
			</div>

			<div className="toolbar-divider" />

			<div className="toolbar-group">
				<span className="toolbar-label">Stroke</span>
				<div className="toolbar-colors">
					{COLORS.map((c) => (
						<button
							key={`stroke-${c}`}
							type="button"
							className={`toolbar-color ${strokeColor === c ? "active" : ""}`}
							style={{
								backgroundColor: c,
								border: c === "#ffffff" ? "1px solid #ccc" : "none",
							}}
							onClick={() => onStrokeColorChange(c)}
							title={c}
						/>
					))}
				</div>
			</div>

			<div className="toolbar-group">
				<span className="toolbar-label">Fill</span>
				<div className="toolbar-colors">
					<button
						type="button"
						className={`toolbar-color ${fillColor === "transparent" ? "active" : ""}`}
						style={{
							background:
								"repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 8px 8px",
						}}
						onClick={() => onFillColorChange("transparent")}
						title="No fill"
					/>
					{COLORS.filter((c) => c !== "#ffffff").map((c) => (
						<button
							key={`fill-${c}`}
							type="button"
							className={`toolbar-color ${fillColor === c ? "active" : ""}`}
							style={{ backgroundColor: c }}
							onClick={() => onFillColorChange(c)}
							title={c}
						/>
					))}
				</div>
			</div>

			<div className="toolbar-group">
				<span className="toolbar-label">Size</span>
				<div className="toolbar-widths">
					{STROKE_WIDTHS.map((w) => (
						<button
							key={`w-${w}`}
							type="button"
							className={`toolbar-width ${strokeWidth === w ? "active" : ""}`}
							onClick={() => onStrokeWidthChange(w)}
							title={`${w}px`}
						>
							<span
								style={{
									display: "block",
									width: `${Math.min(w * 2, 16)}px`,
									height: `${Math.min(w * 2, 16)}px`,
									borderRadius: "50%",
									background: "currentColor",
								}}
							/>
						</button>
					))}
				</div>
			</div>

			<div className="toolbar-divider" />

			{activeTool === "sticky" && (
				<>
					<div className="toolbar-group">
						<span className="toolbar-label">Note</span>
						<div className="toolbar-colors">
							{STICKY_COLORS.map((c) => (
								<button
									key={`sticky-${c}`}
									type="button"
									className={`toolbar-color ${fillColor === c ? "active" : ""}`}
									style={{ backgroundColor: c }}
									onClick={() => onFillColorChange(c)}
									title={c}
								/>
							))}
						</div>
					</div>

					<div className="toolbar-divider" />
				</>
			)}

			<div className="toolbar-group">
				<span className="font-select">Font:</span>
				<select
					className="font-dropdown"
					value={fontFamily}
					onChange={(e) => onFontFamilyChange(e.target.value)}
					title="Font family"
				>
					{FONT_FAMILIES.map((f) => (
						<option key={f.value} value={f.value}>
							{f.value}
						</option>
					))}
				</select>

				<button
					type="button"
					className={`font-style-btn ${fontBold ? "active" : ""}`}
					onClick={() => onFontBoldChange(!fontBold)}
					title="Bold"
					style={{ fontWeight: "bold" }}
				>
					B
				</button>
				<button
					type="button"
					className={`font-style-btn ${fontItalic ? "italic-active" : ""}`}
					onClick={() => onFontItalicChange(!fontItalic)}
					title="Italic"
					style={{ fontStyle: "italic" }}
				>
					I
				</button>
				<button
					type="button"
					className={`font-style-btn ${fontUnderline ? "underline-active" : ""}`}
					onClick={() => onFontUnderlineChange(!fontUnderline)}
					title="Underline"
					style={{ textDecoration: "underline" }}
				>
					U
				</button>
			</div>

			<div className="toolbar-divider" />

			<div className="toolbar-group">
				<button
					type="button"
					className="toolbar-btn"
					onClick={onUndo}
					disabled={!canUndo}
					title="Undo (Ctrl+Z)"
				>
					↩
				</button>
				<button
					type="button"
					className="toolbar-btn"
					onClick={onRedo}
					disabled={!canRedo}
					title="Redo (Ctrl+Y)"
				>
					↪
				</button>
			</div>

			<div className="toolbar-group">
				<button
					type="button"
					className="toolbar-btn danger"
					onClick={() => {
						if (confirm("Clear canvas?")) onClear();
					}}
					title="Clear canvas"
				>
					🗑
				</button>
			</div>
		</div>
	);
}

export default memo(ToolbarComponent);
