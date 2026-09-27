"use client";

import { memo, useEffect, useRef, useState } from "react";

export interface Page {
	id: string;
	name: string;
	json: Record<string, unknown>;
}

interface PageSidebarProps {
	pages: Page[];
	activePageIndex: number;
	onSelectPage: (index: number) => void;
	onAddPage: () => void;
	onDeletePage: (index: number) => void;
	onRenamePage: (index: number, name: string) => void;
	collapsed: boolean;
	onToggleCollapse: () => void;
}

function PageSidebarComponent({
	pages,
	activePageIndex,
	onSelectPage,
	onAddPage,
	onDeletePage,
	onRenamePage,
	collapsed,
	onToggleCollapse,
}: PageSidebarProps) {
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editingIndex !== null && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editingIndex]);

	const handleDoubleClick = (index: number, name: string) => {
		setEditingIndex(index);
		setEditValue(name);
	};

	const handleRenameSubmit = () => {
		if (editingIndex !== null && editValue.trim()) {
			onRenamePage(editingIndex, editValue.trim());
		}
		setEditingIndex(null);
	};

	const handleRenameKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleRenameSubmit();
		} else if (e.key === "Escape") {
			setEditingIndex(null);
		}
	};

	if (collapsed) {
		return (
			<div className="sidebar-collapsed">
				<button
					type="button"
					className="sidebar-toggle"
					onClick={onToggleCollapse}
					title="Expand sidebar"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						role="img"
						aria-hidden="true"
					>
						<path
							d="M6 3l5 5-5 5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<div className="sidebar-page-count">{pages.length}</div>
			</div>
		);
	}

	return (
		<div className="sidebar">
			<div className="sidebar-header">
				<span className="sidebar-title">Pages</span>
				<button
					type="button"
					className="sidebar-toggle"
					onClick={onToggleCollapse}
					title="Collapse sidebar"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						role="img"
						aria-hidden="true"
					>
						<path
							d="M10 3l-5 5 5 5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
			</div>

			<div className="sidebar-pages">
				{pages.map((page, index) => (
					// biome-ignore lint/a11y/useSemanticElements: div needed for layout
					<div
						key={page.id}
						role="button"
						tabIndex={0}
						className={`sidebar-page ${index === activePageIndex ? "active" : ""}`}
						onClick={() => onSelectPage(index)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onSelectPage(index);
							}
						}}
					>
						<div className="sidebar-page-number">{index + 1}</div>
						<div className="sidebar-page-info">
							{editingIndex === index ? (
								<input
									ref={inputRef}
									className="sidebar-page-rename-input"
									value={editValue}
									onChange={(e) => setEditValue(e.target.value)}
									onBlur={handleRenameSubmit}
									onKeyDown={handleRenameKeyDown}
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								// biome-ignore lint/a11y/useSemanticElements: span needed for inline layout
								<span
									role="button"
									tabIndex={0}
									className="sidebar-page-name"
									onDoubleClick={() => handleDoubleClick(index, page.name)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleDoubleClick(index, page.name);
										}
									}}
									title="Double-click to rename"
								>
									{page.name}
								</span>
							)}
						</div>
						{pages.length > 1 && (
							<button
								type="button"
								className="sidebar-page-delete"
								onClick={(e) => {
									e.stopPropagation();
									if (confirm(`Delete "${page.name}"?`)) {
										onDeletePage(index);
									}
								}}
								title="Delete page"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 14 14"
									fill="none"
									role="img"
									aria-hidden="true"
								>
									<path
										d="M3.5 3.5l7 7m0-7l-7 7"
										stroke="currentColor"
										strokeWidth="1.2"
										strokeLinecap="round"
									/>
								</svg>
							</button>
						)}
					</div>
				))}
			</div>

			<button type="button" className="sidebar-add-page" onClick={onAddPage}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					role="img"
					aria-hidden="true"
				>
					<path
						d="M7 2v10M2 7h10"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
				Add Page
			</button>
		</div>
	);
}

export default memo(PageSidebarComponent);
