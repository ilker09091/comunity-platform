import localFont from "next/font/local";
import "./globals.css";
import "./profile-editor.css";
import "./video-experience.css";
import "./social-media.css";
import "./messages-stories.css";
import "./profile-ig.css";
import "./interaction-fixes.css";
import "./instagram-overlays.css";
import "./mobile-messaging.css";
import "./circles.css";
import "./call-experience.css";
import "./dark.css";
import "./dark-generated.css";
import "./messaging-upgrade.css";
import "./messaging-design.css";
import Providers from "@/components/providers";
import { Suspense } from "react";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

const poppins = localFont({
  src: [
    { path: "../../node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
  fallback: ["Segoe UI", "Noto Sans", "Arial", "sans-serif"],
});

const geistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0e11" },
  ],
};

export const metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: "Circle — A little more connection",
    template: "%s | Circle",
  },
  description: SITE_DESCRIPTION,
  keywords: ["Circle", "social network", "photos", "Reels", "short videos", "stories", "circles", "friends", "messages"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: SITE_URL,
    title: "Circle — A little more connection",
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Circle — A little more connection", description: SITE_DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
      // The theme script sets data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React loads. */}
      <body suppressHydrationWarning>
        <Suspense
          fallback={<div className="initial-loading">Loading Circle…</div>}
        >
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
