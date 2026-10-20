"use client";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCheck,
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
  Info,
  Search,
  Send,
  Smile,
  SquarePen,
  Video,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Ban,
  ShieldOff,
  Flame,
  Star,
  X,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { useMediaAttachment } from "@/lib/use-media-attachment";
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
import MessageStreak from "./message-streak";
import { ImageViewer } from "./image-viewer";
import { GifView, StickerButton, StickerView } from './sticker-picker';
import { VoiceMessage, VoiceRecorder } from './voice-message';

type Message = Models["DirectMessageDto"];
type Conversation = Models["ConversationDto"];
type Folder = "primary" | "requests";

/** Consecutive messages from one sender within this window share a bubble group. */
const GROUP_MS = 5 * 60_000;
/** A gap this long (or a new day) gets a centered date/time separator. */
const SEPARATOR_MS = 60 * 60_000;
const EMOJIS = [
  "😀", "😂", "🥹", "😍", "🥰", "😘", "😎", "🤩", "🤔", "😅",
  "😭", "😡", "👍", "👎", "👏", "🙏", "💪", "🔥", "✨", "🎉",
  "❤️", "💙", "💔", "💯", "👀", "🙌", "🤝", "😴", "🤯", "🥳",
];

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

/** WhatsApp-style receipt: one grey tick sent, two grey delivered, two blue read. */
function Ticks({ message }: { message: Message }) {
  const state = message.readAt ? "read" : message.deliveredAt ? "delivered" : "sent";
  const label = state === "read" ? "Read" : state === "delivered" ? "Delivered" : "Sent";
  return (
    <span className={`dm-ticks ${state}`} role="img" aria-label={label} title={label}>
      {state === "sent" ? <Check size={15} strokeWidth={2.4} /> : <CheckCheck size={15} strokeWidth={2.4} />}
    </span>
  );
}

