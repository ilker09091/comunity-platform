"use client";
import { api, type Models } from "@/lib/api/client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Ban,
  Bell,
  BellOff,
  CalendarHeart,
  ChevronRight,
  Flame,
  Gamepad2,
  Heart,
  Images,
  ContactRound as Info,
  Link2,
  MessageCircle,
  Mic,
  Palette,
  PhoneCall as Phone,
  Play,
  ShieldOff,
  Star,
  Trash2,
  Video,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { BabyCard } from "./baby";
import { themeMeta, themePhoto } from "./chat-themes";
import { useStreak } from "./message-streak";
import { useSession } from "./providers";
import { Avatar, ErrorState, LoadMore, Modal, VerifiedBadge } from "./ui";

import { attachmentLabel, Message, QuoteSummary, separatorLabel, SharedMediaViewer } from "./message-item";
import { InfoTab, replyKind, replyThumb } from "./thread-shared";

/** WhatsApp-style month headings for shared media and links. */
export function byMonth(items: Message[]) {
  const groups: { label: string; items: Message[] }[] = [];
  const thisYear = new Date().getFullYear();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const label = date.toLocaleDateString(undefined, { month: "long", ...(date.getFullYear() === thisYear ? {} : { year: "numeric" }) });
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
export const LINK = /((?:https?:\/\/|www\.)[^\s<>]+)/gi;
export function linksOf(text: string | null) {
  return [...(text ?? "").matchAll(LINK)].map((match) => {
    const raw = match[1].replace(/[.,!?;:)\]}]+$/, "");
    try {
      const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
      return ["http:", "https:"].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }).filter((url): url is URL => !!url);
}


