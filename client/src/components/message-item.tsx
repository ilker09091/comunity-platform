"use client";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Baby,
  Camera,
  Check,
  CheckCheck,
  CircleAlert,
  Clapperboard,
  Clock,
  Copy,
  Eye,
  Gamepad2,
  Image as ImageIcon,
  Mic,
  MoreHorizontal,
  Music2,
  Pencil,
  PhoneCall as Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pin,
  Play,
  Reply,
  RotateCcw,
  Star,
  Sticker as StickerIcon,
  Trash2,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BabyInviteCard } from "./baby";
import { GameCard, gameName, type GameKind } from "./chat-extras";
import { ImageViewer } from "./image-viewer";
import { MediaVideo } from "./media-video";
import { MessageText } from "./message-text";
import { PhotoViewer } from "./photo-gallery";
import { useSession, useToast } from "./providers";
import { GifView, StickerView } from "./sticker-picker";
import { Avatar, Modal } from "./ui";
import { VoiceMessage } from "./voice-message";


export type Message = Models["DirectMessageDto"];
export type Conversation = Models["ConversationDto"];
export type Folder = "primary" | "requests";

/** Consecutive messages from one sender within this window share a bubble group. */
export const GROUP_MS = 5 * 60_000;
/** A gap this long (or a new day) gets a centered date/time separator. */
export const SEPARATOR_MS = 60 * 60_000;

/** Instagram-style compact age: "now", "5m", "3h", "2d", "4w". */
export function shortTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return `${Math.floor(minutes / 10080)}w`;
}
export const clock = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export function separatorLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(date, today)
    ? "Today"
    : same(date, yesterday)
      ? "Yesterday"
      : date.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
        });
  return `${day} ${clock(value)}`;
}
export function SharedPost({ post }: { post: NonNullable<Message["post"]> }) {
  const media = post.media[0];
  const reel = media?.type === "VIDEO";
  return (
    <Link className="dm-shared-post" href={`/post/${post.id}`}>
      <span className="dm-shared-author">
        <Avatar user={post.author} size={26} />
        <strong>{post.author.username}</strong>
        {reel && <Clapperboard size={15} aria-label="Reel" />}
      </span>
      {media &&
        (reel ? (
          <MediaVideo
            src={media.url}
            muted
            playsInline
            preload="metadata"
            style={{
              aspectRatio:
                media.width && media.height ? `${media.width}/${media.height}` : "9/16",
            }}
          />
        ) : (
          <img
            src={media.url}
            alt={post.content || `Post by ${post.author.username}`}
            style={{
              aspectRatio:
                media.width && media.height ? `${media.width}/${media.height}` : "1/1",
            }}
          />
        ))}
      {post.content && <span className="dm-shared-text">{post.content}</span>}
    </Link>
  );
}

/** Instagram-style: the note being answered, in its own small bubble above the reply. */
export function NoteReplyPreview({
  reply,
  own,
}: {
  reply: NonNullable<Message["noteReply"]>;
  own: boolean;
}) {
  return (
    <div className="dm-note-reply">
      <small>{own ? "You replied to their note" : "Replied to your note"}</small>
      <span className="dm-note-bubble">
        {reply.songTitle && (
          <span className="dm-note-song">
            <Music2 size={12} aria-hidden="true" />
            <span>{reply.songTitle}</span>
          </span>
        )}
        {reply.text && <span className="dm-note-text">{reply.text}</span>}
      </span>
    </div>
  );
}

export function StoryReplyPreview({
  reply,
  own,
}: {
  reply: NonNullable<Message["storyReply"]>;
  own: boolean;
}) {
  const media = reply.media;
  return (
    <div className="dm-story-reply">
      <small>{own ? "You replied to their story" : "Replied to your story"}</small>
      {media ? (
        media.type === "VIDEO" ? (
          <MediaVideo src={media.url} muted playsInline preload="metadata" />
        ) : (
          <img src={media.url} alt="Story" />
        )
      ) : (
        <span className="dm-story-gone">Story unavailable</span>
      )}
    </div>
  );
}

