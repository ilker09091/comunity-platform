import localFont from "next/font/local";
import "./globals.css";
import "./profile-editor.css";
import "./video-experience.css";
import "./social-media.css";
import "./messages-stories.css";
import Providers from "@/components/providers";
import { Suspense } from "react";

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
  themeColor: "#f5f6f8",
};

export const metadata = {
  title: {
    default: "Circle — A little more connection",
    template: "%s | Circle",
  },
  description:
    "A space for ideas, everyday moments, and meaningful connections. Share your world on Circle.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <Suspense
          fallback={<div className="initial-loading">Loading Circle…</div>}
        >
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
