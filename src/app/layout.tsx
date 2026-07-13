import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Chatbox",
  description: "A simple web chatbox backed by opencode."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
