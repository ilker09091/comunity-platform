import type { MetadataRoute } from "next";

/** Installable app (Android "Install app", iOS "Add to Home Screen"); also the base of the Android APK. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Circle",
    short_name: "Circle",
    description: "Share moments, Reels and messages with your circle.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
