import type { Metadata } from "next"
import "./globals.css"
import localFont from "next/font/local"
import SiteHeader from "../components/SiteHeader"

// Self-hosted Inter — eliminates Google Fonts CDN dependency at build time
const inter = localFont({
	src: "../../public/fonts/inter-300.woff",
	weight: "300",
	variable: "--font-sans",
	display: "swap",
})

export const metadata: Metadata = {
	title: "Magnet Type — Cursor-field variable font axis variation",
	icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
	description: "Drive per-word and per-character variable font axes with cursor proximity. Words and characters near the cursor attract toward a peak value; far ones hold at rest. React and vanilla JS.",
	keywords: ["magnet type", "variable font", "cursor", "mouse", "proximity", "wght", "wdth", "typography", "TypeScript", "npm", "react", "per-character"],
	openGraph: {
		title: "Magnet Type — Cursor-field variable font axis variation",
		description: "Drive per-word and per-character variable font axes with cursor proximity. A typographic interaction technique, now in one npm package.",
		url: "https://magnettype.com",
		siteName: "Magnet Type",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Magnet Type — Cursor-field variable font axis variation",
		description: "Drive per-word and per-character variable font axes with cursor proximity. A typographic interaction technique, now in one npm package.",
		site: "@liiift_studio",
		creator: "@liiift_studio",
	},
	metadataBase: new URL("https://magnettype.com"),
	alternates: { canonical: "https://magnettype.com" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`h-full antialiased ${inter.variable}`}>
			<body className="min-h-full flex flex-col">
				<SiteHeader current="magnetType" githubUrl="https://github.com/Liiift-Studio/magnetType" />{children}</body>
		</html>
	)
}
