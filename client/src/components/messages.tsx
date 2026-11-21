"use client";
import { Fragment, memo, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Images,
  MessageCircle,
  CalendarHeart,
  Flame,
  Heart,
  Link2,
  Palette,
  Paperclip,
  Play,
  Plus,
  Smile,
  RotateCcw,
  SendHorizontal,
  Image as ImageIcon,
  Mic,
  Camera,
  Eye,
  Sticker as StickerIcon,
  Music2,
  MoreHorizontal,
  Copy,
  Trash2,
  Bell,
  BellOff,
  Reply,
  Clapperboard,
  ContactRound as Info,
  Search,
  Send,
  MessageSquarePlus as SquarePen,
  Pencil,
  UsersRound as Users,
  Video,
  PhoneCall as Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Ban,
  ShieldOff,
  Star,
  Sparkles,
  Gamepad2,
  Baby,
  WandSparkles,
  WifiOff,
  X,
} from "lucide-react";
import { api, ApiError, upload, type Models, type Result } from "@/lib/api/client";
import { useMediaAttachment } from "@/lib/use-media-attachment";
import { compressImage } from "@/lib/compress-image";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import {
  Avatar,
  ConfirmDialog,
  Dropdown,
  ErrorState,
  LoadMore,
  Modal,
  SignInPrompt,
  VerifiedBadge,
} from "./ui";
import { RecipientPicker } from "./social-controls";
import { MediaVideo } from "./media-video";
import { NotesTray } from "./notes";
import { messageSoundsOn, setMessageSounds } from "./app-bridge";
import { useCalls } from "./calls";
import StreakChip, { FlameIcon, useStreak } from "./message-streak";
import { ImageViewer } from "./image-viewer";
import { PhotoViewer } from "./photo-gallery";
import { GifView, StickerButton, StickerView } from './sticker-picker';
import { VoiceMessage, VoiceRecorder } from './voice-message';
import { MessageText } from './message-text';
import { CreateGroup, GroupAvatar, GroupThread, useGroups } from './group-chat';
import { ChatCustomize, GameCard, gameName, TogetherSheet, type GameKind } from './chat-extras';
import { BabyBubble, BabyCard, BabyInviteCard, BabySheet } from './baby';
import { CHAT_THEMES, ThemeStage, ThemeTray, themeAttributes, themeMeta, themePhoto, type ChatThemeId } from './chat-themes';

type Message = Models["DirectMessageDto"];
type Conversation = Models["ConversationDto"];
type Folder = "primary" | "requests";

/** Consecutive messages from one sender within this window share a bubble group. */
const GROUP_MS = 5 * 60_000;
/** A gap this long (or a new day) gets a centered date/time separator. */
const SEPARATOR_MS = 60 * 60_000;