/** Instagram-style call history: "Video call · 12 min", "Missed voice call", "No answer". */
export function callDuration(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} hr${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
}
export function callSummary(call: NonNullable<Message["call"]>, own: boolean) {
  const kind = call.kind === "video" ? "Video call" : "Voice call";
  if (call.status === "completed")
    return { title: kind, detail: call.durationSeconds != null ? callDuration(call.durationSeconds) : "Ended", missed: false };
  if (own)
    return { title: kind, detail: call.status === "declined" ? "Declined" : call.status === "cancelled" ? "Cancelled" : "No answer", missed: false };
  return call.status === "declined"
    ? { title: kind, detail: "You declined", missed: false }
    : { title: `Missed ${call.kind === "video" ? "video" : "voice"} call`, detail: "Tap to call back", missed: true };
}
export function CallBubble({ message, own, onCall }: { message: Message; own: boolean; onCall?: (kind: "audio" | "video") => void }) {
  const call = message.call!;
  const summary = callSummary(call, own);
  const Icon = summary.missed ? PhoneMissed : call.kind === "video" ? Video : own ? PhoneOutgoing : PhoneIncoming;
  return (
    <button
      type="button"
      className={`dm-call-log ${summary.missed ? "missed" : ""}`}
      disabled={!onCall}
      aria-label={`${summary.title}, ${summary.detail}. Call again`}
      onClick={() => onCall?.(call.kind)}
    >
      <span className="dm-call-log-icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="dm-call-log-text">
        <strong>{summary.title}</strong>
        <small>{summary.detail === "Tap to call back" && !onCall ? clock(message.createdAt) : summary.detail}</small>
      </span>
    </button>
  );
}

export function attachmentLabel(message: Message) {
  if (message.game) return `🎮 ${gameName(message.game.kind)}`;
  if (message.baby) return `👶 Baby request · ${message.baby.name}`;
  if(message.call){const summary=callSummary(message.call,false);return summary.missed?summary.title:`${summary.title}${message.call.status==='completed'&&message.call.durationSeconds!=null?` · ${callDuration(message.call.durationSeconds)}`:''}`;}
  if(message.audioUrl)return 'Voice message';
  if(message.gif)return 'GIF';
  if(message.hasSticker)return 'Sticker';
  if (message.viewOnce) return message.viewOnceType === "VIDEO" ? "Video" : "Photo";
  if (message.media) return message.media.type === "IMAGE" ? "Photo" : "Video";
  if (message.post) return "Shared a post";
  return "Attachment unavailable";
}
export function preview(message: Message, own: boolean) {
  if (message.noteReply)
    return own
      ? `You replied to their note: ${message.content ?? ""}`
      : `Replied to your note: ${message.content ?? ""}`;
  if (message.storyReply)
    return own
      ? `You replied to their story${message.content ? `: ${message.content}` : ""}`
      : `Replied to your story${message.content ? `: ${message.content}` : ""}`;
  const body = message.content || attachmentLabel(message);
  return own ? `You: ${body}` : body;
}
/** "Active now" / "Active 5m ago", from the server's presence flags. */
export function presence(online: boolean, lastActiveAt: string | null | undefined) {
  if (online) return "Active now";
  if (!lastActiveAt) return null;
  const age = shortTime(lastActiveAt);
  return age === "now" ? "Active just now" : `Active ${age} ago`;
}

/** A local message on its way to the server, or one that could not be sent. */
/** "waiting": no connection; it goes out by itself once the phone is back online. */
export type Delivery = "sending" | "waiting" | "failed";

/** WhatsApp-style receipt: a clock while sending, one grey tick sent, two grey delivered, two blue read. */
export function Ticks({ message, delivery }: { message: Message; delivery?: Delivery }) {
  const state = delivery ?? (message.readAt ? "read" : message.deliveredAt ? "delivered" : "sent");
  const label = { sending: "Sending", waiting: "Waiting for connection", failed: "Not sent", read: "Read", delivered: "Delivered", sent: "Sent" }[state];
  return (
    <span className={`dm-ticks ${state}`} role="img" aria-label={label} title={label}>
      {state === "sending" || state === "waiting" ? <Clock size={13} strokeWidth={2.4} /> : state === "failed" ? <CircleAlert size={14} strokeWidth={2.4} />
        : state === "sent" ? <Check size={15} strokeWidth={2.4} /> : <CheckCheck size={15} strokeWidth={2.4} />}
    </span>
  );
}

export function Stamp({ message, own, delivery }: { message: Message; own: boolean; delivery?: Delivery }) {
  return (
    <span className="dm-stamp">
      {message.isFavorite && <Star className="dm-stamp-star" size={11} fill="currentColor" aria-label="Favorite" />}
      {message.editedAt&&<span className="dm-edited">Edited</span>}
      <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
      {own && <Ticks message={message} delivery={delivery} />}
    </span>
  );
}

