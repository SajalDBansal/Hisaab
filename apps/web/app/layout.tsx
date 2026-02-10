import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { site } from "@/lib/site";
import "./globals.css";

const nunito = localFont({
  src: [
    { path: "./fonts/nunito-semibold.ttf", weight: "600" },
    { path: "./fonts/nunito-bold.ttf", weight: "700" },
  ],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Hisaab | Accounting & business management",
    template: "%s | Hisaab",
  },
  description: site.description,
  ...(site.url
    ? { metadataBase: new URL(site.url) }
    : { robots: { index: false, follow: true } }),
  ...(site.url
    ? {
        alternates: { canonical: site.url },
        openGraph: {
          siteName: "Hisaab",
          type: "website",
          url: site.url,
          images: [
            {
              url: `${site.url}/images/hisaab-overview.webp`,
              width: 1280,
              height: 900,
              alt: "Hisaab workspace with illustrative business records",
            },
          ],
        },
      }
    : {}),
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