/** Instagram-style compact age: "now", "5m", "3h", "2d", "4w". */
function shortTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return `${Math.floor(minutes / 10080)}w`;
}
const clock = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
function separatorLabel(value: string) {
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
function SharedPost({ post }: { post: NonNullable<Message["post"]> }) {
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
function NoteReplyPreview({
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

function StoryReplyPreview({
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
function callDuration(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} hr${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
}
function callSummary(call: NonNullable<Message["call"]>, own: boolean) {
  const kind = call.kind === "video" ? "Video call" : "Voice call";
  if (call.status === "completed")
    return { title: kind, detail: call.durationSeconds != null ? callDuration(call.durationSeconds) : "Ended", missed: false };
  if (own)
    return { title: kind, detail: call.status === "declined" ? "Declined" : call.status === "cancelled" ? "Cancelled" : "No answer", missed: false };
  return call.status === "declined"
    ? { title: kind, detail: "You declined", missed: false }
    : { title: `Missed ${call.kind === "video" ? "video" : "voice"} call`, detail: "Tap to call back", missed: true };
}
function CallBubble({ message, own, onCall }: { message: Message; own: boolean; onCall?: (kind: "audio" | "video") => void }) {
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

function attachmentLabel(message: Message) {
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
function preview(message: Message, own: boolean) {
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
function presence(online: boolean, lastActiveAt: string | null | undefined) {
  if (online) return "Active now";
  if (!lastActiveAt) return null;
  const age = shortTime(lastActiveAt);
  return age === "now" ? "Active just now" : `Active ${age} ago`;
}

/** A local message on its way to the server, or one that could not be sent. */
/** "waiting": no connection; it goes out by itself once the phone is back online. */
type Delivery = "sending" | "waiting" | "failed";

/** WhatsApp-style receipt: a clock while sending, one grey tick sent, two grey delivered, two blue read. */
function Ticks({ message, delivery }: { message: Message; delivery?: Delivery }) {
  const state = delivery ?? (message.readAt ? "read" : message.deliveredAt ? "delivered" : "sent");
  const label = { sending: "Sending", waiting: "Waiting for connection", failed: "Not sent", read: "Read", delivered: "Delivered", sent: "Sent" }[state];
  return (
    <span className={`dm-ticks ${state}`} role="img" aria-label={label} title={label}>
      {state === "sending" || state === "waiting" ? <Clock size={13} strokeWidth={2.4} /> : state === "failed" ? <CircleAlert size={14} strokeWidth={2.4} />
        : state === "sent" ? <Check size={15} strokeWidth={2.4} /> : <CheckCheck size={15} strokeWidth={2.4} />}
    </span>
  );
}

function Stamp({ message, own, delivery }: { message: Message; own: boolean; delivery?: Delivery }) {
  return (
    <span className="dm-stamp">
      {message.isFavorite && <Star className="dm-stamp-star" size={11} fill="currentColor" aria-label="Favorite" />}
      {message.editedAt&&<span className="dm-edited">Edited</span>}
      <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
      {own && <Ticks message={message} delivery={delivery} />}
    </span>
  );
}

const REPLY_KIND: Record<Models["MessageReplyRefDto"]["kind"], string> = {
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

const voiceLength = (ms: number | null | undefined) =>
  ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}` : "";
/** Icon and words for what a quoted message holds, like WhatsApp ("🎤 Voice message 0:12"). */
function QuoteSummary({ kind, text, durationMs }: { kind: Models["MessageReplyRefDto"]["kind"]; text: string | null; durationMs?: number | null }) {
  const Icon = kind === "AUDIO" ? Mic : kind === "PHOTO" ? Camera : kind === "VIDEO" ? Video : kind === "STICKER" ? StickerIcon
    : kind === "GIF" ? ImageIcon : kind === "VIEW_ONCE" ? Eye : kind === "CALL" ? Phone : kind === "GAME" ? Gamepad2 : kind === "BABY" ? Baby : null;
  return (
    <span className="dm-quote-summary">
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span>{kind === "AUDIO" ? `Voice message ${voiceLength(durationMs)}`.trim() : text || REPLY_KIND[kind]}</span>
    </span>
  );
}

function Quote({
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
const VIEW_ONCE_PHOTO_MS = 10_000;

/**
 * Full-screen view of a view-once photo/video; it cannot be reopened once closed.
 * Browsers cannot block screenshots or screen recording, so this makes capturing harder and
 * traceable: a watermark with the viewer's name and time, the media is hidden whenever the
 * window loses focus or is hidden (screenshot tools usually take focus), PrintScreen hides it
 * and clears the clipboard, saving/dragging is disabled, and photos close after 10 seconds.
 */
function ViewOnceViewer({ media, onClose }: { media: Models["MediaDto"]; onClose: () => void }) {
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

function ViewOnceBubble({ message, own }: { message: Message; own: boolean }) {
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

function MessageSticker({sticker}:{sticker:Models['StickerDto']}) {
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
const REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

function Reactions({ reactions, userId, onToggle }: { reactions: Models["MessageReactionDto"][]; userId?: string; onToggle?: (emoji: string) => void }) {
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
function AlbumGrid({ items }: { items: Message[] }) {
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

type EffectKind = "hearts" | "kisses" | "confetti" | "hugs" | "roses";
type Effect = { kind: EffectKind; key: string };
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u;
/** Messenger-style screen effects for emoji-only messages: hearts, kisses, confetti. */
function effectFor(text: string | null | undefined): EffectKind | null {
  const value = (text ?? "").trim();
  if (!value || value.length > 24 || !/\p{Extended_Pictographic}/u.test(value) || !EMOJI_ONLY.test(value)) return null;
  if (/[😘💋]/u.test(value)) return "kisses";
  if (/[🤗🫂]/u.test(value)) return "hugs";
  if (/[🌹🌷💐🌸]/u.test(value)) return "roses";
  if (/[🎉🥳🎊🎂🍾]/u.test(value)) return "confetti";
  if (/[❤💕💖💗💓💞💘💝😍🥰💜💙💚💛🧡🤍🖤🫶😻🥺]/u.test(value)) return "hearts";
  return null;
}
const EFFECT_GLYPHS: Record<EffectKind, string[]> = {
  hearts: ["❤️", "💕", "💖", "💗", "🥰", "💞"],
  kisses: ["😘", "💋", "❤️", "💕"],
  confetti: ["🎉", "🎊", "✨", "🥳", "💫", "⭐"],
  hugs: ["🤗", "🫂", "💞", "💗", "✨"],
  roses: ["🌹", "🌷", "🌸", "💐", "❤️"],
};
function ScreenEffect({ effect, onDone }: { effect: Effect; onDone: () => void }) {
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
    const height = (own ? 150 : 108) + (onFavorite ? 42 : 0) + (onReact ? 56 : 0);
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

type Draft = { content?: string; mediaId?: string; stickerId?:string;audioId?:string;gifId?:string;viewOnce?: boolean; replyToId?: string };
type ThreadPage = Result<"messagesList">;
type ThreadData = InfiniteData<ThreadPage, string | undefined>;
type Outgoing = { message: Message; draft: Draft; status: Delivery };
type InfoTab = "media" | "links" | "favorites";
type AlbumDraft = { key: string; file: File; preview: string; type: "IMAGE" | "VIDEO"; progress: number; media: Models["MediaDto"] | null; error: string | null };
const MAX_ALBUM = 10;
/** Photos and videos from one person within this window form an album. */
const ALBUM_MS = 2 * 60_000;
const albumable = (m: Message) => !!m.media && !m.viewOnce && !m.post && !m.storyReply && !m.noteReply && !m.call;

/** Local (not yet confirmed) messages carry this id prefix. */
const LOCAL_PREFIX = "local-";
let localCount = 0;
const nextLocalId = () => `${LOCAL_PREFIX}${Date.now().toString(36)}-${localCount++}`;
/** How often an open chat checks for new messages. Only the newest page is fetched. */
const HEAD_POLL_MS = 2500;
/** Grow the composer with CSS where supported, so typing never measures layout. */
const CSS_AUTOSIZE = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

function blankMessage(id: string, senderId: string, recipientId: string): Message {
  return {
    id, senderId, recipientId, createdAt: new Date().toISOString(), content: null, media: null, post: null, replyTo: null,
    viewOnce: false, viewOnceType: null, openedAt: null, deliveredAt: null, readAt: null, storyReply: null, noteReply: null,
    editedAt: null, gif: null, call: null, sticker: null, hasSticker: false, audioUrl: null, audioDurationMs: null, isFavorite: false, reactions: [], game: null, baby: null,
  };
}
function replyKind(m: Message): Models["MessageReplyRefDto"]["kind"] {
  return m.viewOnce ? "VIEW_ONCE" : m.game ? "GAME" : m.baby ? "BABY" : m.content ? "TEXT" : m.audioUrl ? "AUDIO" : m.gif ? "GIF" : m.hasSticker ? "STICKER"
    : m.call ? "CALL" : m.media?.type === "VIDEO" ? "VIDEO" : m.media ? "PHOTO" : m.post ? "POST" : m.storyReply ? "STORY" : "TEXT";
}
function replyThumb(m: Message) {
  return m.viewOnce ? null : (m.gif?.previewUrl ?? (m.media?.type === "IMAGE" ? m.media.url : m.sticker?.url)) ?? null;
}
function replyRef(m: Message): Models["MessageReplyRefDto"] {
  return {
    id: m.id, senderId: m.senderId, kind: replyKind(m),
    preview: m.viewOnce ? null : (m.content?.slice(0, 140) ?? m.sticker?.emoji ?? null),
    audioDurationMs: m.audioUrl ? m.audioDurationMs : null, thumbnailUrl: replyThumb(m),
  };
}

const updatePages = (data: ThreadData | undefined, fn: (items: Message[], page: number) => Message[]) =>
  data && { ...data, pages: data.pages.map((p, i) => ({ ...p, items: fn(p.items, i) })) };
function insertMessage(data: ThreadData | undefined, message: Message) {
  if (!data?.pages.length || data.pages.some((p) => p.items.some((m) => m.id === message.id))) return data;
  return updatePages(data, (items, page) => (page === 0 ? [message, ...items] : items));
}
const patchMessage = (data: ThreadData | undefined, id: string, patch: Partial<Message>) =>
  updatePages(data, (items) => items.map((m) => (m.id === id ? { ...m, ...patch } : m)));
const dropMessage = (data: ThreadData | undefined, id: string) =>
  updatePages(data, (items) => items.filter((m) => m.id !== id));
const olderThan = (a: Message, b: Message) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
/**
 * Folds a fresh newest page into the cached thread, so polling never refetches every loaded page.
 * Returns null when the fresh page no longer overlaps the cache (a full refetch is needed).
 */
function mergeHead(data: ThreadData | undefined, head: ThreadPage): ThreadData | null {
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

/** WhatsApp-style month headings for shared media and links. */
function byMonth(items: Message[]) {
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
const LINK = /((?:https?:\/\/|www\.)[^\s<>]+)/gi;
function linksOf(text: string | null) {
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

function SharedMediaViewer({ message, onClose }: { message: Message; onClose: () => void }) {
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

/** "You & them" card in chat info: how long and how much you have been talking. */
/** 1,234 → "1,234"; 12,400 → "12.4K", so big numbers never break the layout. */
const compact = (value: number) =>
  value < 10_000 ? value.toLocaleString() : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);

function TogetherCard({ peer }: { peer: Models["MessagePeerDto"] }) {
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

function ChatInfo({
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

/**
 * Telegram-style composer: one rounded field (emoji/sticker tray, text, attach) and a round
 * button that morphs between microphone and send. It owns the draft text, so typing re-renders
 * only the composer and never the message list.
 */
function Composer({
  peer,
  canMessage,
  awaiting,
  callsBusy,
  fieldRef,
  stickerDock,
  voiceActive,
  onVoiceActiveChange,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onJumpTo,
  onSaveEdit,
  onSend,
  onSendAudio,
  onTogether,
}: {
  peer: Models["MessagePeerDto"];
  canMessage: boolean;
  awaiting: boolean;
  callsBusy: boolean;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  stickerDock: HTMLDivElement | null;
  voiceActive: boolean;
  onVoiceActiveChange: (active: boolean) => void;
  replyTo: Message | null;
  editing: Message | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onJumpTo: (id: string) => void;
  onSaveEdit: (message: Message, content: string) => void;
  onSend: (draft: Draft, preview: Partial<Message>, options?: { noReply?: boolean }) => void;
  onSendAudio: (audioId: string) => Promise<unknown>;
  /** Opens gestures and mini games. */
  onTogether?: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const [text, setText] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const attachment = useMediaAttachment();
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  // Editing a message puts its text in the field; finishing or cancelling empties it.
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    setText(editing?.content ?? "");
  }
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || CSS_AUTOSIZE) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, fieldRef]);
  // Stop showing "typing..." to them when leaving the conversation.
  useEffect(
    () => () => {
      if (typingSent.current) void api("messagesStopTyping", { params: { id: peer.id } }).catch(() => {});
    },
    [peer.id],
  );
  const signalTyping = (value: string) => {
    const now = Date.now();
    if (value.trim() && now - typingSent.current > 3000) {
      typingSent.current = now;
      void api("messagesTyping", { params: { id: peer.id } }).catch(() => {});
    } else if (!value.trim() && typingSent.current) {
      typingSent.current = 0;
      void api("messagesStopTyping", { params: { id: peer.id } }).catch(() => {});
    }
  };
  /** Several photos/videos picked at once upload in parallel and are sent as one album. */
  const [album, setAlbum] = useState<AlbumDraft[]>([]);
  const albumRef = useRef<AlbumDraft[]>([]);
  const removedKeys = useRef(new Set<string>());
  useEffect(() => {
    albumRef.current = album;
  }, [album]);
  useEffect(
    () => () => {
      for (const item of albumRef.current) {
        URL.revokeObjectURL(item.preview);
        if (item.media) void api("mediaRemove", { params: { id: item.media.id } }).catch(() => {});
      }
    },
    [],
  );
  const patchAlbum = (key: string, patch: Partial<AlbumDraft>) =>
    setAlbum((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const uploadAlbumItem = async (item: AlbumDraft) => {
    try {
      const file = await compressImage(item.file);
      if (removedKeys.current.has(item.key)) return;
      let uploaded = (await upload(file, (progress) => patchAlbum(item.key, { progress }))) as Models["MediaDto"];
      if (removedKeys.current.has(item.key)) {
        void api("mediaRemove", { params: { id: uploaded.id } }).catch(() => {});
        return;
      }
      patchAlbum(item.key, { media: uploaded, progress: 100 });
      while (uploaded.status === "PROCESSING") {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (removedKeys.current.has(item.key)) return;
        uploaded = await api("mediaGet", { params: { id: uploaded.id } });
        patchAlbum(item.key, { media: uploaded });
      }
      if (uploaded.status === "FAILED") patchAlbum(item.key, { error: "Processing failed" });
    } catch (e) {
      patchAlbum(item.key, { error: e instanceof Error ? e.message : "Upload failed" });
    }
  };
  const addToAlbum = (files: File[]) => {
    const room = MAX_ALBUM - album.length;
    if (files.length > room) toast(`You can send up to ${MAX_ALBUM} photos and videos at once.`, true);
    const items: AlbumDraft[] = files.slice(0, Math.max(0, room)).map((file) => ({
      key: nextLocalId(),
      file,
      preview: URL.createObjectURL(file),
      type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      progress: 0,
      media: null,
      error: null,
    }));
    if (!items.length) return;
    setAlbum((list) => [...list, ...items]);
    void (async () => {
      for (let i = 0; i < items.length; i += 2) await Promise.all(items.slice(i, i + 2).map(uploadAlbumItem));
    })();
  };
  const removeFromAlbum = (key: string) => {
    const item = album.find((x) => x.key === key);
    removedKeys.current.add(key);
    if (item) URL.revokeObjectURL(item.preview);
    if (item?.media) void api("mediaRemove", { params: { id: item.media.id } }).catch(() => {});
    setAlbum((list) => list.filter((x) => x.key !== key));
  };
  const albumReady = album.length > 0 && album.every((item) => item.media?.status === "READY" && !item.error);
  const media = editing ? null : attachment.media;
  const hasText = !!text.trim();
  const canSend = canMessage && !voiceActive && !attachment.busy && !attachment.error && (album.length ? albumReady : hasText || !!media);
  const showSend = hasText || !!media || !!editing || callsBusy || album.length > 0;
  const submit = () => {
    if (editing) {
      const value = text.trim();
      if (value && value !== editing.content) onSaveEdit(editing, value);
      else if (!value) return;
      else onCancelEdit();
      return;
    }
    if (!canSend) return;
    if (album.length) {
      const caption = text.trim() || undefined;
      album.forEach((item, i) => {
        const last = i === album.length - 1;
        onSend(
          { mediaId: item.media!.id, content: last ? caption : undefined },
          { media: item.media!, content: last ? (caption ?? null) : null },
          { noReply: i > 0 },
        );
        URL.revokeObjectURL(item.preview);
      });
      setAlbum([]);
      setText("");
      typingSent.current = 0;
      fieldRef.current?.focus({ preventScroll: true });
      return;
    }
    const content = text.trim() || undefined;
    onSend(
      { content, mediaId: media?.id, viewOnce: media ? viewOnce : undefined },
      {
        content: content ?? null,
        ...(media ? (viewOnce ? { viewOnce: true, viewOnceType: media.type } : { media }) : {}),
      },
    );
    // Clear at once (like Telegram) and keep the keyboard open for the next message.
    setText("");
    typingSent.current = 0;
    if (media) {
      attachment.attached();
      setViewOnce(false);
      setPreviewOpen(false);
    }
    fieldRef.current?.focus({ preventScroll: true });
  };
  const insertEmoji = (emoji: string) => {
    const el = fieldRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, 2000);
    setText(next);
    signalTyping(next);
    requestAnimationFrame(() => el?.setSelectionRange(start + emoji.length, start + emoji.length));
  };
  const previewSrc = attachment.previewUrl ?? media?.url;
  const embedMessage = editing ?? replyTo;
  const embed = embedMessage && {
    kind: editing ? ("edit" as const) : ("reply" as const),
    key: `${editing ? "edit" : "reply"}-${embedMessage.id}`,
    message: embedMessage,
    title: editing ? "Edit message" : `Reply to ${embedMessage.senderId === user?.id ? "yourself" : peer.displayName}`,
    quoteKind: editing ? ("TEXT" as const) : replyKind(embedMessage),
    text: editing
      ? embedMessage.content
      : embedMessage.viewOnce ? null : embedMessage.content || embedMessage.sticker?.emoji || attachmentLabel(embedMessage),
    thumb: editing ? null : replyThumb(embedMessage),
  };
  return (
    <form
      className="dm-composer tg-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {awaiting && <p className="dm-notice">Message request sent. You can send more once {peer.displayName} accepts.</p>}
      {!canMessage && !awaiting && (
        <p className="dm-notice">
          {peer.isBlocking ? "You blocked this account. Unblock it to send messages." : "Follow this private account before sending a message."}
        </p>
      )}
      {!editing && previewSrc && (
        <div className="dm-attachment dm-attachment-preview">
          <div className="dm-draft-media">
            {(media?.type ?? attachment.previewType) === "IMAGE" ? (
              <button type="button" aria-label="Enlarge photo preview" onClick={() => setPreviewOpen(true)}>
                <img src={previewSrc} alt="Photo preview before sending" />
              </button>
            ) : (
              <video src={previewSrc} controls playsInline preload="metadata" aria-label="Video preview before sending" />
            )}
          </div>
          {previewOpen && <ImageViewer src={previewSrc} alt="Photo preview" onClose={() => setPreviewOpen(false)} />}
          <div className="dm-draft-details">
            <span>
              {attachment.uploading
                ? `Uploading… ${attachment.progress}%`
                : media?.status === "READY"
                  ? `${media.type === "IMAGE" ? "Photo" : "Video"} ready to send`
                  : "Processing video..."}
            </span>
            <button
              type="button"
              className={`dm-once-toggle ${viewOnce ? "on" : ""}`}
              aria-pressed={viewOnce}
              aria-label="View once"
              disabled={!media}
              title={viewOnce ? "View once: on" : "View once: off"}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                haptic("tap");
                setViewOnce((v) => !v);
              }}
            >
              1
            </button>
            <button
              type="button"
              className="dm-icon"
              aria-label="Remove attachment"
              onClick={() => {
                attachment.clear();
                setViewOnce(false);
                setPreviewOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          {attachment.uploading && (
            <span className="dm-upload-bar" role="progressbar" aria-valuenow={attachment.progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${(attachment.progress ?? 0) / 100})` }} />
            </span>
          )}
        </div>
      )}
      {!editing && album.length > 0 && (
        <div className="dm-album-draft">
          <div className="dm-album-draft-strip">
            {album.map((item) => {
              const pending = !item.error && item.media?.status !== "READY";
              return (
                <div key={item.key} className={`dm-album-draft-item ${item.error ? "error" : ""} ${pending ? "pending" : ""}`}>
                  {item.type === "VIDEO" ? <video src={item.preview} muted playsInline preload="metadata" /> : <img src={item.preview} alt="" />}
                  {pending && (
                    <span className="dm-album-progress" style={{ "--p": `${item.media ? 100 : item.progress}%` } as CSSProperties} aria-label={`Uploading ${item.progress}%`} />
                  )}
                  {item.error && <span className="dm-album-error" title={item.error}><CircleAlert size={18} /></span>}
                  {item.type === "VIDEO" && <span className="dm-album-kind"><Video size={12} /></span>}
                  <button type="button" className="dm-album-remove" aria-label="Remove" onPointerDown={(e) => e.preventDefault()} onClick={() => removeFromAlbum(item.key)}>
                    <X size={12} strokeWidth={3} />
                  </button>
                </div>
              );
            })}
            {album.length < MAX_ALBUM && (
              <button type="button" className="dm-album-add" aria-label="Add more photos or videos" onPointerDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>
                <Plus size={22} />
              </button>
            )}
          </div>
          <small>
            {album.length} {album.length === 1 ? "item" : "items"} ·{" "}
            {album.some((item) => item.error) ? "Remove the failed item to send" : albumReady ? "Add a caption or send" : "Uploading…"}
          </small>
        </div>
      )}
      {viewOnce && media && <p className="dm-notice">They can open it once. It disappears after it&apos;s viewed.</p>}
      {attachment.error && (
        <p className="dm-notice error" role="alert">
          {attachment.error}
        </p>
      )}
      <div className="dm-compose-row tg-row">
        <div className={`tg-field ${embed ? "has-embed" : ""}`}>
          {embed && (
            <div className={`tg-embed ${embed.kind}`} key={embed.key}>
              <span className="tg-embed-icon" aria-hidden="true">
                {embed.kind === "edit" ? <Pencil size={18} /> : <Reply size={20} />}
              </span>
              <button
                type="button"
                className="tg-embed-body"
                title="Show message"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onJumpTo(embed.message.id)}
              >
                {embed.thumb && <img className="tg-embed-thumb" src={embed.thumb} alt="" />}
                <span className="tg-embed-text">
                  <strong>{embed.title}</strong>
                  <span className="tg-embed-preview">
                    <QuoteSummary kind={embed.quoteKind} text={embed.text} durationMs={embed.message.audioDurationMs} />
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="tg-embed-close"
                aria-label={embed.kind === "edit" ? "Cancel edit" : "Cancel reply"}
                onPointerDown={(e) => e.preventDefault()}
                onClick={embed.kind === "edit" ? onCancelEdit : onCancelReply}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="tg-field-row">
          <StickerButton
            conversation
            dock={stickerDock}
            disabled={!canMessage || voiceActive}
            onEmoji={insertEmoji}
            onPick={(sticker) => onSend({ stickerId: sticker.id }, { sticker, hasSticker: true })}
            onGif={(gif) => onSend({ gifId: gif.id }, { gif })}
          />
          <textarea
            ref={fieldRef}
            aria-label="Message"
            placeholder="Message"
            maxLength={2000}
            value={text}
            // Never disabled while sending: disabling would blur it and close the phone keyboard.
            disabled={!canMessage}
            onChange={(e) => {
              setText(e.target.value);
              signalTyping(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onCancelReply();
                if (editing) onCancelEdit();
              }
              // Enter sends on devices with a keyboard; Shift+Enter keeps a new line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
          />
          {!editing && onTogether && !hasText && !album.length && !media && (
            <button
              type="button"
              className="dm-icon tg-together"
              aria-label="Gestures and games"
              title="Gestures and games"
              disabled={!canMessage || voiceActive}
              onPointerDown={(e) => e.preventDefault()}
              onClick={onTogether}
            >
              <Sparkles size={21} />
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="dm-icon tg-attach"
              aria-label="Attach photo or video"
              title="Photo or video"
              disabled={!canMessage || attachment.busy || voiceActive || !!media || album.length >= MAX_ALBUM}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={22} />
            </button>
          )}
          </div>
        </div>
        <div className={`tg-action ${showSend ? "is-send" : "is-mic"}`}>
          <button
            type="submit"
            className={`tg-send ${editing ? "is-edit" : ""}`}
            aria-label={editing ? "Save edit" : "Send message"}
            aria-hidden={!showSend || undefined}
            tabIndex={showSend ? undefined : -1}
            disabled={editing ? !text.trim() : !canSend}
            // Keep focus in the textarea so the phone keyboard stays open after sending.
            onPointerDown={(e) => e.preventDefault()}
          >
            {editing ? <Check size={22} strokeWidth={2.6} /> : <SendHorizontal size={21} strokeWidth={2.2} />}
          </button>
          {!callsBusy && (
            <VoiceRecorder
              buttonClassName="tg-mic"
              hidden={showSend}
              disabled={!canMessage || attachment.busy || !!media || showSend || album.length > 0}
              onActiveChange={onVoiceActiveChange}
              onSend={onSendAudio}
            />
          )}
        </div>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/*"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!files.length) return;
            if (album.length || files.length > 1) addToAlbum(files);
            else void attachment.select(files[0]);
          }}
        />
      </div>
    </form>
  );
}

/** Messages written without a connection survive a reload and go out once you are back online. */
const outboxKey = (userId: string, peerId: string) => `circle-outbox:${userId}:${peerId}`;
function savedOutbox(userId: string | undefined, peerId: string): Outgoing[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(outboxKey(userId, peerId)) ?? "[]") as Outgoing[];
    return Array.isArray(saved) ? saved.map((o) => ({ ...o, status: "waiting" as const })) : [];
  } catch {
    return [];
  }
}
function saveOutbox(userId: string | undefined, peerId: string, items: Outgoing[]) {
  if (!userId) return;
  try {
    const waiting = items.filter((o) => o.status === "waiting");
    if (waiting.length) localStorage.setItem(outboxKey(userId, peerId), JSON.stringify(waiting));
    else localStorage.removeItem(outboxKey(userId, peerId));
  } catch {
    /* storage unavailable */
  }
}
/** No answer at all (offline, or the server is restarting): worth sending again later. */
const unreachable = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 502;
const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

function Thread({ peer: initialPeer }: { peer: Models["MessagePeerDto"] }) {
  const calls = useCalls();
  const { user } = useSession();
  const status = useQuery({
    queryKey: ["messages", user?.id, "status", initialPeer.id],
    queryFn: ({ signal }) => api("messagesStatus", { params: { id: initialPeer.id }, signal }),
    // Fast enough for a live "typing..." indicator.
    refetchInterval: 2000,
  });
  const unavailable=status.data?.isUnavailable??initialPeer.isUnavailable;
  const nickname = unavailable ? null : (status.data?.nickname ?? null);
  const wallpaperUrl = unavailable ? null : (status.data?.wallpaperUrl ?? null);
  const peer={...initialPeer,isUnavailable:unavailable,isBlocking:status.data?.isBlocking??initialPeer.isBlocking,
    ...(unavailable?{displayName:"Circle user",avatarUrl:null,isVerified:false}: {}),
    ...(nickname?{displayName:nickname}:{})};

  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message|null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>(() => savedOutbox(user?.id, initialPeer.id));
  const [online, setOnline] = useState(isOnline);
  const [info, setInfo] = useState<InfoTab | null>(null);
  const [together, setTogether] = useState(false);
  const [babyOpen, setBabyOpen] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [stickerDock,setStickerDock]=useState<HTMLDivElement|null>(null);
  const [showJump, setShowJump] = useState(false);
  const [effect, setEffect] = useState<Effect | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sending = useRef(0);
  /** Confirmed messages keep the React key of their local copy, so they do not re-animate. */
  const [keyAlias, setKeyAlias] = useState<ReadonlyMap<string, string>>(() => new Map());
  const userId = user?.id;
  const peerId = peer.id;
  const threadKey = ["messages", userId, "thread", peerId];
  const thread = useInfiniteQuery({
    queryKey: threadKey,
    queryFn: ({ pageParam, signal }) =>
      api("messagesList", {
        params: { id: peerId },
        query: { cursor: pageParam, limit: 30 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => (p.hasMore ? (p.nextCursor ?? undefined) : undefined),
  });
  /**
   * Older messages load one page at a time as you scroll up. The distance from the bottom is
   * kept across the insert, so the view stays on the same message instead of jumping to the
   * top (which used to trigger the next load, and the next, all the way to the first message).
   */
  const topSentinel = useRef<HTMLDivElement>(null);
  const restore = useRef<number | null>(null);
  const loadOlder = () => {
    const el = scroller.current;
    if (!el || !thread.hasNextPage || thread.isFetchingNextPage || restore.current !== null) return;
    restore.current = el.scrollHeight - el.scrollTop;
    void thread.fetchNextPage().then((result) => {
      // Nothing was added: forget the saved position.
      if (result.isError) restore.current = null;
    });
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const fromBottom = restore.current;
    if (!el || fromBottom === null || thread.isFetchingNextPage) return;
    restore.current = null;
    el.scrollTop = el.scrollHeight - fromBottom;
  }, [thread.data, thread.isFetchingNextPage]);
  const maybeLoadOlder = () => {
    const el = scroller.current;
    // Only while the person is reading back, never on the first paint at the bottom.
    if (el && el.scrollHeight > el.clientHeight && !pinned.current) loadOlder();
  };
  const onTopVisible = useEffectEvent(maybeLoadOlder);
  const canLoadOlder = !!thread.hasNextPage && !thread.isFetchingNextPage;
  useEffect(() => {
    const node = topSentinel.current;
    const root = scroller.current;
    if (!node || !root || !canLoadOlder) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onTopVisible();
    }, { root, rootMargin: "240px 0px 0px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadOlder]);
  // Live updates: poll only the newest page and fold it into the cache.
  useEffect(() => {
    const key = ["messages", userId, "thread", peerId];
    let stopped = false;
    let busy = false;
    let timer: number | undefined;
    const tick = async () => {
      if (busy || stopped) return;
      window.clearTimeout(timer);
      busy = true;
      try {
        if (document.visibilityState === "visible" && !sending.current && client.getQueryData(key)) {
          const head = await api("messagesList", { params: { id: peerId }, query: { limit: 30 } });
          if (!stopped && !sending.current) {
            const cached = client.getQueryData<ThreadData>(key);
            const known = new Set(cached?.pages[0]?.items.map((m) => m.id));
            // A heart or confetti message that just arrived plays its screen effect.
            const arrived = head.items.find((m) => m.senderId !== userId && !known.has(m.id) && Date.parse(m.createdAt) > mountedAt && effectFor(m.content ?? m.sticker?.emoji));
            const arrivedKind = arrived && effectFor(arrived.content ?? arrived.sticker?.emoji);
            if (arrived && arrivedKind) setEffect({ kind: arrivedKind, key: arrived.id });
            const merged = mergeHead(cached, head);
            if (merged) client.setQueryData(key, merged);
            else void client.refetchQueries({ queryKey: key, exact: true });
          }
        }
      } catch {
        /* The next tick tries again. */
      } finally {
        busy = false;
      }
      if (!stopped) timer = window.setTimeout(tick, HEAD_POLL_MS);
    };
    timer = window.setTimeout(tick, HEAD_POLL_MS);
    const wake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [client, userId, peerId, mountedAt]);
  const confirmed = Array.from(
    new Map((thread.data?.pages.flatMap((p) => p.items) ?? []).map((m) => [m.id, m])).values(),
  ).reverse();
  const deliveries = new Map(outbox.map((o) => [o.message.id, o.status]));
  const messages = outbox.length ? [...confirmed, ...outbox.map((o) => o.message)] : confirmed;
  const latest = messages.at(-1)?.id;
  // Consecutive photos/videos from one person become one album entry.
  const entries: { message: Message; album?: Message[] }[] = [];
  for (const m of messages) {
    const previous = entries.at(-1);
    const tail = previous?.message;
    if (
      previous && tail && albumable(m) && albumable(tail) && tail.senderId === m.senderId && !tail.content && !m.replyTo &&
      Date.parse(m.createdAt) - Date.parse(tail.createdAt) < ALBUM_MS
    ) {
      previous.album = [...(previous.album ?? [tail]), m];
      previous.message = m;
    } else entries.push({ message: m });
  }
  const request = !!status.data?.isRequest;
  const canCall = !voiceActive && !calls.busy && !!status.data?.canSend && !request;
  const awaiting = !!status.data?.awaitingAcceptance;
  const typing = !!status.data?.peerTyping;
  const presenceText = unavailable ? "This account is unavailable" : presence(!!status.data?.peerOnline, status.data?.peerLastActiveAt);
  const subtitle = presenceText ?? peer.username;
  const chatTheme = (status.data?.theme ?? "default") as ChatThemeId;
  /** Telegram-style tray: the chat previews each theme while it is open. */
  const [themeTray, setThemeTray] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<ChatThemeId>("default");
  const openThemeTray = () => {
    setPreviewTheme(chatTheme);
    setThemeTray(true);
  };
  const shownTheme = themeTray ? previewTheme : chatTheme;
  // While trying themes on, show them as they are (a personal wallpaper would hide them).
  const shownWallpaper = themeTray ? null : wallpaperUrl;
  const statusKey = ["messages", userId, "status", peerId];
  const setTheme = (theme: ChatThemeId) => {
    const previous = status.data?.theme ?? null;
    haptic("tap");
    client.setQueryData<Models["MessageStatusDto"]>(statusKey, (d) => d && { ...d, theme: theme === "default" ? null : theme });
    api("messagesSetTheme", { params: { id: peerId }, body: { theme } }).then(
      () => toast(theme === "default" ? "Chat theme removed." : `Theme changed to ${CHAT_THEMES.find((t) => t.id === theme)?.name}.`),
      (e: Error) => {
        client.setQueryData<Models["MessageStatusDto"]>(statusKey, (d) => d && { ...d, theme: previous });
        toast(e.message, true);
      },
    );
  };
  const accept = useMutation({
    mutationFn: () => api("messagesAccept", { params: { id: peer.id } }),
    onSuccess: () => {
      haptic("success");
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const decline = useMutation({
    mutationFn: () => api("messagesDecline", { params: { id: peer.id } }),
    onSuccess: () => {
      toast("Request deleted.");
      void client.invalidateQueries({ queryKey: ["messages"] });
      router.push("/messages");
    },
    onError: (e) => toast(e.message, true),
  });
  const [unsending, setUnsending] = useState<Message[] | null>(null);
  const [sounds, setSounds] = useState(messageSoundsOn);
  const [deletingChat, setDeletingChat] = useState(false);
  /** The inbox row and streak follow what was just sent; the thread itself is updated in place. */
  const refreshAround = () => {
    void client.invalidateQueries({ queryKey: ["messages", userId, "conversations"] });
    void client.invalidateQueries({ queryKey: ["messages", userId, "streak", peerId] });
  };
  const unsend = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api("messagesDelete", { params: { id } });
    },
    onMutate: (ids) => {
      setUnsending(null);
      const previous = client.getQueryData<ThreadData>(threadKey);
      client.setQueryData<ThreadData>(threadKey, (d) => ids.reduce((data, id) => dropMessage(data, id), d));
      return { previous };
    },
    onSuccess: (_data, ids) => {
      toast(ids.length > 1 ? `${ids.length} items unsent.` : "Message unsent.");
      refreshAround();
      void client.invalidateQueries({ queryKey: ["messages", userId, "favorites", peerId] });
    },
    onError: (e, _id, context) => {
      if (context?.previous) client.setQueryData(threadKey, context.previous);
      toast(e.message, true);
    },
  });
  const deleteChat = useMutation({
    mutationFn: () => api("messagesDeleteConversation", { params: { id: peer.id } }),
    onSuccess: () => {
      setDeletingChat(false);
      toast("Chat deleted.");
      client.removeQueries({ queryKey: threadKey });
      void client.invalidateQueries({ queryKey: ["messages"] });
      router.push("/messages");
    },
    onError: (e) => toast(e.message, true),
  });
  const read = useMutation({
    mutationFn: (id: string) => api("messagesRead", { params: { id } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["messages", userId, "conversations"] });
      void client.invalidateQueries({ queryKey: ["messages", userId, "unread"] });
    },
  });
  const markRead = read.mutate;
  const lastAcknowledged=useRef<string|null>(null);
  useEffect(() => {
    // A loaded thread behind another dialog, in a background tab or scrolled away from
    // new messages is not a read receipt. Observe the bubbles within this thread's viewport.
    const pending=thread.data?.pages.flatMap(page=>page.items).filter(message=>message.recipientId===user?.id&&!message.readAt)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))??[];
    if(!pending.length)return;
    const acknowledge = () => {
      if(!status.data||status.data.isRequest||status.data.isUnavailable||document.visibilityState!=='visible'||!document.hasFocus()||document.querySelector('dialog[open]'))return;
      const frame=scroller.current?.getBoundingClientRect();if(!frame)return;
      const visible=pending.find(message=>{
        const node=document.getElementById(`msg-${message.id}`),box=node?.getBoundingClientRect();
        if(!box||Math.min(box.bottom,frame.bottom)-Math.max(box.top,frame.top)<Math.min(box.height*.6,80))return false;
        const top=Math.max(box.top,frame.top),bottom=Math.min(box.bottom,frame.bottom);
        return node!.contains(document.elementFromPoint((Math.max(box.left,frame.left)+Math.min(box.right,frame.right))/2,(top+bottom)/2));
      });
      if(visible&&lastAcknowledged.current!==visible.id){lastAcknowledged.current=visible.id;markRead(visible.id,{onError:()=>{lastAcknowledged.current=null;}});}
    };
    const observer=new IntersectionObserver(acknowledge,{root:scroller.current,threshold:[0,.6,1]});
    for(const message of pending){const node=document.getElementById(`msg-${message.id}`);if(node)observer.observe(node);}
    const dialogs=new MutationObserver(acknowledge);dialogs.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open'],childList:true});
    const frame=requestAnimationFrame(acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    window.addEventListener('focus',acknowledge);
    return () => {observer.disconnect();dialogs.disconnect();cancelAnimationFrame(frame);document.removeEventListener("visibilitychange", acknowledge);window.removeEventListener('focus',acknowledge);};
  }, [thread.data, user?.id, markRead, status.data]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (pinned.current && scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    if (messageList.current) observer.observe(messageList.current);
    // The sticker tray and keyboard resize the chat itself; keep the latest message in view.
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (pinned.current&&scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [latest]);

  /** Sends in order, one request at a time, while the bubble is already on screen. */
  const deliver = (localId: string, draft: Draft) => {
    sending.current += 1;
    const run = async () => {
      try {
        const sent = await api("messagesSend", { params: { id: peerId }, body: draft });
        setKeyAlias((aliases) => new Map(aliases).set(sent.id, localId));
        if (client.getQueryData(threadKey)) client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
        else void client.invalidateQueries({ queryKey: threadKey, exact: true });
        setOutbox((o) => o.filter((x) => x.message.id !== localId));
        refreshAround();
      } catch (e) {
        // No connection: keep it queued (clock icon) and send it when the phone is back online.
        const later = unreachable(e);
        setOutbox((o) => o.map((x) => (x.message.id === localId ? { ...x, status: later ? "waiting" : "failed" } : x)));
        if (!later) {
          toast(e instanceof Error ? e.message : "Message not sent.", true);
          void status.refetch();
        }
      } finally {
        sending.current -= 1;
      }
    };
    sendQueue.current = sendQueue.current.then(run, run);
  };
  const send = (draft: Draft, preview: Partial<Message>, options?: { noReply?: boolean }) => {
    if (!userId) return;
    const id = nextLocalId();
    const reply = options?.noReply ? null : replyTo;
    const message: Message = { ...blankMessage(id, userId, peerId), ...preview, replyTo: reply ? replyRef(reply) : null };
    pinned.current = true;
    setShowJump(false);
    setOutbox((o) => [...o, { message, draft: { ...draft, replyToId: reply?.id }, status: "sending" }]);
    setReplyTo(null);
    deliver(id, { ...draft, replyToId: reply?.id });
    const kind = effectFor(draft.content ?? preview.sticker?.emoji);
    if (kind) setEffect({ kind, key: id });
  };
  const react = (message: Message, emoji: string | null) => {
    if (!userId || message.id.startsWith(LOCAL_PREFIX)) return;
    const previous = message.reactions ?? [];
    const next = [...previous.filter((r) => r.userId !== userId), ...(emoji ? [{ userId, emoji }] : [])];
    client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { reactions: next }));
    (emoji ? api("messagesReact", { params: { id: message.id }, body: { emoji } }) : api("messagesUnreact", { params: { id: message.id } })).catch(
      (e: Error) => {
        client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { reactions: previous }));
        toast(e.message, true);
      },
    );
  };
  const retry = (id: string) => {
    const item = outbox.find((o) => o.message.id === id);
    if (!item) return;
    setOutbox((o) => o.map((x) => (x.message.id === id ? { ...x, status: "sending" } : x)));
    deliver(id, item.draft);
  };
  const discard = (id: string) => setOutbox((o) => o.filter((x) => x.message.id !== id));
  useEffect(() => saveOutbox(userId, peerId, outbox), [userId, peerId, outbox]);
  const resendWaiting = useEffectEvent(() => {
    if (!isOnline()) return;
    const waiting = outbox.filter((o) => o.status === "waiting");
    if (!waiting.length) return;
    setOutbox((o) => o.map((x) => (x.status === "waiting" ? { ...x, status: "sending" } : x)));
    for (const item of waiting) deliver(item.message.id, item.draft);
  });
  useEffect(() => {
    const up = () => {
      setOnline(true);
      resendWaiting();
    };
    const down = () => setOnline(false);
    const visible = () => document.visibilityState === "visible" && resendWaiting();
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    document.addEventListener("visibilitychange", visible);
    // Messages saved before a reload (or a lost connection) go out as soon as possible.
    const first = window.setTimeout(resendWaiting, 600);
    // Some phones never fire "online"; check again now and then while something waits.
    const timer = window.setInterval(resendWaiting, 15_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      document.removeEventListener("visibilitychange", visible);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  const startGame = (kind: GameKind) => {
    setTogether(false);
    haptic("tap");
    api("messagesStartGame", { params: { id: peerId }, body: { kind } }).then(
      (sent) => {
        pinned.current = true;
        setShowJump(false);
        client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
        refreshAround();
      },
      (e: Error) => toast(e.message, true),
    );
  };
  const sendGesture = (emoji: string) => {
    setTogether(false);
    send({ content: emoji }, { content: emoji }, { noReply: true });
  };
  const sendAudio = async (audioId: string) => {
    const reply = replyTo;
    const sent = await api("messagesSend", { params: { id: peerId }, body: { audioId, replyToId: reply?.id } });
    pinned.current = true;
    client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
    setReplyTo((current) => (current && current.id === reply?.id ? null : current));
    refreshAround();
  };
  const saveEdit = (message: Message, content: string) => {
    setEditing(null);
    const previous = { content: message.content, editedAt: message.editedAt };
    client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { content, editedAt: new Date().toISOString() }));
    api("messagesEdit", { params: { id: message.id }, body: { content } }).then(
      (saved) => client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, saved)),
      (e: Error) => {
        client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, previous));
        toast(e.message, true);
      },
    );
  };
  const toggleFavorite = (message: Message) => {
    const next = !message.isFavorite;
    haptic("tap");
    client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { isFavorite: next }));
    toast(next ? "Added to favorites." : "Removed from favorites.");
    api(next ? "messagesFavorite" : "messagesUnfavorite", { params: { id: message.id } }).then(
      () => void client.invalidateQueries({ queryKey: ["messages", userId, "favorites", peerId] }),
      (e: Error) => {
        client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { isFavorite: !next }));
        toast(e.message, true);
      },
    );
  };
  const [contactAction,setContactAction]=useState<"block"|"unblock"|null>(null);
  const contact=useMutation({
    mutationFn:(block:boolean)=>api(block?"followsBlock":"followsUnblock",{params:{id:peer.id}}),
    onSuccess:(_data,blocked)=>{
      setContactAction(null);
      void client.invalidateQueries();
      toast(blocked?"Account blocked.":"Account unblocked. Previous follows have not been restored.");
    },onError:error=>toast(error.message,true)
  });
  const canMessage = !unavailable && (status.data
    ? status.data.canSend
    : !peer.isBlocking && (!peer.isPrivate || peer.isFollowing));
  const flash = (el: HTMLElement) => {
    pinned.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  const jumpTo = async (id: string) => {
    let el = document.getElementById(`msg-${id}`);
    // Load older pages until the message is on screen (favorites can be far up).
    for (let i = 0; !el && i < 20; i++) {
      const pages = client.getQueryData<ThreadData>(threadKey)?.pages;
      if (!pages?.at(-1)?.hasMore) break;
      await thread.fetchNextPage();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      el = document.getElementById(`msg-${id}`);
    }
    if (!el) return toast("That message is no longer in this conversation.");
    flash(el);
  };
  const startReply = (m: Message) => {
    setEditing(null);
    setReplyTo(m);
    textRef.current?.focus({ preventScroll: true });
  };
  const startEdit = (m: Message) => {
    setReplyTo(null);
    setEditing(m);
    textRef.current?.focus({ preventScroll: true });
  };
  const toggleSounds = () => {
    setMessageSounds(!sounds);
    setSounds(!sounds);
  };
  return (
    <section
      className={`dm-thread ${themeTray ? "theming" : ""}`}
      {...themeAttributes(shownTheme, shownWallpaper)}
      aria-label={`Conversation with ${peer.displayName}`}
    >
      <ThemeStage theme={shownTheme} wallpaperUrl={shownWallpaper} />
      <header className="dm-thread-head">
        <Link className="dm-icon dm-back" href="/messages" aria-label="Back to conversations">
          <ArrowLeft size={24} />
        </Link>
        <button type="button" className="dm-thread-person" aria-label={`Chat info: ${peer.displayName}`} onClick={() => setInfo("media")}>
          <span className={`dm-avatar-wrap ${status.data?.peerOnline ? "online" : ""}`}>
            <Avatar user={peer} size={44} />
          </span>
          <span>
            <strong>
              <span className="dm-peer-name">{peer.displayName}</span>
              {peer.isVerified && <VerifiedBadge />}
            </strong>
            <small className={typing ? "typing" : ""} aria-live="polite">
              {typing ? (
                <>
                  <span className="dm-typing-dots" aria-hidden="true"><i /><i /><i /></span>
                  typing
                </>
              ) : (
                subtitle
              )}
            </small>
          </span>
        </button>
        <StreakChip peer={peer} />
        <div className="dm-thread-actions">
        <button type="button" className="dm-icon" aria-label="Start voice call" title="Voice call" disabled={!canCall} onClick={()=>calls.start(peer,"audio")}><Phone size={21}/></button>
        <button type="button" className="dm-icon" aria-label="Start video call" disabled={!canCall} onClick={()=>calls.start(peer,"video")}><Video size={22}/></button>
        <Dropdown label="Chat options" className="dm-chat-menu" summaryClassName="dm-icon" summary={<MoreHorizontal size={22} />}>
          <button type="button" onClick={() => setInfo("media")}>
            <Images size={16} /> Media and links
          </button>
          <button type="button" onClick={() => setInfo("favorites")}>
            <Star size={16} /> Favorite messages
          </button>
          {!unavailable && (
            <button type="button" onClick={openThemeTray}>
              <Palette size={16} /> Chat theme
            </button>
          )}
          {!unavailable && (
            <button type="button" onClick={() => setCustomize(true)}>
              <WandSparkles size={16} /> Nickname, wallpaper & sound
            </button>
          )}
          {canMessage && !request && (
            <button type="button" onClick={() => setTogether(true)}>
              <Gamepad2 size={16} /> Play a game
            </button>
          )}
          {!unavailable&&<Link href={`/profile/${peer.username}`}>
            <Info size={16} /> View profile
          </Link>}
          <button type="button" className={peer.isBlocking?"":"danger-text"} onClick={()=>setContactAction(peer.isBlocking?"unblock":"block")}>
            {peer.isBlocking?<ShieldOff size={16}/>:<Ban size={16}/>} {peer.isBlocking?"Unblock account":"Block account"}
          </button>
          <button type="button" onClick={toggleSounds}>
            {sounds ? <BellOff size={16} /> : <Bell size={16} />} {sounds ? "Mute message sounds" : "Turn on message sounds"}
          </button>
          <button type="button" className="danger-text" disabled={!messages.length} onClick={() => setDeletingChat(true)}>
            <Trash2 size={16} /> Delete chat
          </button>
        </Dropdown>
        </div>
      </header>
      {customize && (
        <ChatCustomize
          peer={initialPeer}
          nickname={nickname}
          wallpaperUrl={wallpaperUrl}
          themeName={CHAT_THEMES.find((t) => t.id === chatTheme)?.name ?? "Classic"}
          themeId={chatTheme}
          onTheme={() => {
            setCustomize(false);
            openThemeTray();
          }}
          onClose={() => setCustomize(false)}
        />
      )}
      {together && (
        <TogetherSheet
          peer={peer}
          canPlay={canMessage && !request && !awaiting}
          onGesture={sendGesture}
          onGame={startGame}
          onBaby={() => { setTogether(false); setBabyOpen(true); }}
          onClose={() => setTogether(false)}
        />
      )}
      {babyOpen && (
        <BabySheet
          peer={initialPeer}
          onRequested={(sent) => {
            pinned.current = true;
            client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
            refreshAround();
            setBabyOpen(false);
          }}
          onClose={() => setBabyOpen(false)}
        />
      )}
      {info && (
        <ChatInfo
          peer={peer}
          initialTab={info}
          presenceText={presenceText}
          canCall={canCall}
          sounds={sounds}
          onToggleSounds={toggleSounds}
          themeId={chatTheme}
          themeName={CHAT_THEMES.find((t) => t.id === chatTheme)?.name ?? "Classic"}
          onTheme={unavailable ? undefined : () => { setInfo(null); openThemeTray(); }}
          onBaby={canMessage && !request ? () => { setInfo(null); setBabyOpen(true); } : undefined}
          onBlock={() => { setInfo(null); setContactAction(peer.isBlocking ? "unblock" : "block"); }}
          onDelete={messages.length ? () => { setInfo(null); setDeletingChat(true); } : undefined}
          onCustomize={unavailable ? undefined : () => { setInfo(null); setCustomize(true); }}
          onTogether={canMessage && !request ? () => { setInfo(null); setTogether(true); } : undefined}
          onCall={(kind) => {
            setInfo(null);
            calls.start(peer, kind);
          }}
          onJump={(id) => {
            setInfo(null);
            requestAnimationFrame(() => void jumpTo(id));
          }}
          onClose={() => setInfo(null)}
        />
      )}
      {contactAction&&<ConfirmDialog className="ig-block-dialog" title={contactAction==="block"?"Block this account?":"Unblock this account?"}
        description={contactAction==="block"?"You won't be able to message or call each other. Your previous messages will stay in this chat. Follows are removed; their likes and comments on your posts are removed. They won't be notified.":"You can contact each other again, subject to account privacy. Previous follows, likes and comments are not restored."}
        confirmLabel={contactAction==="block"?"Block":"Unblock"} tone={contactAction==="block"?"danger":"primary"}
        pending={contact.isPending} onClose={()=>setContactAction(null)} onConfirm={()=>contact.mutate(contactAction==="block")}/>}
      {unsending && (
        <ConfirmDialog
          title={unsending.length > 1 ? `Unsend ${unsending.length} items?` : "Unsend message?"}
          description="It will be removed for everyone in this chat. This can't be undone."
          confirmLabel="Unsend"
          pending={unsend.isPending}
          onConfirm={() => unsend.mutate(unsending.map((m) => m.id))}
          onClose={() => setUnsending(null)}
        />
      )}
      {deletingChat && (
        <ConfirmDialog
          title="Delete this chat?"
          description={`All messages, photos and videos with ${peer.displayName} will be permanently deleted for both of you.`}
          confirmLabel="Delete chat"
          pending={deleteChat.isPending}
          onConfirm={() => deleteChat.mutate()}
          onClose={() => setDeletingChat(false)}
        />
      )}
      <div
        className="dm-scroll"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          pinned.current = distance < 80;
          // Reached the top by flinging: start the next page right away.
          if (el.scrollTop < 120 && !pinned.current) maybeLoadOlder();
          // Only re-render when crossing the threshold, never on every scroll event.
          const far = distance > 320;
          if (far !== showJump) setShowJump(far);
        }}
      >
        {!thread.hasNextPage && !thread.isPending && (
          <div className="dm-intro">
            <Avatar user={peer} size={96} />
            <strong>
              {peer.displayName}
              {peer.isVerified && <VerifiedBadge />}
            </strong>
            <span>{peer.username} · Circle</span>
            {!unavailable&&<Link className="dm-button secondary" href={`/profile/${peer.username}`}>
              View profile
            </Link>}
          </div>
        )}
        {thread.hasNextPage && (
          <div className="dm-older" ref={topSentinel} role="status" aria-live="polite">
            {thread.isFetchingNextPage ? (
              <span className="dm-older-spinner" aria-label="Loading earlier messages" />
            ) : (
              <button type="button" className="dm-older-button" onClick={loadOlder}>
                Load earlier messages
              </button>
            )}
          </div>
        )}
        {thread.isPending && (
          <ol className="dm-messages dm-messages-skeleton" aria-busy="true" aria-label="Loading messages">
            {[62, 38, 74, 46, 58].map((width, i) => (
              <li key={i} className={`dm-skeleton-bubble ${i % 2 ? "own" : ""}`} style={{ width: `${width}%` }} />
            ))}
          </ol>
        )}
        {thread.error && <ErrorState error={thread.error} retry={() => void thread.refetch()} />}
        <ol className="dm-messages" ref={messageList}>
          {entries.map((entry, i) => {
            const m = entry.message;
            const head = entry.album?.[0] ?? m;
            const prevEntry = entries[i - 1];
            const prev = prevEntry?.message;
            const next = entries[i + 1] && (entries[i + 1].album?.[0] ?? entries[i + 1].message);
            const at = Date.parse(head.createdAt);
            const separated =
              !prev ||
              at - Date.parse(prev.createdAt) > SEPARATOR_MS ||
              new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const nextSeparated =
              !next ||
              Date.parse(next.createdAt) - at > SEPARATOR_MS ||
              new Date(next.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const first =
              separated || prev.senderId !== m.senderId || at - Date.parse(prev.createdAt) > GROUP_MS;
            const last =
              nextSeparated || next.senderId !== m.senderId || Date.parse(next.createdAt) - at > GROUP_MS;
            const states = (entry.album ?? [m]).map((x) => deliveries.get(x.id));
            const delivery: Delivery | undefined = states.includes("failed") ? "failed" : states.includes("sending") ? "sending" : states.includes("waiting") ? "waiting" : undefined;
            const failedIds = (entry.album ?? [m]).filter((x) => deliveries.get(x.id) === "failed").map((x) => x.id);
            const key = keyAlias.get(head.id) ?? head.id;
            return (
              <Fragment key={key}>
                {separated && (
                  <li className="dm-separator" role="separator">
                    <span>{separatorLabel(m.createdAt)}</span>
                  </li>
                )}
                <MessageItem
                  message={m}
                  own={m.senderId === user?.id}
                  peer={peer}
                  first={first}
                  last={last}
                  album={entry.album}
                  enter={at > mountedAt}
                  delivery={delivery}
                  onRetry={delivery ? () => failedIds.forEach(retry) : undefined}
                  onRematch={canMessage ? startGame : undefined}
                  onBaby={() => setBabyOpen(true)}
                  onDiscard={delivery ? () => failedIds.forEach(discard) : undefined}
                  onReply={startReply}
                  onJump={jumpTo}
                  onUnsend={(message, album) => setUnsending(album ?? [message])}
                  onEdit={startEdit}
                  onFavorite={toggleFavorite}
                  onReact={react}
                  onCall={canCall ? (kind) => calls.start(peer, kind) : undefined}
                />
              </Fragment>
            );
          })}
          {typing && (
            <li className="dm-message first last dm-typing-row enter" aria-label={`${peer.displayName} is typing`}>
              <span className="dm-message-avatar" aria-hidden="true">
                <Avatar user={peer} size={28} />
              </span>
              <span className="dm-bubble dm-typing" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </li>
          )}
        </ol>
      </div>
      <button
        type="button"
        className={`dm-jump-latest ${showJump ? "show" : ""}`}
        aria-label="Jump to latest message"
        tabIndex={showJump ? undefined : -1}
        aria-hidden={!showJump || undefined}
        onClick={() => {
          const el = scroller.current;
          pinned.current = true;
          setShowJump(false);
          el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }}
      >
        <ChevronDown size={22} />
      </button>
      {!online && (
        <div className="dm-offline" role="status">
          <WifiOff size={15} /> No connection. Messages will send when you&apos;re back online.
        </div>
      )}
      {unavailable ? <div className="dm-blocked-state" role="status">
        <Ban size={22}/><strong>{peer.isBlocking?"You blocked this account":"You can't message this account"}</strong>
        <p>Your previous messages are still here. New messages and calls are unavailable.</p>
        {peer.isBlocking&&<button type="button" className="button secondary small" onClick={()=>setContactAction("unblock")}>Unblock</button>}
      </div> : request ? (
        <div className="dm-request">
          <strong>Accept message request from {peer.username}?</strong>
          <p>
            If you accept, {peer.displayName} can keep messaging you and will see when you&apos;ve
            read their messages.
          </p>
          <div className="dm-request-actions">
            <button
              type="button"
              className="dm-button secondary danger"
              disabled={decline.isPending || accept.isPending}
              onClick={() => decline.mutate()}
            >
              Delete
            </button>
            <button
              type="button"
              className="dm-button"
              disabled={decline.isPending || accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? "Accepting..." : "Accept"}
            </button>
          </div>
        </div>
      ) : (
        <Composer
          peer={peer}
          canMessage={canMessage}
          awaiting={awaiting}
          callsBusy={calls.busy}
          fieldRef={textRef}
          stickerDock={stickerDock}
          voiceActive={voiceActive}
          onVoiceActiveChange={setVoiceActive}
          replyTo={replyTo}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onJumpTo={(id) => void jumpTo(id)}
          onSaveEdit={saveEdit}
          onSend={send}
          onSendAudio={sendAudio}
          onTogether={() => setTogether(true)}
        />
      )}
      <div className="dm-sticker-dock" ref={setStickerDock}/>
      {themeTray && (
        <ThemeTray
          current={chatTheme}
          value={previewTheme}
          onChange={setPreviewTheme}
          onApply={(theme) => {
            setThemeTray(false);
            setTheme(theme);
          }}
          onCancel={() => setThemeTray(false)}
        />
      )}
      {!unavailable && !themeTray && <BabyBubble peer={peer} onOpen={() => setBabyOpen(true)} />}
      {effect && <ScreenEffect key={effect.key} effect={effect} onDone={() => setEffect(null)} />}
    </section>
  );
}

