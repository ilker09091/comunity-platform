import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "You’re invited to a circle",
  description: "Join a private circle on Circle: one question a day, a shared streak and albums for the moments you share.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "You’re invited to a circle",
    description: "Tap to join. One question a day, a shared streak and albums for the moments you share.",
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
