import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Folio · Ledgerly — Receipts & Client Management",
    template: "%s — Folio · Ledgerly",
  },
  description: "Issue, print, and cryptographically verify receipts and manage clients.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", type: "image/x-icon" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Folio · Ledgerly — Receipts & Client Management",
    description: "Issue, print, and cryptographically verify receipts and manage clients.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"
        />
      </head>
      <body className="antialiased selection:bg-[#EEECFC] selection:text-[#5848D6]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
