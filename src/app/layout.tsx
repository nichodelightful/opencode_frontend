import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family AI Workbench",
  description: "A simple chat workspace for family AI tasks."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
