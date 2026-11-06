import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { t } from "@crm/shared/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: t("common.appName"),
  // Default: not indexable. Marketing pages opt in via pageMetadata (07 §1); workspace and
  // console surfaces stay noindex and also send X-Robots-Tag from the proxy.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          {t("common.skipToContent")}
        </a>
        {/* Each layout renders its own <main id="main"> so header/nav landmarks sit outside it. */}
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