function ConversationRow({
  conversation: c,
  active,
  own,
}: {
  conversation: Conversation;
  active: boolean;
  own: boolean;
}) {
  const unread = c.unreadCount > 0;
  return (
    <li>
      <Link
        className={`dm-row ${active ? "active" : ""} ${unread ? "unread" : ""}`}
        href={`/messages?to=${encodeURIComponent(c.user.username)}`}
        aria-current={active ? "page" : undefined}
        title={c.nickname ?? c.user.displayName}
      >
        <span className={`dm-avatar-wrap ${c.online ? "online" : ""}`}>
          <Avatar user={c.user} size={56} />
          {c.online && <span className="sr-only">Active now</span>}
        </span>
        <span className="dm-row-copy">
          <strong>
            {c.nickname ?? c.user.displayName}
            {!!c.streakDays&&<span className={`dm-streak-badge ${c.streakFading?"fading":""}`} aria-label={`${c.streakDays} day streak${c.streakFading?", about to end":""}`}><FlameIcon size={14} dim={c.streakFading}/>{c.streakDays}{c.streakFading&&<span aria-hidden="true">⌛</span>}</span>}
            {c.user.isVerified && <VerifiedBadge />}
          </strong>
          <span>
            {own && !c.lastMessage.call && <Ticks message={c.lastMessage} />}
            <span className="dm-row-preview">{preview(c.lastMessage, own)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={c.lastMessage.createdAt}>{shortTime(c.lastMessage.createdAt)}</time>
          </span>
        </span>
        {unread && (
          <span className="dm-unread-dot">
            <span className="sr-only">{c.unreadCount} unread</span>
          </span>
        )}
      </Link>
    </li>
  );
}

function useConversations(folder: Folder, enabled: boolean) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: ["messages", user?.id, "conversations", folder],
    queryFn: ({ pageParam, signal }) =>
      api("messagesConversations", {
        query: { cursor: pageParam, limit: 20, folder },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => (p.hasMore ? (p.nextCursor ?? undefined) : undefined),
    enabled,
    refetchInterval: 10000,
  });
}