/** "You & them" card in chat info: how long and how much you have been talking. */
/** 1,234 → "1,234"; 12,400 → "12.4K", so big numbers never break the layout. */
export const compact = (value: number) =>
  value < 10_000 ? value.toLocaleString() : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function TogetherCard({ peer }: { peer: Models["MessagePeerDto"] }) {
  const { user } = useSession();
  const stats = useQuery({
    queryKey: ["messages", user?.id, "together", peer.id],
    queryFn: ({ signal }) => api("messagesTogether", { params: { id: peer.id }, signal }),
    staleTime: 60_000,
  });
  const streak = useStreak(peer.id, !peer.isUnavailable);
  const [now] = useState(() => Date.now());
  const data = stats.data;
  if (!data?.since) return null;
  const since = new Date(data.since);
  const days = Math.max(1, Math.ceil((now - since.getTime()) / 86_400_000));
  const streakDays = streak.data && streak.data.state !== "expired" ? streak.data.days : 0;
  const tiles = [
    { icon: MessageCircle, tone: "#228be6", value: data.messages, label: "Messages" },
    { icon: Images, tone: "#12b886", value: data.photos, label: "Media" },
    { icon: Mic, tone: "#7950f2", value: data.voiceNotes, label: "Voice notes" },
    { icon: Phone, tone: "#15aabf", value: data.callMinutes, label: "Call min" },
    { icon: CalendarHeart, tone: "#e64980", value: data.daysTogether, label: "Active days" },
    { icon: Flame, tone: "#f76707", value: streakDays, label: "Streak" },
  ];
  return (
    <section className="dm-us" aria-label={`You and ${peer.displayName}`}>
      <div className="dm-us-head">
        <span className="dm-us-avatars" aria-hidden="true">
          <Avatar user={user} size={38} />
          <Avatar user={peer} size={38} />
          <span className="dm-us-heart"><Heart size={11} fill="currentColor" strokeWidth={0} /></span>
        </span>
        <span className="dm-us-title">
          <strong><span>You</span><span className="dm-us-amp">&amp;</span><span className="dm-us-peer">{peer.displayName}</span></strong>
          <small>Since {since.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</small>
        </span>
        <span className="dm-us-days">
          <b>{compact(days)}</b>
          <small>{days === 1 ? "day" : "days"}</small>
        </span>
      </div>
      <div className="dm-us-grid">
        {tiles.map(({ icon: Icon, tone, value, label }) => (
          <div key={label} className="dm-us-stat" title={`${label}: ${value.toLocaleString()}`}>
            <span className="dm-us-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
              <Icon size={15} strokeWidth={2.2} />
            </span>
            <span className="dm-us-copy">
              <b>{compact(value)}</b>
              <small>{label}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ChatInfo({
  peer,
  initialTab,
  presenceText,
  canCall,
  sounds,
  onToggleSounds,
  themeId,
  themeName,
  onTheme,
  onCustomize,
  onTogether,
  onBaby,
  onBlock,
  onDelete,
  onCall,
  onJump,
  onClose,
}: {
  peer: Models["MessagePeerDto"];
  initialTab: InfoTab;
  presenceText: string | null;
  canCall: boolean;
  sounds: boolean;
  onToggleSounds: () => void;
  themeId: string;
  themeName: string;
  onTheme?: () => void;
  onCustomize?: () => void;
  onTogether?: () => void;
  onBaby?: () => void;
  onBlock?: () => void;
  onDelete?: () => void;
  onCall: (kind: "audio" | "video") => void;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const { user } = useSession();
  const [tab, setTab] = useState<InfoTab>(initialTab);
  const [viewing, setViewing] = useState<Message | null>(null);
  const list = useInfiniteQuery({
    queryKey: tab === "favorites" ? ["messages", user?.id, "favorites", peer.id] : ["messages", user?.id, "shared", peer.id, tab],
    queryFn: ({ pageParam, signal }) =>
      tab === "favorites"
        ? api("messagesFavorites", { params: { id: peer.id }, query: { cursor: pageParam, limit: 30 }, signal })
        : api("messagesSharedMedia", { params: { id: peer.id }, query: { cursor: pageParam, limit: 30, kind: tab }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => (p.hasMore ? (p.nextCursor ?? undefined) : undefined),
    staleTime: 15_000,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const tabs: { id: InfoTab; label: string }[] = [
    { id: "media", label: "Media" },
    { id: "links", label: "Links" },
    { id: "favorites", label: "Favorites" },
  ];
  const empty = {
    media: { title: "No media yet", text: "Photos, videos and GIFs you share in this chat appear here." },
    links: { title: "No links yet", text: "Links you send each other are collected here." },
    favorites: { title: "No favorites yet", text: "Long-press or open the menu on a message and choose “Add to favorites”." },
  }[tab];
  const photo = peer.isUnavailable ? null : themePhoto(themeId);
  const accent = themeMeta(themeId).accent ?? "var(--primary)";
  return (
    <>
    <Modal title="Chat info" className="dm-info-sheet" onClose={onClose}>
      <div className="dm-info" style={{ "--info-accent": accent } as CSSProperties}>
        {/* Telegram-style cover: the chat theme's photo behind a big avatar. */}
        <div className={`dm-info-cover ${photo ? "has-photo" : ""}`} style={photo ? { backgroundImage: `url("${photo}")` } : undefined}>
          <Avatar user={peer} size={96} />
          <strong>
            {peer.displayName}
            {peer.isVerified && <VerifiedBadge />}
          </strong>
          <span>{presenceText ?? `@${peer.username}`}</span>
        </div>

        <div className="dm-info-quick">
          <button type="button" disabled={!canCall} onClick={() => onCall("audio")}>
            <Phone size={21} />
            <span>Call</span>
          </button>
          <button type="button" disabled={!canCall} onClick={() => onCall("video")}>
            <Video size={21} />
            <span>Video</span>
          </button>
          <button type="button" onClick={onToggleSounds} aria-pressed={!sounds}>
            {sounds ? <Bell size={21} /> : <BellOff size={21} />}
            <span>{sounds ? "Mute" : "Unmute"}</span>
          </button>
          {!peer.isUnavailable ? (
            <Link href={`/profile/${peer.username}`}>
              <Info size={21} />
              <span>Profile</span>
            </Link>
          ) : (
            <button type="button" disabled>
              <Info size={21} />
              <span>Profile</span>
            </button>
          )}
        </div>

        {!peer.isUnavailable && <TogetherCard peer={peer} />}
        {onBaby && (
          <div className="dm-set-group dm-info-baby">
            <BabyCard peer={peer} onOpen={onBaby} />
          </div>
        )}

        {(onTheme || onCustomize || onTogether) && (
          <>
            <h3 className="dm-set-label">This chat</h3>
            <div className="dm-set-group">
              {onTheme && (
                <button type="button" className="dm-set-item" onClick={onTheme}>
                  <span className="dm-set-icon" style={{ background: accent }}><Palette size={17} /></span>
                  <span className="dm-set-text"><strong>Chat theme</strong></span>
                  <span className="dm-set-value">{themeName}</span>
                  <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
                </button>
              )}
              {onCustomize && (
                <button type="button" className="dm-set-item" onClick={onCustomize}>
                  <span className="dm-set-icon" style={{ background: "#7950f2" }}><WandSparkles size={17} /></span>
                  <span className="dm-set-text"><strong>Nickname, wallpaper & sound</strong></span>
                  <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
                </button>
              )}
              {onTogether && (
                <button type="button" className="dm-set-item" onClick={onTogether}>
                  <span className="dm-set-icon" style={{ background: "#12b886" }}><Gamepad2 size={17} /></span>
                  <span className="dm-set-text"><strong>Gestures & games</strong></span>
                  <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}

        {(onBlock || onDelete) && (
          <div className="dm-set-group dm-info-danger">
            {onBlock && (
              <button type="button" className="dm-set-item danger" onClick={onBlock}>
                <span className="dm-set-icon" style={{ background: "#fa5252" }}>{peer.isBlocking ? <ShieldOff size={17} /> : <Ban size={17} />}</span>
                <span className="dm-set-text"><strong>{peer.isBlocking ? "Unblock account" : "Block account"}</strong></span>
              </button>
            )}
            {onDelete && (
              <button type="button" className="dm-set-item danger" onClick={onDelete}>
                <span className="dm-set-icon" style={{ background: "#fa5252" }}><Trash2 size={17} /></span>
                <span className="dm-set-text"><strong>Delete chat</strong></span>
              </button>
            )}
          </div>
        )}

        <h3 className="dm-set-label">Shared</h3>
        <div className="dm-info-segment" role="tablist" aria-label="Shared in this chat">
          {tabs.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="dm-info-panel" role="tabpanel">
          {list.isPending && (
            <div className={tab === "media" ? "dm-media-grid" : "dm-info-skeleton"} aria-busy="true" aria-label="Loading">
              {Array.from({ length: tab === "media" ? 9 : 4 }, (_, i) => <span key={i} className="dm-skeleton" />)}
            </div>
          )}
          {list.error && <ErrorState error={list.error} retry={() => void list.refetch()} />}
          {!list.isPending && !list.error && !items.length && (
            <div className="dm-info-empty">
              {tab === "media" ? <Images size={30} strokeWidth={1.5} /> : tab === "links" ? <Link2 size={30} strokeWidth={1.5} /> : <Star size={30} strokeWidth={1.5} />}
              <strong>{empty.title}</strong>
              <p>{empty.text}</p>
            </div>
          )}
          {tab === "media" &&
            byMonth(items).map((group) => (
              <section key={group.label} className="dm-info-group">
                <h3>{group.label}</h3>
                <div className="dm-media-grid">
                  {group.items.map((m) => (
                    <button key={m.id} type="button" className="dm-media-tile" aria-label={`Open ${m.gif ? "GIF" : m.media?.type === "VIDEO" ? "video" : "photo"}`} onClick={() => setViewing(m)}>
                      {m.gif ? (
                        <img src={m.gif.previewUrl} alt="" loading="lazy" decoding="async" />
                      ) : m.media?.type === "VIDEO" ? (
                        <>
                          <video src={`${m.media.url}#t=0.1`} muted playsInline preload="metadata" />
                          <span className="dm-media-badge"><Play size={14} fill="currentColor" /></span>
                        </>
                      ) : m.media ? (
                        <img src={m.media.url} alt="" loading="lazy" decoding="async" />
                      ) : null}
                      {m.gif && <span className="dm-media-badge text">GIF</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          {tab === "links" &&
            byMonth(items).map((group) => (
              <section key={group.label} className="dm-info-group">
                <h3>{group.label}</h3>
                <ul className="dm-link-list">
                  {group.items.flatMap((m) =>
                    linksOf(m.content).map((url, i) => (
                      <li key={`${m.id}-${i}`}>
                        <a href={url.href} target="_blank" rel="noopener noreferrer nofollow">
                          <span className="dm-link-icon"><Link2 size={18} /></span>
                          <span className="dm-link-copy">
                            <strong>{url.hostname.replace(/^www\./, "")}</strong>
                            <small>{url.href}</small>
                          </span>
                        </a>
                        <button type="button" className="dm-icon" aria-label="Show in chat" onClick={() => onJump(m.id)}>
                          <ChevronRight size={18} />
                        </button>
                      </li>
                    )),
                  )}
                </ul>
              </section>
            ))}
          {tab === "favorites" && !!items.length && (
            <ul className="dm-starred-list">
              {items.map((m) => {
                const own = m.senderId === user?.id;
                const thumb = replyThumb(m);
                return (
                  <li key={m.id}>
                    <button type="button" className="dm-starred-row" onClick={() => onJump(m.id)}>
                      <Avatar user={own ? user : peer} size={36} />
                      <span className="dm-starred-copy">
                        <span className="dm-starred-meta">
                          <strong>{own ? "You" : peer.displayName}</strong>
                          <time dateTime={m.createdAt}>{separatorLabel(m.createdAt)}</time>
                        </span>
                        <span className={`dm-starred-bubble ${own ? "own" : ""}`}>
                          {thumb && <img src={thumb} alt="" loading="lazy" />}
                          <QuoteSummary kind={replyKind(m)} text={m.content || m.sticker?.emoji || attachmentLabel(m)} durationMs={m.audioDurationMs} />
                        </span>
                      </span>
                      <Star className="dm-starred-star" size={15} fill="currentColor" aria-label="Favorite" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <LoadMore hasMore={list.hasNextPage} pending={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
        </div>
      </div>
    </Modal>
    {viewing && <SharedMediaViewer message={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
