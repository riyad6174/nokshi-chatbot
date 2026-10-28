import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nokshi Bazaar — AI Shopping Assistant",
  description:
    "A Next.js shopping assistant MVP: real catalog answers, product cards, cart tools, and a trusted checkout handoff.",
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
