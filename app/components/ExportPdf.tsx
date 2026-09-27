"use client";

import { useState } from "react";
import type { Page } from "./PageSidebar";

interface ExportPdfProps {
	pages: Page[];
	onExportPage?: (pageIndex: number) => Promise<string | null>;
}

export default function ExportPdf({ pages, onExportPage }: ExportPdfProps) {
	const [exporting, setExporting] = useState(false);

	const handleExport = async () => {
		if (pages.length === 0 || exporting || !onExportPage) return;
		setExporting(true);

		try {
			const { jsPDF } = await import("jspdf");

			const pdf = new jsPDF({
				orientation: "landscape",
				unit: "pt",
				format: "a4",
			});

			const pageWidth = pdf.internal.pageSize.getWidth();
			const pageHeight = pdf.internal.pageSize.getHeight();

			for (let i = 0; i < pages.length; i++) {
				const dataUrl = await onExportPage(i);

				if (i > 0) pdf.addPage();

				if (!dataUrl) {
					pdf.setFontSize(16);
					pdf.text(
						`Page ${i + 1}: ${pages[i].name} (empty)`,
						pageWidth / 2,
						pageHeight / 2,
						{ align: "center" },
					);
					continue;
				}

				const img = new Image();
				img.src = dataUrl;
				const loaded = await new Promise<boolean>((resolve) => {
					img.onload = () => resolve(true);
					img.onerror = () => resolve(false);
				});
				if (!loaded || img.width === 0 || img.height === 0) {
					pdf.setFontSize(16);
					pdf.text(
						`Page ${i + 1}: ${pages[i].name} (export failed)`,
						pageWidth / 2,
						pageHeight / 2,
						{ align: "center" },
					);
					continue;
				}

				const imgAspect = img.width / img.height;
				const pdfAspect = pageWidth / pageHeight;

				let imgWidth: number;
				let imgHeight: number;

				if (imgAspect > pdfAspect) {
					imgWidth = pageWidth - 40;
					imgHeight = imgWidth / imgAspect;
				} else {
					imgHeight = pageHeight - 40;
					imgWidth = imgHeight * imgAspect;
				}

				const x = (pageWidth - imgWidth) / 2;
				const y = (pageHeight - imgHeight) / 2;

				pdf.addImage(dataUrl, "PNG", x, y, imgWidth, imgHeight);
			}

			pdf.save("diagram.pdf");
		} catch (err) {
			console.error("PDF export failed:", err);
			alert("Failed to export PDF. Please try again.");
		} finally {
			setExporting(false);
		}
	};

	return (
		<button
			type="button"
			className="export-pdf-button"
			onClick={handleExport}
			disabled={exporting || pages.length === 0}
			title="Export all pages as PDF"
		>
			{exporting ? (
				<svg
					className="export-pdf-spinner"
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					role="img"
					aria-label="Exporting"
				>
					<circle
						cx="7"
						cy="7"
						r="5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeDasharray="20 12"
					/>
				</svg>
			) : (
				<svg
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					role="img"
					aria-hidden="true"
				>
					<path
						d="M7 2v7m0 0l-3-3m3 3l3-3M2 11h10"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
			{exporting ? "Exporting..." : "Export PDF"}
		</button>
	);
}
