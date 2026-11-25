"use client";
import { type Models, type Result } from "@/lib/api/client";
import {
type InfiniteData
} from "@tanstack/react-query";

import { Delivery,Message } from "./message-item";

export type Draft = { content?: string; mediaId?: string; stickerId?:string;audioId?:string;gifId?:string;viewOnce?: boolean; replyToId?: string };
export type ThreadPage = Result<"messagesList">;
export type ThreadData = InfiniteData<ThreadPage, string | undefined>;
export type Outgoing = { message: Message; draft: Draft; status: Delivery };
export type InfoTab = "media" | "links" | "favorites";
export type AlbumDraft = { key: string; file: File; preview: string; type: "IMAGE" | "VIDEO"; progress: number; media: Models["MediaDto"] | null; error: string | null };
export const MAX_ALBUM = 10;
/** Photos and videos from one person within this window form an album. */
export const ALBUM_MS = 2 * 60_000;
export const albumable = (m: Message) => !!m.media && !m.viewOnce && !m.post && !m.storyReply && !m.noteReply && !m.call;

/** Local (not yet confirmed) messages carry this id prefix. */
export const LOCAL_PREFIX = "local-";
export let localCount = 0;
export const nextLocalId = () => `${LOCAL_PREFIX}${Date.now().toString(36)}-${localCount++}`;
/** How often an open chat checks for new messages. Only the newest page is fetched. */
export const HEAD_POLL_MS = 2500;
/** Grow the composer with CSS where supported, so typing never measures layout. */
export const CSS_AUTOSIZE = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

export function blankMessage(id: string, senderId: string, recipientId: string): Message {
  return {
    id, senderId, recipientId, createdAt: new Date().toISOString(), content: null, media: null, post: null, replyTo: null,
    viewOnce: false, viewOnceType: null, openedAt: null, deliveredAt: null, readAt: null, storyReply: null, noteReply: null,
    editedAt: null, gif: null, call: null, sticker: null, hasSticker: false, audioUrl: null, audioDurationMs: null, isFavorite: false, reactions: [], game: null, baby: null,
  };
}
export function replyKind(m: Message): Models["MessageReplyRefDto"]["kind"] {
  return m.viewOnce ? "VIEW_ONCE" : m.game ? "GAME" : m.baby ? "BABY" : m.content ? "TEXT" : m.audioUrl ? "AUDIO" : m.gif ? "GIF" : m.hasSticker ? "STICKER"
    : m.call ? "CALL" : m.media?.type === "VIDEO" ? "VIDEO" : m.media ? "PHOTO" : m.post ? "POST" : m.storyReply ? "STORY" : "TEXT";
}
export function replyThumb(m: Message) {
  return m.viewOnce ? null : (m.gif?.previewUrl ?? (m.media?.type === "IMAGE" ? m.media.url : m.sticker?.url)) ?? null;
}
export function replyRef(m: Message): Models["MessageReplyRefDto"] {
  return {
    id: m.id, senderId: m.senderId, kind: replyKind(m),
    preview: m.viewOnce ? null : (m.content?.slice(0, 140) ?? m.sticker?.emoji ?? null),
    audioDurationMs: m.audioUrl ? m.audioDurationMs : null, thumbnailUrl: replyThumb(m),
  };
}

export const updatePages = (data: ThreadData | undefined, fn: (items: Message[], page: number) => Message[]) =>
  data && { ...data, pages: data.pages.map((p, i) => ({ ...p, items: fn(p.items, i) })) };
export function insertMessage(data: ThreadData | undefined, message: Message) {
  if (!data?.pages.length || data.pages.some((p) => p.items.some((m) => m.id === message.id))) return data;
  return updatePages(data, (items, page) => (page === 0 ? [message, ...items] : items));
}
export const patchMessage = (data: ThreadData | undefined, id: string, patch: Partial<Message>) =>
  updatePages(data, (items) => items.map((m) => (m.id === id ? { ...m, ...patch } : m)));
export const dropMessage = (data: ThreadData | undefined, id: string) =>
  updatePages(data, (items) => items.filter((m) => m.id !== id));
export const olderThan = (a: Message, b: Message) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
/**
 * Folds a fresh newest page into the cached thread, so polling never refetches every loaded page.
 * Returns null when the fresh page no longer overlaps the cache (a full refetch is needed).
 */
export function mergeHead(data: ThreadData | undefined, head: ThreadPage): ThreadData | null {
  if (!data?.pages.length) return null;
  if (!head.hasMore) return { pages: [head], pageParams: [data.pageParams[0]] };
  const [first, ...rest] = data.pages;
  const oldest = head.items.at(-1);
  if (oldest && first.items[0] && olderThan(first.items[0], oldest)) return null;
  const fresh = new Set(head.items.map((m) => m.id));
  // Cached messages inside the fresh window but missing from it were unsent; older ones stay.
  const keep = oldest ? first.items.filter((m) => !fresh.has(m.id) && olderThan(m, oldest)) : first.items;
  return { ...data, pages: [{ ...first, items: [...head.items, ...keep] }, ...rest] };
}
