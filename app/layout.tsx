import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
		<html lang="en" className={`${inter.variable} h-full antialiased`}>
			<body className="min-h-full flex flex-col">{children}</body>
		</html>
	);
}
