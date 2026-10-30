import type { Metadata } from "next";
import type { ReactNode } from "react";

import { THEME_BOOT_SCRIPT } from "@/components/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Equity Screener Powered by AI",
  description: "Company research workspace with live market data, financial statements, ownership, news and an AI analyst.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {/* Soft moving light behind the glass panels, so the frosted effect has something to blur. */}
        <div className="orbs" aria-hidden>
          <span className="orb o1" />
          <span className="orb o2" />
          <span className="orb o3" />
        </div>
        {children}
      </body>
    </html>
  );
}