function Stamp({ message, own }: { message: Message; own: boolean }) {
  return (
    <span className="dm-stamp">
      <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
      {own && <Ticks message={message} />}
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
  UNAVAILABLE: "Message unavailable",
};

const voiceLength = (ms: number | null | undefined) =>
  ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}` : "";
/** Icon and words for what a quoted message holds, like WhatsApp ("🎤 Voice message 0:12"). */
function QuoteSummary({ kind, text, durationMs }: { kind: Models["MessageReplyRefDto"]["kind"]; text: string | null; durationMs?: number | null }) {
  const Icon = kind === "AUDIO" ? Mic : kind === "PHOTO" ? Camera : kind === "VIDEO" ? Video : kind === "STICKER" ? StickerIcon
    : kind === "GIF" ? ImageIcon : kind === "VIEW_ONCE" ? Eye : kind === "CALL" ? Phone : null;
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

function MessageItem({
  message,
  own,
  peer,
  first,
  last,
  onReply,
  onJump,
  onUnsend,
  onCall,
}: {
  message: Message;
  own: boolean;
  peer: Models["MessagePeerDto"];
  first: boolean;
  last: boolean;
  onReply: (message: Message) => void;
  onJump: (id: string) => void;
  onUnsend: (message: Message) => void;
  /** Calls the peer again from a call history entry; absent while calling is unavailable. */
  onCall?: (kind: "audio" | "video") => void;
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
    const height = own ? 150 : 108;
    const top = window.innerHeight - rect.bottom > height + 16 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
    setMenu(
      own
        ? { mode: "popover", top, right: Math.max(8, Math.min(window.innerWidth - 228, window.innerWidth - rect.right)) }
        : { mode: "popover", top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)) },
    );
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const press = useRef<number | undefined>(undefined);
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
  const media = message.viewOnce ? null : message.media;
  const missing =
    !message.content && !media && !message.post && !message.storyReply && !message.viewOnce && !message.hasSticker && !message.audioUrl && !message.call && !message.gif;
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const { user } = useSession();
  const quoteAuthor = message.replyTo
    ? message.replyTo.senderId === user?.id
      ? "You"
      : peer.displayName
    : "";
  const hasText = !!message.content;
  return (
    <li
      id={`msg-${message.id}`}
      className={`dm-message ${own ? "own" : ""} ${first ? "first" : ""} ${last ? "last" : ""}`}
      style={drag ? { transform: `translateX(${drag}px)` } : undefined}
      // Touch: swipe a message to the right to reply, like WhatsApp.
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        // Scrubbing a voice note or using a player must not start a swipe-to-reply or the menu.
        if ((e.target as Element).closest(".wa-voice-wave, .wa-voice-play, .wa-voice-rate, video, audio, input")) return;
        swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        // Long-press opens the message menu (Reply / Copy / Unsend), like Instagram.
        window.clearTimeout(press.current);
        press.current = window.setTimeout(() => {
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
      onPointerUp={() => {
        window.clearTimeout(press.current);
        if (drag >= 56) {
          haptic("tap");
          onReply(message);
        }
        swipe.current = null;
        setDrag(0);
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
        {/* WhatsApp: a reply without text (voice note, sticker, GIF, photo) carries its quote on top. */}
        {message.replyTo && !hasText && !message.viewOnce && (
          <div className="dm-reply-head">
            <Quote reply={message.replyTo} author={quoteAuthor} onJump={() => onJump(message.replyTo!.id)} />
          </div>
        )}
        {message.storyReply && <StoryReplyPreview reply={message.storyReply} own={own} />}
        {message.noteReply && <NoteReplyPreview reply={message.noteReply} own={own} />}
        {message.viewOnce && <ViewOnceBubble message={message} own={own} />}
        {message.call&&<CallBubble message={message} own={own} onCall={onCall}/>}
        {message.audioUrl&&<VoiceMessage id={message.id} src={message.audioUrl} durationMs={message.audioDurationMs} own={own} author={own?user:peer}/>}
        {message.sticker?<MessageSticker sticker={message.sticker}/>:message.hasSticker?<p className="dm-bubble muted">Sticker unavailable</p>:null}
        {message.gif && <GifView gif={message.gif} className="dm-gif" />}
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
        {photoOpen&&media&&<ImageViewer src={media.url} alt="Photo in conversation" onClose={()=>setPhotoOpen(false)}/>}
        {message.post && <SharedPost post={message.post} />}
        {missing && <p className="dm-bubble muted">This attachment is no longer available.</p>}
        {hasText && !message.viewOnce && (
          <div className="dm-bubble">
            {message.replyTo && (
              <Quote
                reply={message.replyTo}
                author={quoteAuthor}
                onJump={() => onJump(message.replyTo!.id)}
              />
            )}
            <p>{message.content}</p>
            <Stamp message={message} own={own} />
          </div>
        )}
        {!hasText && !message.viewOnce && (
          <span className="dm-stamp standalone">
            <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
            {own && !message.call && <Ticks message={message} />}
          </span>
        )}
      </div>
      <div className="dm-hover-actions">
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
      </div>
      {menu &&
        createPortal(
          <div className={`dm-menu-layer ${menu.mode}`}>
            <div
              className={`dm-message-menu ${menu.mode}`}
              role="menu"
              ref={menuRef}
              style={menu.mode === "popover" ? { top: menu.top, left: menu.left, right: menu.right } : undefined}
            >
              {menu.mode === "sheet" && message.content && <p className="dm-menu-preview">{message.content}</p>}
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
              {own && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenu(null);
                    onUnsend(message);
                  }}
                >
                  <Trash2 size={18} /> Unsend
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
}

function EmojiButton({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="dm-emoji" ref={box}>
      <button
        type="button"
        className="dm-icon"
        aria-label="Choose an emoji"
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Smile size={24} />
      </button>
      {open && (
        <div className="dm-emoji-panel" role="listbox" aria-label="Emoji">
          {EMOJIS.map((emoji) => (
            <button
              type="button"
              key={emoji}
              role="option"
              aria-selected={false}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onPick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Draft = { content?: string; mediaId?: string; stickerId?:string;audioId?:string;gifId?:string;viewOnce?: boolean; replyToId?: string };

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
  const peer={...initialPeer,isUnavailable:unavailable,isBlocking:status.data?.isBlocking??initialPeer.isBlocking,
    ...(unavailable?{displayName:"Circle user",avatarUrl:null,isVerified:false}: {})};

  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [voiceActive,setVoiceActive]=useState(false);
  const [previewOpen,setPreviewOpen]=useState(false);
  const [stickerDock,setStickerDock]=useState<HTMLDivElement|null>(null);
  const attachment = useMediaAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const typingSent = useRef(0);
  const thread = useInfiniteQuery({
    queryKey: ["messages", user?.id, "thread", peer.id],
    queryFn: ({ pageParam, signal }) =>
      api("messagesList", {
        params: { id: peer.id },
        query: { cursor: pageParam, limit: 30 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => (p.hasMore ? (p.nextCursor ?? undefined) : undefined),
    refetchInterval: 3000,
  });
  const messages = Array.from(
    new Map((thread.data?.pages.flatMap((p) => p.items) ?? []).map((m) => [m.id, m])).values(),
  ).reverse();
  const latest = messages.at(-1)?.id;
  const request = !!status.data?.isRequest;
  const canCall = !voiceActive && !calls.busy && !!status.data?.canSend && !request;
  const awaiting = !!status.data?.awaitingAcceptance;
  const typing = !!status.data?.peerTyping;
  const subtitle = unavailable ? "This account is unavailable" : typing
    ? "typing..."
    : (presence(!!status.data?.peerOnline, status.data?.peerLastActiveAt) ?? peer.username);
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
  const [unsending, setUnsending] = useState<Message | null>(null);
  const [sounds, setSounds] = useState(messageSoundsOn);
  const [deletingChat, setDeletingChat] = useState(false);
  const unsend = useMutation({
    mutationFn: (id: string) => api("messagesDelete", { params: { id } }),
    onSuccess: () => {
      setUnsending(null);
      toast("Message unsent.");
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const deleteChat = useMutation({
    mutationFn: () => api("messagesDeleteConversation", { params: { id: peer.id } }),
    onSuccess: () => {
      setDeletingChat(false);
      toast("Chat deleted.");
      client.removeQueries({ queryKey: ["messages", user?.id, "thread", peer.id] });
      void client.invalidateQueries({ queryKey: ["messages"] });
      router.push("/messages");
    },
    onError: (e) => toast(e.message, true),
  });
  const read = useMutation({
    mutationFn: (id: string) => api("messagesRead", { params: { id } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["messages"] }),
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
  // Grow the composer with its content, Instagram-style, up to the CSS max-height.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
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
  const send = useMutation({
    mutationFn: (draft: Draft) => api("messagesSend", { params: { id: peer.id }, body: draft }),
    onSuccess: (_message, draft) => {
      attachment.attached();
      setViewOnce(false);
      // Keep a reply the person started meanwhile; only the one just sent is done.
      setReplyTo((current) => (current && current.id === draft.replyToId ? null : current));
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e, draft) => {
      // Give the text back so nothing typed is lost.
      if (draft.content) setText((current) => current || draft.content!);
      toast(e.message, true);
      void status.refetch();
    },
  });
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
  const canSend =
    canMessage &&
    !send.isPending &&
    !voiceActive &&
    !attachment.busy &&
    !attachment.error &&
    (!!text.trim() || !!attachment.media);
  const submit = () => {
    if (!canSend) return;
    const draft: Draft = {
      content: text.trim() || undefined,
      mediaId: attachment.media?.id,
      viewOnce: attachment.media ? viewOnce : undefined,
      replyToId: replyTo?.id,
    };
    // Clear at once (like WhatsApp) and keep the keyboard open for the next message.
    setText("");
    setReplyTo(null);
    typingSent.current = 0;
    send.mutate(draft);
    textRef.current?.focus({ preventScroll: true });
  };
  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return toast("That message is further up the conversation.");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  const startReply = (m: Message) => {
    setReplyTo(m);
    textRef.current?.focus({ preventScroll: true });
  };
  const media = attachment.media;
  return (
    <section className="dm-thread" aria-label={`Conversation with ${peer.displayName}`}>
      <header className="dm-thread-head">
        <Link className="dm-icon dm-back" href="/messages" aria-label="Back to conversations">
          <ArrowLeft size={24} />
        </Link>
        <Link className="dm-thread-person" href={`/profile/${peer.username}`}>
          <span className={`dm-avatar-wrap ${status.data?.peerOnline ? "online" : ""}`}>
            <Avatar user={peer} size={44} />
          </span>
          <span>
            <strong>
              {peer.displayName}
              {peer.isVerified && <VerifiedBadge />}
            </strong>
            <small className={typing ? "typing" : ""} aria-live="polite">
              {subtitle}
            </small>
          </span>
        </Link>
        <button type="button" className="dm-icon" aria-label="Start voice call" disabled={!canCall} onClick={()=>calls.start(peer,"audio")}><Phone size={21}/></button>
        <button type="button" className="dm-icon" aria-label="Start video call" disabled={!canCall} onClick={()=>calls.start(peer,"video")}><Video size={22}/></button>
        {!unavailable&&<Link className="dm-icon dm-info" href={`/profile/${peer.username}`} aria-label="View profile">
          <Info size={24} />
        </Link>}
        <Dropdown label="Chat options" className="dm-chat-menu" summaryClassName="dm-icon" summary={<MoreHorizontal size={24} />}>
          {!unavailable&&<Link href={`/profile/${peer.username}`}>
            <Info size={16} /> View profile
          </Link>}
          <button type="button" className={peer.isBlocking?"":"danger-text"} onClick={()=>setContactAction(peer.isBlocking?"unblock":"block")}>
            {peer.isBlocking?<ShieldOff size={16}/>:<Ban size={16}/>} {peer.isBlocking?"Unblock account":"Block account"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMessageSounds(!sounds);
              setSounds(!sounds);
            }}
          >
            {sounds ? <BellOff size={16} /> : <Bell size={16} />} {sounds ? "Mute message sounds" : "Turn on message sounds"}
          </button>
          <button type="button" className="danger-text" disabled={!messages.length} onClick={() => setDeletingChat(true)}>
            <Trash2 size={16} /> Delete chat
          </button>
        </Dropdown>
      </header>
      {contactAction&&<ConfirmDialog className="ig-block-dialog" title={contactAction==="block"?"Block this account?":"Unblock this account?"}
        description={contactAction==="block"?"You won't be able to message or call each other. Your previous messages will stay in this chat. Follows are removed; their likes and comments on your posts are removed. They won't be notified.":"You can contact each other again, subject to account privacy. Previous follows, likes and comments are not restored."}
        confirmLabel={contactAction==="block"?"Block":"Unblock"} tone={contactAction==="block"?"danger":"primary"}
        pending={contact.isPending} onClose={()=>setContactAction(null)} onConfirm={()=>contact.mutate(contactAction==="block")}/>}
      {unsending && (
        <ConfirmDialog
          title="Unsend message?"
          description="It will be removed for everyone in this chat. This can't be undone."
          confirmLabel="Unsend"
          pending={unsend.isPending}
          onConfirm={() => unsend.mutate(unsending.id)}
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
          if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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
        <LoadMore
          hasMore={thread.hasNextPage}
          pending={thread.isFetchingNextPage}
          onClick={() => void thread.fetchNextPage()}
        />
        {thread.isPending && (
          <p className="dm-status" role="status">
            Loading messages...
          </p>
        )}
        {thread.error && <ErrorState error={thread.error} retry={() => void thread.refetch()} />}
        {!unavailable&&<MessageStreak peerId={peer.id}/>}
        <ol className="dm-messages" ref={messageList}>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const at = Date.parse(m.createdAt);
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
            return (
              <Fragment key={m.id}>
                {separated && (
                  <li className="dm-separator" role="separator">
                    {separatorLabel(m.createdAt)}
                  </li>
                )}
                <MessageItem
                  message={m}
                  own={m.senderId === user?.id}
                  peer={peer}
                  first={first}
                  last={last}
                  onReply={startReply}
                  onJump={jumpTo}
                  onUnsend={setUnsending}
                  onCall={canCall ? (kind) => calls.start(peer, kind) : undefined}
                />
              </Fragment>
            );
          })}
          {typing && (
            <li className="dm-message first last dm-typing-row" aria-label={`${peer.displayName} is typing`}>
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
        <form
          className="dm-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {awaiting && (
            <p className="dm-notice">
              Message request sent. You can send more once {peer.displayName} accepts.
            </p>
          )}
          {!canMessage && !awaiting && (
            <p className="dm-notice">
              {peer.isBlocking
                ? "You blocked this account. Unblock it to send messages."
                : "Follow this private account before sending a message."}
            </p>
          )}
          {replyTo && (
            <div className="dm-replying">
              <Reply size={16} />
              <span>
                <strong>
                  Replying to {replyTo.senderId === user?.id ? "yourself" : peer.displayName}
                </strong>
                <small>
                  <QuoteSummary
                    kind={replyTo.viewOnce ? "VIEW_ONCE" : replyTo.content ? "TEXT" : replyTo.audioUrl ? "AUDIO" : replyTo.gif ? "GIF"
                      : replyTo.hasSticker ? "STICKER" : replyTo.call ? "CALL" : replyTo.media?.type === "VIDEO" ? "VIDEO" : replyTo.media ? "PHOTO" : "TEXT"}
                    text={replyTo.viewOnce ? null : replyTo.content || replyTo.sticker?.emoji || attachmentLabel(replyTo)}
                    durationMs={replyTo.audioDurationMs}
                  />
                </small>
              </span>
              {!replyTo.viewOnce && (replyTo.gif?.previewUrl ?? (replyTo.media?.type === "IMAGE" ? replyTo.media.url : replyTo.sticker?.url)) && (
                <img className="dm-quote-thumb" src={(replyTo.gif?.previewUrl ?? (replyTo.media?.type === "IMAGE" ? replyTo.media.url : replyTo.sticker?.url))!} alt="" />
              )}
              <button
                type="button"
                className="dm-icon"
                aria-label="Cancel reply"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setReplyTo(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(media||attachment.previewUrl) && (
            <div className="dm-attachment dm-attachment-preview">
              <div className="dm-draft-media">
                {(media?.type??attachment.previewType)==='IMAGE'?<button type="button" aria-label="Enlarge photo preview" onClick={()=>setPreviewOpen(true)}>
                  <img src={attachment.previewUrl??media?.url} alt="Photo preview before sending"/>
                </button>:<video src={attachment.previewUrl??media?.url} controls playsInline preload="metadata" aria-label="Video preview before sending"/>}
              </div>
              {previewOpen&&(attachment.previewUrl??media?.url)&&<ImageViewer src={(attachment.previewUrl??media?.url)!} alt="Photo preview" onClose={()=>setPreviewOpen(false)}/>}
              <div className="dm-draft-details">
              <span>
                {attachment.uploading?`Uploading… ${attachment.progress}%`:media?.status === "READY"
                  ? `${media.type === "IMAGE" ? "Photo" : "Video"} ready to send` : "Processing video..."}
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
                disabled={send.isPending}
                onClick={() => {
                  attachment.clear();
                  setViewOnce(false);
                  setPreviewOpen(false);
                }}
              >
                <X size={16} />
              </button>
              </div>
            </div>
          )}
          {viewOnce && media && (
            <p className="dm-notice">They can open it once. It disappears after it&apos;s viewed.</p>
          )}
          {attachment.uploading && (
            <p className="dm-notice" role="status">
              Uploading... {attachment.progress}%
            </p>
          )}
          {attachment.error && (
            <p className="dm-notice error" role="alert">
              {attachment.error}
            </p>
          )}
          <div className="dm-compose-row">
            <EmojiButton
              disabled={!canMessage||voiceActive}
              onPick={(emoji) => {
                const el = textRef.current;
                const start = el?.selectionStart ?? text.length;
                const end = el?.selectionEnd ?? text.length;
                const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, 2000);
                setText(next);
                signalTyping(next);
                requestAnimationFrame(() => {
                  el?.focus({ preventScroll: true });
                  el?.setSelectionRange(start + emoji.length, start + emoji.length);
                });
              }}
            />
            <StickerButton conversation dock={stickerDock} disabled={!canMessage||voiceActive||send.isPending||attachment.busy||!!media}
              onPick={sticker=>{send.mutate({stickerId:sticker.id,replyToId:replyTo?.id});setReplyTo(null);}}
              onGif={gif=>{send.mutate({gifId:gif.id,replyToId:replyTo?.id});setReplyTo(null);}}/>
            {!calls.busy&&<VoiceRecorder disabled={!canMessage||attachment.busy||!!media||send.isPending} onActiveChange={setVoiceActive}
              onSend={async id=>{await send.mutateAsync({audioId:id,replyToId:replyTo?.id});setReplyTo(null);}}/>}
            <textarea
              ref={textRef}
              aria-label="Message"
              placeholder="Message..."
              maxLength={2000}
              value={text}
              // Never disabled while sending: disabling would blur it and close the phone keyboard.
              disabled={!canMessage}
              onChange={(e) => {
                setText(e.target.value);
                signalTyping(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && replyTo) setReplyTo(null);
                // Enter sends on devices with a keyboard; Shift+Enter keeps a new line.
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  window.matchMedia("(hover: hover)").matches
                ) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
            />
            <input
              ref={inputRef}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void attachment.select(file);
              }}
            />
            {!text.trim() && !media ? (
              <button
                type="button"
                className="dm-icon"
                aria-label="Attach photo or video"
                disabled={!canMessage || attachment.busy||voiceActive}
                onClick={() => inputRef.current?.click()}
              >
                <ImageIcon size={24} />
              </button>
            ) : (
              <button
                type="submit"
                className="dm-send"
                aria-label="Send message"
                disabled={!canSend}
                // Keep focus in the textarea so the phone keyboard stays open after sending.
                onPointerDown={(e) => e.preventDefault()}
              >
                Send
              </button>
            )}
          </div>
        </form>
      )}
      <div className="dm-sticker-dock" ref={setStickerDock}/>
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
        title={c.user.displayName}
      >
        <span className={`dm-avatar-wrap ${c.online ? "online" : ""}`}>
          <Avatar user={c.user} size={56} />
          {c.online && <span className="sr-only">Active now</span>}
        </span>
        <span className="dm-row-copy">
          <strong>
            {c.user.displayName}
            {!!c.streakDays&&<span className={`dm-streak-badge ${c.streakFading?"fading":""}`} aria-label={`${c.streakDays} day streak`}><Flame size={14}/>{c.streakDays}</span>}
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
  const [creating, setCreating] = useState(false);
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
    if (!to) return;
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
  }, [to]);
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
  return (
    <div className={`dm-shell card ${to ? "has-chat" : ""}`}>
      <h1 className="sr-only">Messages</h1>
      <aside className="dm-sidebar" aria-label="Conversations">
        <header className="dm-sidebar-head">
          <strong>{user.username}</strong>
          <button
            type="button"
            className="dm-icon"
            aria-label="New message"
            onClick={() => setCreating(true)}
          >
            <SquarePen size={24} />
          </button>
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
            {items.map((c) => (
              <ConversationRow
                key={c.user.id}
                conversation={c}
                active={c.user.username === to}
                own={c.lastMessage.senderId === user.id}
              />
            ))}
          </ul>
          {!conversations.isPending && !conversations.error && !items.length && (
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
        </div>
      </aside>
      <div className="dm-main">
        {to ? (
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