export const REPLY_KIND: Record<Models["MessageReplyRefDto"]["kind"], string> = {
  TEXT: "",
  PHOTO: "Photo",
  VIDEO: "Video",
  POST: "Shared post",
  STORY: "Story reply",
  VIEW_ONCE: "View once",
  STICKER: "Sticker",
  AUDIO: "Voice message",
  CALL: "Call",
  GIF: "GIF",
  GAME: "Game",
  BABY: "Baby request",
  UNAVAILABLE: "Message unavailable",
};

export const voiceLength = (ms: number | null | undefined) =>
  ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}` : "";
/** Icon and words for what a quoted message holds, like WhatsApp ("🎤 Voice message 0:12"). */
export function QuoteSummary({ kind, text, durationMs }: { kind: Models["MessageReplyRefDto"]["kind"]; text: string | null; durationMs?: number | null }) {
  const Icon = kind === "AUDIO" ? Mic : kind === "PHOTO" ? Camera : kind === "VIDEO" ? Video : kind === "STICKER" ? StickerIcon
    : kind === "GIF" ? ImageIcon : kind === "VIEW_ONCE" ? Eye : kind === "CALL" ? Phone : kind === "GAME" ? Gamepad2 : kind === "BABY" ? Baby : null;
  return (
    <span className="dm-quote-summary">
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span>{kind === "AUDIO" ? `Voice message ${voiceLength(durationMs)}`.trim() : text || REPLY_KIND[kind]}</span>
    </span>
  );
}

export function Quote({
  reply,
  author,
  onJump,
}: {
  reply: Models["MessageReplyRefDto"];
  author: string;
  onJump?: () => void;
}) {
  return (
    <button type="button" className="dm-quote" onClick={onJump} disabled={!onJump}>
      <span className="dm-quote-text">
        <strong>{author}</strong>
        <QuoteSummary kind={reply.kind} text={reply.preview} durationMs={reply.audioDurationMs} />
      </span>
      {reply.thumbnailUrl && <img className="dm-quote-thumb" src={reply.thumbnailUrl} alt="" />}
    </button>
  );
}

/** Full-screen view of a view-once photo/video; it cannot be reopened once closed. */
/** How long a view-once photo stays on screen. */
export const VIEW_ONCE_PHOTO_MS = 10_000;

/**
 * Full-screen view of a view-once photo/video; it cannot be reopened once closed.
 * Browsers cannot block screenshots or screen recording, so this makes capturing harder and
 * traceable: a watermark with the viewer's name and time, the media is hidden whenever the
 * window loses focus or is hidden (screenshot tools usually take focus), PrintScreen hides it
 * and clears the clipboard, saving/dragging is disabled, and photos close after 10 seconds.
 */
export function ViewOnceViewer({ media, onClose }: { media: Models["MediaDto"]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user } = useSession();
  const [shielded, setShielded] = useState(false);
  const [stamp] = useState(() => new Date().toLocaleString());
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const hide = () => setShielded(true);
    const show = () => setShielded(document.visibilityState !== "visible");
    const visibility = () => (document.visibilityState === "visible" ? undefined : hide());
    const keys = (e: KeyboardEvent) => {
      // PrintScreen, and the macOS/Windows capture shortcuts.
      const capture =
        e.key === "PrintScreen" ||
        (e.metaKey && e.shiftKey && ["3", "4", "5", "s", "S"].includes(e.key)) ||
        (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S"));
      if (!capture) return;
      hide();
      void navigator.clipboard?.writeText("").catch(() => undefined);
    };
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", keys, true);
    window.addEventListener("keyup", keys, true);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("keyup", keys, true);
    };
  }, []);
  // The parent re-renders on every thread refresh; the timer must not restart with it.
  const expire = useEffectEvent(onClose);
  useEffect(() => {
    if (media.type === "VIDEO") return;
    const timer = window.setTimeout(() => expire(), VIEW_ONCE_PHOTO_MS);
    return () => window.clearTimeout(timer);
  }, [media.type]);
  const mark = `${user?.username ?? ""} · ${stamp}`;
  return (
    <dialog
      ref={ref}
      className={`dm-viewonce-viewer ${shielded ? "shielded" : ""}`}
      aria-label="View once"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
    >
      <header>
        <span className="dm-once-badge" aria-hidden="true">1</span>
        <span>View once · it disappears when you close it</span>
        <button type="button" className="dm-icon" aria-label="Close" onClick={onClose}>
          <X size={24} />
        </button>
      </header>
      {media.type !== "VIDEO" && (
        <span className="dm-viewonce-timer" style={{ animationDuration: `${VIEW_ONCE_PHOTO_MS}ms` }} aria-hidden="true" />
      )}
      <div className="dm-viewonce-stage" onClick={() => shielded && setShielded(false)}>
        {media.type === "VIDEO" ? (
          <MediaVideo
            src={media.url}
            autoPlay
            playsInline
            controls
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            onEnded={onClose}
          />
        ) : (
          <img src={media.url} alt="View once photo" draggable={false} />
        )}
        <span className="dm-viewonce-mark" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i}>{mark}</span>
          ))}
        </span>
        {shielded && (
          <span className="dm-viewonce-shield" role="status">
            Hidden while Circle isn&apos;t in focus. Tap to continue.
          </span>
        )}
      </div>
    </dialog>
  );
}

export function ViewOnceBubble({ message, own }: { message: Message; own: boolean }) {
  const client = useQueryClient();
  const toast = useToast();
  const [media, setMedia] = useState<Models["MediaDto"] | null>(null);
  const open = useMutation({
    mutationFn: () => api("messagesOpen", { params: { id: message.id } }),
    onSuccess: (m) => {
      haptic("tap");
      setMedia(m);
    },
    onError: (e) => {
      toast(e.message, true);
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
  });
  const kind = message.viewOnceType === "VIDEO" ? "Video" : "Photo";
  const openable = !own && !!message.viewOnceType && !message.openedAt;
  const label = message.openedAt ? "Opened" : message.viewOnceType ? kind : "Expired";
  return (
    <>
      <button
        type="button"
        className={`dm-bubble dm-viewonce ${message.openedAt || !message.viewOnceType ? "spent" : ""}`}
        disabled={!openable || open.isPending}
        onClick={() => open.mutate()}
        aria-label={openable ? `Open view once ${kind.toLowerCase()}` : `View once ${label.toLowerCase()}`}
      >
        <span className="dm-once-badge" aria-hidden="true">1</span>
        <span>{open.isPending ? "Opening..." : label}</span>
        <Stamp message={message} own={own} />
      </button>
      {media && (
        <ViewOnceViewer
          media={media}
          onClose={() => {
            setMedia(null);
            void client.invalidateQueries({ queryKey: ["messages"] });
          }}
        />
      )}
    </>
  );
}

export function MessageSticker({sticker}:{sticker:Models['StickerDto']}) {
  const client=useQueryClient(),toast=useToast();
  const favorite=useMutation({
    mutationFn:()=>api(sticker.isFavorite?'stickersUnfavorite':'stickersFavorite',{params:{id:sticker.id}}),
    onSuccess:()=>{void client.invalidateQueries({queryKey:['stickers']});void client.invalidateQueries({queryKey:['messages']});},
    onError:error=>toast(error.message,true)
  });
  return <div className="dm-sticker-message"><StickerView sticker={sticker} size={136}/>
    <button type="button" className="dm-icon" aria-label={`${sticker.isFavorite?'Remove':'Add'} ${sticker.name} sticker ${sticker.isFavorite?'from':'to'} favorites`}
      aria-pressed={sticker.isFavorite} disabled={favorite.isPending} onClick={()=>favorite.mutate()}><Star size={18} fill={sticker.isFavorite?'currentColor':'none'}/></button>
  </div>;
}

/** Instagram-style quick reactions (long-press menu); double-tap sends the first one. */
export const REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

export function Reactions({ reactions, userId, onToggle }: { reactions: Models["MessageReactionDto"][]; userId?: string; onToggle?: (emoji: string) => void }) {
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? { count: 0, mine: false };
    group.count += 1;
    group.mine ||= reaction.userId === userId;
    groups.set(reaction.emoji, group);
  }
  return (
    <div className="dm-reactions">
      {[...groups].map(([emoji, group]) => (
        <button
          key={emoji}
          type="button"
          className={group.mine ? "mine" : ""}
          aria-label={`${emoji} ${group.count}${group.mine ? ", your reaction. Tap to remove" : ""}`}
          disabled={!onToggle}
          onClick={() => onToggle?.(emoji)}
        >
          <span>{emoji}</span>
          {group.count > 1 && <small>{group.count}</small>}
        </button>
      ))}
    </div>
  );
}

/** WhatsApp-style album: photos and videos sent together, as one grid. */
export function AlbumGrid({ items }: { items: Message[] }) {
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [video, setVideo] = useState<Message | null>(null);
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  const photos = items.filter((m) => m.media?.type === "IMAGE").map((m) => m.media!);
  return (
    <>
      <div className={`dm-album count-${shown.length}`}>
        {shown.map((m, i) => (
          <button
            key={m.id}
            id={i === items.length - 1 ? undefined : `msg-${m.id}`}
            type="button"
            className="dm-album-tile"
            aria-label={m.media?.type === "VIDEO" ? "Play video" : "Open photo"}
            onClick={() => (m.media?.type === "VIDEO" ? setVideo(m) : setPhotoIndex(Math.max(0, photos.findIndex((p) => p.id === m.media?.id))))}
          >
            {m.media?.type === "VIDEO" ? (
              <>
                <video src={`${m.media.url}#t=0.1`} muted playsInline preload="metadata" />
                <span className="dm-media-badge"><Play size={14} fill="currentColor" /></span>
              </>
            ) : m.media ? (
              <img src={m.media.url} alt="Photo" loading="lazy" decoding="async" />
            ) : null}
            {i === shown.length - 1 && extra > 0 && <span className="dm-album-more">+{extra}</span>}
          </button>
        ))}
        {/* Jump targets for the photos hidden behind "+N". */}
        {items.slice(4, -1).map((m) => <span key={m.id} id={`msg-${m.id}`} className="dm-anchor" />)}
      </div>
      {photoIndex !== null && photos.length > 0 && (
        <PhotoViewer photos={photos} initial={photoIndex} title="Photos" alt="Photo in conversation" onClose={() => setPhotoIndex(null)} />
      )}
      {video && <SharedMediaViewer message={video} onClose={() => setVideo(null)} />}
    </>
  );
}

