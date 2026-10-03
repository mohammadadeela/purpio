import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
export const metadata: Metadata = { title: "Purpio — What will you create?", description: "Websites, apps, images, videos. One idea is all it takes.", manifest: "/site.webmanifest", icons: { icon: [{ url: "/favicon.ico", sizes: "32x32" }, { url: "/logo-static.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon-180.png" }, openGraph: { title: "Purpio", description: "Describe it. See it. Ship it.", images: ["/icon-512.png"] }, appleWebApp: { title: "Purpio", capable: true } };
export const viewport: Viewport = { themeColor: "#7C3AED", viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" /></head><body><Shell>{children}</Shell></body></html>);
}
