import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "0board",
	description: "A minimal whiteboard with screen recording",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
			<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
		>
			<body className="min-h-full flex flex-col">{children}</body>
		</html>
	);
}