export default function Messages() {
  const { user, loading } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const to = params.get("to") ?? "";
  const groupId=params.get('group')??'';
  const [creating, setCreating] = useState(false);
  const [creatingGroup,setCreatingGroup]=useState(false);
  const groups=useGroups();
  const [folder, setFolder] = useState<Folder>("primary");
  const [search, setSearch] = useState("");
  const primary = useConversations("primary", !!user);
  const requests = useConversations("requests", !!user);
  const conversations = folder === "primary" ? primary : requests;
  const peer = useQuery({
    queryKey: ["message-peer", user?.id, to],
    queryFn: ({ signal }) => api("messagesPeer", { params: { username: to }, signal }),
    enabled: !!to && !!user,
    refetchInterval: 5000,
  });
  // Mobile: the inbox is pinned between the header and the bottom navigation, so the page
  // itself must not keep a scroll offset carried over from the previous page.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dm-page");
    window.scrollTo(0, 0);
    return () => root.classList.remove("dm-page");
  }, []);
  // Mobile: an open chat covers the whole screen (header and bottom navigation included) and
  // follows the visual viewport, so the composer stays above the on-screen keyboard.
  useEffect(() => {
    if (!to&&!groupId) return;
    const root = document.documentElement;
    root.classList.add("dm-chat-open");
    const viewport = window.visualViewport;
    const resize = () => {
      root.style.setProperty("--dm-viewport", `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--dm-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      root.classList.remove("dm-chat-open");
      root.style.removeProperty("--dm-viewport");
      root.style.removeProperty("--dm-viewport-top");
    };
  }, [to,groupId]);
  if (loading) return <p role="status">Loading...</p>;
  if (!user)
    return (
      <SignInPrompt
        title="Your conversations"
        description="Sign in to send messages and videos."
      />
    );
  const term = search.trim().toLowerCase();
  const items = (conversations.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (c) =>
      !term ||
      c.user.username.toLowerCase().includes(term) ||
      c.user.displayName.toLowerCase().includes(term),
  );
  const requestCount = requests.data?.pages.flatMap((p) => p.items).length ?? 0;
  const groupItems=folder==='primary'?(groups.data?.pages.flatMap(page=>page.items)??[]).filter(group=>!term||group.name.toLowerCase().includes(term)):[];
  return (
    <div className={`dm-shell card ${to||groupId ? "has-chat" : ""}`}>
      <h1 className="sr-only">Messages</h1>
      <aside className="dm-sidebar" aria-label="Conversations">
        <header className="dm-sidebar-head">
          <strong>{user.username}</strong>
          <div className="dm-inbox-actions">
          <button type="button" className="dm-icon" aria-label="New group chat" title="New group chat" onClick={()=>setCreatingGroup(true)}><Users size={21}/></button>
          <button
            type="button"
            className="dm-icon dm-new-message"
            aria-label="New message"
            title="New message"
            onClick={() => setCreating(true)}
          >
            <SquarePen size={21} />
          </button>
          </div>
        </header>
        <label className="dm-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search conversations"
            placeholder="Search"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <NotesTray />
        <div className="dm-tabs" role="tablist" aria-label="Conversation folders">
          {(["primary", "requests"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={folder === f}
              className={folder === f ? "active" : ""}
              onClick={() => setFolder(f)}
            >
              {f === "primary" ? "Primary" : "Requests"}
              {f === "requests" && requestCount > 0 && (
                <span className="dm-tab-count">
                  {requestCount}
                  {requests.hasNextPage ? "+" : ""}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="dm-list-scroll">
          {conversations.isPending && (
            <p className="dm-status" role="status">
              Loading conversations...
            </p>
          )}
          {conversations.error && (
            <ErrorState
              error={conversations.error}
              retry={() => void conversations.refetch()}
            />
          )}
          <ul className="dm-list">
            {groupItems.map(group=><li key={group.id}><Link href={`/messages?group=${group.id}`} className={`dm-row dm-group-row ${groupId===group.id?'active':''}`} aria-current={groupId===group.id?'page':undefined}><GroupAvatar group={group}/><span className="dm-row-copy"><strong>{group.name}</strong><span className="dm-row-preview">{group.lastMessage??`${group.memberCount} members`}</span></span>{group.unreadCount>0&&<span className="group-unread" aria-label={`${group.unreadCount} unread`}>{group.unreadCount}</span>}</Link></li>)}
            {items.map((c) => (
              <ConversationRow
                key={c.user.id}
                conversation={c}
                active={c.user.username === to}
                own={c.lastMessage.senderId === user.id}
              />
            ))}
          </ul>
          {!conversations.isPending && !conversations.error && !items.length && !groupItems.length && (
            <p className="dm-list-empty">
              {term
                ? "No conversations match your search."
                : folder === "requests"
                  ? "No message requests. Messages from people you don't follow appear here."
                  : "No messages yet. Start a conversation to say hello."}
            </p>
          )}
          <LoadMore
            hasMore={conversations.hasNextPage}
            pending={conversations.isFetchingNextPage}
            onClick={() => void conversations.fetchNextPage()}
          />
          {folder==='primary'&&<LoadMore hasMore={groups.hasNextPage} pending={groups.isFetchingNextPage} onClick={()=>void groups.fetchNextPage()}/>}
        </div>
      </aside>
      <div className="dm-main">
        {groupId?<GroupThread key={groupId} id={groupId} renderMessage={(message,actions)=><MessageItem message={message} peer={{...message.sender,isUnavailable:!message.sender.username,isBlocking:false,isFollowing:false}} {...actions}/>}/>:to ? (
          peer.isPending ? (
            <p className="dm-status" role="status">
              Loading conversation...
            </p>
          ) : peer.error ? (
            <div className="dm-empty">
              <ErrorState error={peer.error} retry={() => void peer.refetch()} />
              <Link className="dm-button secondary" href="/messages">
                Back to messages
              </Link>
            </div>
          ) : (
            peer.data && (
              <Thread key={peer.data.id} peer={peer.data} />
            )
          )
        ) : (
          <div className="dm-empty">
            <span className="dm-empty-icon">
              <Send size={44} strokeWidth={1.4} />
            </span>
            <h2>Your messages</h2>
            <p>Send private messages, videos and Reels to a friend.</p>
            <button type="button" className="dm-button" onClick={() => setCreating(true)}>
              Send message
            </button>
          </div>
        )}
      </div>
      {creatingGroup&&<CreateGroup onClose={()=>setCreatingGroup(false)}/>}
      {creating && (
        <Modal title="New message" onClose={() => setCreating(false)}>
          <RecipientPicker
            onSelect={(p) => {
              setCreating(false);
              router.push(`/messages?to=${encodeURIComponent(p.username)}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
