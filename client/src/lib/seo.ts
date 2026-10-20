import type { Metadata } from "next";
import type { components } from "./api/schema";

type Post = components["schemas"]["PostDto"];
type Profile = components["schemas"]["UserProfileDto"];

/** Public address of the site, used for absolute links in previews (WhatsApp, Telegram, X…). */
export const SITE_URL = (process.env.SITE_URL ?? process.env.APP_ORIGIN ?? "https://rosefly.store").replace(/\/$/, "");
const API = (process.env.API_ORIGIN ?? "http://localhost:3002").replace(/\/$/, "");
export const SITE_NAME = "Circle";
export const SITE_DESCRIPTION = "Share photos, Reels and moments with the people you care about. Circles, stories, messages and calls in one calm, friendly place.";

/** Anonymous API read: previews only ever show what a signed-out visitor could see. */
async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API}/api${path}`, { cache: "no-store", signal: AbortSignal.timeout(3500) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
export const fetchPost = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? read<Post>(`/posts/${id}`) : Promise.resolve(null));
export const fetchProfile = (username: string) =>
  /^[A-Za-z0-9_]{3,30}$/.test(username) ? read<Profile>(`/users/${username}`) : Promise.resolve(null);
/** Server-side image fetch for the generated cards (internal API address, not the public site). */
export async function apiImage(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${API}/api${path}`, { cache: "no-store", signal: AbortSignal.timeout(3500) });
    if (!response.ok) return null;
    return `data:image/jpeg;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

/** One line of plain text, cut on a word boundary. */
export function excerpt(text: string | null | undefined, max: number) {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trimEnd()}…`;
}

const unavailable = (title: string): Metadata => ({
  title,
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: true },
});

export async function postMetadata(id: string): Promise<Metadata> {
  const post = await fetchPost(id);
  if (!post) return unavailable("Post");
  const source = post.kind === "REPOST" && post.referencedPost ? post.referencedPost : post;
  const author = source.author;
  const media = source.media.find((m) => m.status === "READY");
  const video = media?.type === "VIDEO";
  const text = excerpt(source.content, 160);
  const title = text ? `${author.displayName}: “${excerpt(source.content, 70)}”` : `${video ? "Reel" : "Photo"} by ${author.displayName}`;
  const description = text || `${video ? "Watch this Reel" : "See this post"} by ${author.displayName} (@${author.username}) on Circle.`;
  const url = `${SITE_URL}/post/${id}`;
  // A photo/video still when there is one; otherwise a generated card with the text.
  const image = media
    ? { url: `${SITE_URL}/api/backend/api/posts/${id}/preview.jpg`, alt: description }
    : { url: `${SITE_URL}/post/${id}/og`, width: 1200, height: 630, alt: description };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: video ? "video.other" : "article",
      url, title, description, siteName: SITE_NAME, images: [image],
      ...(video ? {} : { publishedTime: source.createdAt, authors: [`${SITE_URL}/profile/${author.username}`] }),
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export async function profileMetadata(username: string): Promise<Metadata> {
  const profile = await fetchProfile(username);
  if (!profile) return unavailable("Profile");
  const title = `${profile.displayName} (@${profile.username})`;
  const stats = `${profile.followerCount} followers · ${profile.postCount} posts`;
  const description = profile.bio ? `${excerpt(profile.bio, 140)} · ${stats}` : `${stats} on Circle. Follow @${profile.username} for photos, Reels and more.`;
  const url = `${SITE_URL}/profile/${profile.username}`;
  const image = { url: `${SITE_URL}/profile/${profile.username}/og`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: profile.isPrivate ? { index: false, follow: true } : undefined,
    openGraph: { type: "profile", url, title, description, siteName: SITE_NAME, username: profile.username, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
