import { card, OG_SIZE } from "@/lib/og-card";

export const alt = "Circle — find your people, share your world";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The default preview for links to the site itself. */
export default function Image() {
  return card({ name: "Circle", text: "Find your people. Share your world. Photos, Reels, circles and messages in one calm, friendly place.", badge: "Join free", brand: true });
}