export type EffectKind = "hearts" | "kisses" | "confetti" | "hugs" | "roses";
export type Effect = { kind: EffectKind; key: string };
export const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u;
/** Messenger-style screen effects for emoji-only messages: hearts, kisses, confetti. */
export function effectFor(text: string | null | undefined): EffectKind | null {
  const value = (text ?? "").trim();
  if (!value || value.length > 24 || !/\p{Extended_Pictographic}/u.test(value) || !EMOJI_ONLY.test(value)) return null;
  if (/[😘💋]/u.test(value)) return "kisses";
  if (/[🤗🫂]/u.test(value)) return "hugs";
  if (/[🌹🌷💐🌸]/u.test(value)) return "roses";
  if (/[🎉🥳🎊🎂🍾]/u.test(value)) return "confetti";
  if (/[❤💕💖💗💓💞💘💝😍🥰💜💙💚💛🧡🤍🖤🫶😻🥺]/u.test(value)) return "hearts";
  return null;
}
export const EFFECT_GLYPHS: Record<EffectKind, string[]> = {
  hearts: ["❤️", "💕", "💖", "💗", "🥰", "💞"],
  kisses: ["😘", "💋", "❤️", "💕"],
  confetti: ["🎉", "🎊", "✨", "🥳", "💫", "⭐"],
  hugs: ["🤗", "🫂", "💞", "💗", "✨"],
  roses: ["🌹", "🌷", "🌸", "💐", "❤️"],
};
export function ScreenEffect({ effect, onDone }: { effect: Effect; onDone: () => void }) {
  const [particles] = useState(() =>
    Array.from({ length: 28 }, (_, i) => ({
      glyph: EFFECT_GLYPHS[effect.kind][i % EFFECT_GLYPHS[effect.kind].length],
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      duration: 2.3 + Math.random() * 1.4,
      size: 22 + Math.random() * 24,
      drift: (Math.random() - 0.5) * 90,
      spin: (Math.random() - 0.5) * 70,
    })),
  );
  const done = useEffectEvent(onDone);
  useEffect(() => {
    const timer = window.setTimeout(() => done(), 3800);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={`dm-effect ${effect.kind}`} aria-hidden="true">
      {(effect.kind === "hugs" || effect.kind === "kisses") && <b className="dm-effect-center">{effect.kind === "hugs" ? "🫂" : "😘"}</b>}
      {particles.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            fontSize: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--drift": `${p.drift}px`,
            "--spin": `${p.spin}deg`,
          } as CSSProperties}
        >
          {p.glyph}
        </span>
      ))}
    </div>
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  own,
  peer,
  first,
  last,
  onReply,
  onJump,
  onUnsend,
  onCall,
  onEdit,
  onFavorite,
  onReact,
  album,
  replyAuthor,
  enter = false,
  delivery,
  onRetry,
  onDiscard,
  onRematch,
  onBaby,
  onInfo,
  onPin,
  pinned = false,
}: {
  message: Message;
  own: boolean;
  peer: Models["MessagePeerDto"];
  first: boolean;
  last: boolean;
  onReply: (message: Message) => void;
  onJump: (id: string) => void;
  /** `album` is set when unsending a group of photos sent together. */
  onUnsend: (message: Message, album?: Message[]) => void;
  /** Calls the peer again from a call history entry; absent while calling is unavailable. */
  onCall?: (kind: "audio" | "video") => void;
  onEdit?: (message: Message) => void;
  /** Stars or unstars the message (direct messages only). */
  onFavorite?: (message: Message) => void;
  /** Sets (or with null, removes) your reaction (direct messages only). */
  onReact?: (message: Message, emoji: string | null) => void;
  /** Photos and videos sent together; `message` is the last one (caption, time, receipts). */
  album?: Message[];
  replyAuthor?: string;
  /** Arrived or was sent while the chat is open: slides in. */
  enter?: boolean;
  delivery?: Delivery;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
  /** Starts a new round of a finished mini game. */
  onRematch?: (kind: GameKind) => void;
  /** Opens the baby screen (from a baby request in the chat). */
  onBaby?: () => void;
  /** Group chats: who has seen it. */
  onInfo?: (message: Message) => void;
  /** Group chats: pins (or unpins) it at the top of the chat. */
  onPin?: (message: Message) => void;
  pinned?: boolean;
}) {
  const toast = useToast();
  /**
   * Message actions. Long-press (touch) opens a bottom sheet; the desktop "…" button opens a small
   * menu pinned to the screen next to the bubble (flipped above it near the bottom). Both render
   * in a portal so the scrolling chat can never clip them or hide them behind the composer.
   */
  const [menu, setMenu] = useState<null | { mode: "sheet" } | { mode: "popover"; top: number; left?: number; right?: number }>(null);
  const [photoOpen,setPhotoOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openPopover = () => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return setMenu({ mode: "sheet" });
    const height = (own ? 150 : 108) + (onFavorite ? 42 : 0) + (onReact ? 56 : 0) + (onInfo ? 42 : 0) + (onPin ? 42 : 0);
    const top = window.innerHeight - rect.bottom > height + 16 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
    setMenu(
      own
        ? { mode: "popover", top, right: Math.max(8, Math.min(window.innerWidth - 228, window.innerWidth - rect.right)) }
        : { mode: "popover", top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)) },
    );
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const press = useRef<number | undefined>(undefined);
  const openingPress = useRef(false);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    // A pinned menu would drift away from its message while the chat scrolls.
    const scroll = () => setMenu((m) => (m?.mode === "popover" ? null : m));
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [menu]);
  useEffect(() => () => window.clearTimeout(press.current), []);
  const media = album || message.viewOnce ? null : message.media;
  const replyTo = (album?.[0] ?? message).replyTo;
  const missing =
    !album && !message.content && !media && !message.post && !message.storyReply && !message.viewOnce && !message.hasSticker && !message.audioUrl && !message.call && !message.gif && !message.game && !message.baby;
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const { user } = useSession();
  const reactions = message.reactions ?? [];
  const myReaction = reactions.find((reaction) => reaction.userId === user?.id)?.emoji ?? null;
  const lastTap = useRef(0);
  const [burst, setBurst] = useState(0);
  /** Instagram: double-tap a message to heart it (it never un-hearts). */
  const heart = () => {
    if (!onReact || delivery) return;
    haptic("tap");
    setBurst((b) => b + 1);
    if (myReaction !== "❤️") onReact(message, "❤️");
  };
  const quoteAuthor = replyTo
    ? replyTo.senderId === user?.id
      ? "You"
      : replyAuthor ?? peer.displayName
    : "";
  const hasText = !!message.content;
  return (
    <li
      id={`msg-${message.id}`}
      className={`dm-message ${own ? "own" : ""} ${first ? "first" : ""} ${last ? "last" : ""} ${enter ? "enter" : ""} ${delivery ?? ""}`}
      onClickCapture={event=>{if(openingPress.current){event.preventDefault();event.stopPropagation();openingPress.current=false;}}}
      style={drag ? { transform: `translateX(${drag}px)` } : undefined}
      // Touch: swipe a message to the right to reply, like WhatsApp.
      onPointerDown={(e) => {
        if (e.pointerType !== "touch" || delivery) return;
        // Scrubbing a voice note or using a player must not start a swipe-to-reply or the menu.
        if(menu)return;
        const interactive=(e.target as Element).closest("button, a, .wa-voice-wave, video, audio, input");
        if(interactive&&!interactive.matches('.dm-photo'))return;
        swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        // Long-press opens the message menu (Reply / Copy / Unsend), like Instagram.
        window.clearTimeout(press.current);
        press.current = window.setTimeout(() => {
          // The finger can end over a newly mounted action. Ignore that synthetic click;
          // a fresh pointer-down in the menu enables its actions again.
          openingPress.current = true;
          swipe.current = null;
          setDrag(0);
          haptic("tap");
          setMenu({ mode: "sheet" });
        }, 450);
      }}
      onContextMenu={(e) => {
        if (swipe.current || menu) e.preventDefault();
      }}
      onPointerMove={(e) => {
        const start = swipe.current;
        if (!start || start.id !== e.pointerId) return;
        const dx = e.clientX - start.x;
        if (Math.abs(dx) > 8 || Math.abs(e.clientY - start.y) > 8) window.clearTimeout(press.current);
        if (Math.abs(e.clientY - start.y) > 24 && Math.abs(dx) < 24) {
          swipe.current = null;
          setDrag(0);
          return;
        }
        setDrag(Math.max(0, Math.min(72, dx)));
      }}
      onPointerUp={(e) => {
        window.clearTimeout(press.current);
        if (drag >= 56) {
          haptic("tap");
          onReply(message);
        } else if (e.pointerType === "touch" && swipe.current && drag < 6 && !(e.target as Element).closest("button, a, video, audio, input, .wa-voice-wave")) {
          const now = e.timeStamp;
          if (now - lastTap.current < 320) {
            lastTap.current = 0;
            heart();
          } else lastTap.current = now;
        }
        swipe.current = null;
        setDrag(0);
      }}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest("button, a, video, audio, input")) return;
        window.getSelection()?.removeAllRanges();
        heart();
      }}
      onPointerCancel={() => {
        window.clearTimeout(press.current);
        swipe.current = null;
        setDrag(0);
      }}
    >
      {!own && (
        <span className="dm-message-avatar" aria-hidden="true">
          {last && <Avatar user={peer} size={28} />}
        </span>
      )}
      <div className="dm-message-body" ref={bodyRef} title={separatorLabel(message.createdAt)}>
        {burst > 0 && <span key={burst} className="dm-heart-burst" aria-hidden="true">❤️</span>}
        {/* WhatsApp: a reply without text (voice note, sticker, GIF, photo) carries its quote on top. */}
        {replyTo && !hasText && !message.viewOnce && (
          <div className="dm-reply-head">
            <Quote reply={replyTo} author={quoteAuthor} onJump={() => onJump(replyTo.id)} />
          </div>
        )}
        {message.storyReply && <StoryReplyPreview reply={message.storyReply} own={own} />}
        {message.noteReply && <NoteReplyPreview reply={message.noteReply} own={own} />}
        {message.viewOnce && <ViewOnceBubble message={message} own={own} />}
        {message.call&&<CallBubble message={message} own={own} onCall={onCall}/>}
        {message.audioUrl&&<VoiceMessage id={message.id} src={message.audioUrl} durationMs={message.audioDurationMs} own={own} author={own?user:peer}/>}
        {message.sticker?<MessageSticker sticker={message.sticker}/>:message.hasSticker?<p className="dm-bubble muted">Sticker unavailable</p>:null}
        {message.gif && <GifView gif={message.gif} className="dm-gif" />}
        {message.game && <GameCard game={message.game} peer={peer} own={own} onRematch={onRematch} />}
        {message.baby && <BabyInviteCard invite={message.baby} own={own} peer={peer} onOpen={onBaby} />}
        {media &&
          (media.type === "VIDEO" ? (
            <MediaVideo
              className="dm-media"
              src={media.url}
              style={{
                aspectRatio: media.width && media.height ? `${media.width}/${media.height}` : "9/16",
              }}
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <button type="button" className="dm-photo" aria-label="Open photo in conversation" onClick={()=>setPhotoOpen(true)}>
              <img
                className="dm-media"
                src={media.url}
                alt="Photo"
                style={{
                  aspectRatio: media.width && media.height ? `${media.width}/${media.height}` : undefined,
                }}
              />
            </button>
          ))}
        {album && <AlbumGrid items={album} />}
        {photoOpen&&media&&<ImageViewer src={media.url} alt="Photo in conversation" onClose={()=>setPhotoOpen(false)}/>}
        {message.post && <SharedPost post={message.post} />}
        {missing && <p className="dm-bubble muted">This attachment is no longer available.</p>}
        {hasText && !message.viewOnce && (
          <div className="dm-bubble">
            {replyTo && (
              <Quote
                reply={replyTo}
                author={quoteAuthor}
                onJump={() => onJump(replyTo.id)}
              />
            )}
            <MessageText text={message.content!}/>
            <Stamp message={message} own={own} delivery={delivery} />
          </div>
        )}
        {!hasText && !message.viewOnce && (
          <span className="dm-stamp standalone">
            {message.isFavorite && <Star className="dm-stamp-star" size={11} fill="currentColor" aria-label="Favorite" />}
            <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
            {own && !message.call && <Ticks message={message} delivery={delivery} />}
          </span>
        )}
        {reactions.length > 0 && (
          <Reactions
            reactions={reactions}
            userId={user?.id}
            onToggle={onReact && !delivery ? (emoji) => onReact(message, myReaction === emoji ? null : emoji) : undefined}
          />
        )}
        {delivery === "failed" && (
          <span className="dm-failed" role="alert">
            Not sent
            <button type="button" onClick={() => onRetry?.(message.id)}><RotateCcw size={13} /> Retry</button>
            <button type="button" onClick={() => onDiscard?.(message.id)}>Delete</button>
          </span>
        )}
      </div>
      {!delivery && <div className="dm-hover-actions">
        <button type="button" className="dm-reply-action" aria-label="Reply" onClick={() => onReply(message)}>
          <Reply size={16} />
        </button>
        <button
          type="button"
          className="dm-reply-action"
          aria-label="More actions"
          aria-expanded={!!menu}
          onClick={() => (menu ? setMenu(null) : openPopover())}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>}
      {menu &&
        createPortal(
          <div className={`dm-menu-layer ${menu.mode}`}
            onPointerDownCapture={()=>{openingPress.current=false;}}
            onPointerDown={event=>{if(event.target===event.currentTarget){event.preventDefault();setMenu(null);}}} onClick={event=>{if(event.target===event.currentTarget)setMenu(null);}}>
            <div
              className={`dm-message-menu ${menu.mode}`}
              role="menu"
              ref={menuRef}
              style={menu.mode === "popover" ? { top: menu.top, left: menu.left, right: menu.right } : undefined}
            >
              {menu.mode === "sheet" && message.content && <p className="dm-menu-preview">{message.content}</p>}
              {onReact && (
                <div className="dm-react-bar" role="group" aria-label="React">
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`React with ${emoji}`}
                      aria-pressed={myReaction === emoji}
                      className={myReaction === emoji ? "selected" : ""}
                      onClick={() => {
                        setMenu(null);
                        haptic("tap");
                        onReact(message, myReaction === emoji ? null : emoji);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onReply(message);
                }}
              >
                <Reply size={18} /> Reply
              </button>
              {onInfo && (
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onInfo(message); }}>
                  <Eye size={18} /> Message info
                </button>
              )}
              {onPin && (
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onPin(message); }}>
                  <Pin size={18} /> {pinned ? "Unpin" : "Pin"}
                </button>
              )}
              {onFavorite && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    onFavorite(message);
                  }}
                >
                  <Star size={18} fill={message.isFavorite ? "currentColor" : "none"} />{" "}
                  {message.isFavorite ? "Remove from favorites" : "Add to favorites"}
                </button>
              )}
              {message.content && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    void navigator.clipboard.writeText(message.content!).then(
                      () => toast("Copied."),
                      () => toast("Unable to copy.", true),
                    );
                  }}
                >
                  <Copy size={18} /> Copy
                </button>
              )}
              {own && message.content && !message.viewOnce && onEdit && <button type="button" role="menuitem" onClick={()=>{setMenu(null);onEdit(message);}}><Pencil size={18}/> Edit message</button>}
              {own && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenu(null);
                    onUnsend(message, album);
                  }}
                >
                  <Trash2 size={18} /> {album ? `Unsend ${album.length} items` : "Unsend"}
                </button>
              )}
              {menu.mode === "sheet" && (
                <button type="button" className="dm-menu-cancel" onClick={() => setMenu(null)}>
                  Cancel
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
      {drag > 0 && (
        <span className="dm-swipe-hint" style={{ opacity: Math.min(1, drag / 56) }} aria-hidden="true">
          <Reply size={16} />
        </span>
      )}
    </li>
  );
});

export function SharedMediaViewer({ message, onClose }: { message: Message; onClose: () => void }) {
  if (message.media?.type === "IMAGE") return <ImageViewer src={message.media.url} alt="Shared photo" onClose={onClose} />;
  return (
    <Modal title={message.gif ? "GIF" : "Video"} className="dm-media-viewer" onClose={onClose}>
      <div className="dm-media-viewer-stage">
        {message.gif ? (
          <GifView gif={message.gif} maxWidth={720} />
        ) : message.media ? (
          <MediaVideo src={message.media.url} autoPlay controls playsInline />
        ) : null}
      </div>
    </Modal>
  );
}
