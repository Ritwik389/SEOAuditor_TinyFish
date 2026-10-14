import type { Metadata, Viewport } from "next";
import { SITE_DESC, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s · SEOAuditor" },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  keywords: ["SEO audit", "AI search visibility", "AI SEO", "generative engine optimization", "search result audit", "page extraction check", "technical SEO"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, title: SITE_TITLE, description: SITE_DESC, url: "/" },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESC },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
