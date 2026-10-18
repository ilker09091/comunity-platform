"use client";
import { Fragment, useEffect, useRef, useState } from "react";
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
  Reply,
  Clapperboard,
  Info,
  Search,
  Send,
  Smile,
  SquarePen,
  Video,
  X,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { useMediaAttachment } from "@/lib/use-media-attachment";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import {
  Avatar,
  ErrorState,
  LoadMore,
  Modal,
  SignInPrompt,
  VerifiedBadge,
} from "./ui";
import { RecipientPicker } from "./social-controls";
import { MediaVideo } from "./media-video";
import { NotesTray } from "./notes";

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

function attachmentLabel(message: Message) {
  if (message.viewOnce) return message.viewOnceType === "VIDEO" ? "Video" : "Photo";
  if (message.media) return message.media.type === "IMAGE" ? "Photo" : "Video";
  if (message.post) return "Shared a post";
  return "Attachment unavailable";
}
function preview(message: Message, own: boolean) {
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
  UNAVAILABLE: "Message unavailable",
};

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
      <strong>{author}</strong>
      <span>{reply.preview || REPLY_KIND[reply.kind]}</span>
    </button>
  );
}

/** Full-screen view of a view-once photo/video; it cannot be reopened once closed. */
function ViewOnceViewer({ media, onClose }: { media: Models["MediaDto"]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dm-viewonce-viewer"
      aria-label="View once"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header>
        <span className="dm-once-badge" aria-hidden="true">1</span>
        <span>View once · it disappears when you close it</span>
        <button type="button" className="dm-icon" aria-label="Close" onClick={onClose}>
          <X size={24} />
        </button>
      </header>
      {media.type === "VIDEO" ? (
        <MediaVideo src={media.url} autoPlay playsInline controls controlsList="nodownload" />
      ) : (
        <img src={media.url} alt="View once photo" draggable={false} />
      )}
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

function MessageItem({
  message,
  own,
  peer,
  first,
  last,
  onReply,
  onJump,
}: {
  message: Message;
  own: boolean;
  peer: Models["UserProfileDto"];
  first: boolean;
  last: boolean;
  onReply: (message: Message) => void;
  onJump: (id: string) => void;
}) {
  const media = message.viewOnce ? null : message.media;
  const missing =
    !message.content && !media && !message.post && !message.storyReply && !message.viewOnce;
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
        if (e.pointerType === "touch") swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const start = swipe.current;
        if (!start || start.id !== e.pointerId) return;
        const dx = e.clientX - start.x;
        if (Math.abs(e.clientY - start.y) > 24 && Math.abs(dx) < 24) {
          swipe.current = null;
          setDrag(0);
          return;
        }
        setDrag(Math.max(0, Math.min(72, dx)));
      }}
      onPointerUp={() => {
        if (drag >= 56) {
          haptic("tap");
          onReply(message);
        }
        swipe.current = null;
        setDrag(0);
      }}
      onPointerCancel={() => {
        swipe.current = null;
        setDrag(0);
      }}
    >
      {!own && (
        <span className="dm-message-avatar" aria-hidden="true">
          {last && <Avatar user={peer} size={28} />}
        </span>
      )}
      <div className="dm-message-body" title={separatorLabel(message.createdAt)}>
        {message.storyReply && <StoryReplyPreview reply={message.storyReply} own={own} />}
        {message.viewOnce && <ViewOnceBubble message={message} own={own} />}
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
            <a href={media.url} target="_blank" rel="noreferrer" className="dm-photo">
              <img
                className="dm-media"
                src={media.url}
                alt="Photo"
                style={{
                  aspectRatio: media.width && media.height ? `${media.width}/${media.height}` : undefined,
                }}
              />
            </a>
          ))}
        {message.post && <SharedPost post={message.post} />}
        {missing && <p className="dm-bubble muted">This attachment is no longer available.</p>}
        {(hasText || message.replyTo) && !message.viewOnce && (
          <div className="dm-bubble">
            {message.replyTo && (
              <Quote
                reply={message.replyTo}
                author={quoteAuthor}
                onJump={() => onJump(message.replyTo!.id)}
              />
            )}
            {hasText && <p>{message.content}</p>}
            <Stamp message={message} own={own} />
          </div>
        )}
        {!hasText && !message.replyTo && !message.viewOnce && (
          <span className="dm-stamp standalone">
            <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
            {own && <Ticks message={message} />}
          </span>
        )}
      </div>
      <button
        type="button"
        className="dm-reply-action"
        aria-label="Reply"
        onClick={() => onReply(message)}
      >
        <Reply size={16} />
      </button>
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

type Draft = { content?: string; mediaId?: string; viewOnce?: boolean; replyToId?: string };

function Thread({ peer }: { peer: Models["UserProfileDto"] }) {
  const { user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
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
  const unreadId = [...messages]
    .reverse()
    .find((m) => m.recipientId === user?.id && !m.readAt)?.id;
  const status = useQuery({
    queryKey: ["messages", user?.id, "status", peer.id],
    queryFn: ({ signal }) => api("messagesStatus", { params: { id: peer.id }, signal }),
    // Fast enough for a live "typing..." indicator.
    refetchInterval: 2000,
  });
  const request = !!status.data?.isRequest;
  const awaiting = !!status.data?.awaitingAcceptance;
  const typing = !!status.data?.peerTyping;
  const subtitle = typing
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
  const read = useMutation({
    mutationFn: (id: string) => api("messagesRead", { params: { id } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["messages"] }),
  });
  const markRead = read.mutate;
  useEffect(() => {
    // Like Instagram, a request is not marked seen until it is accepted.
    const acknowledge = () => {
      if (unreadId && status.data && !status.data.isRequest && document.visibilityState === "visible")
        markRead(unreadId);
    };
    acknowledge();
    document.addEventListener("visibilitychange", acknowledge);
    return () => document.removeEventListener("visibilitychange", acknowledge);
  }, [unreadId, markRead, status.data]); // Read only through messages actually loaded in this thread.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (pinned.current && scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    if (messageList.current) observer.observe(messageList.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    pinned.current = true;
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
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
    onSuccess: () => {
      attachment.attached();
      setViewOnce(false);
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e, draft) => {
      // Give the text back so nothing typed is lost.
      if (draft.content) setText((current) => current || draft.content!);
      toast(e.message, true);
      void status.refetch();
    },
  });
  const canMessage = status.data
    ? status.data.canSend
    : !peer.isBlocking && (!peer.isPrivate || peer.isFollowing);
  const canSend =
    canMessage &&
    !send.isPending &&
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
        <Link className="dm-icon" href={`/profile/${peer.username}`} aria-label="View profile">
          <Info size={24} />
        </Link>
      </header>
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
            <Link className="dm-button secondary" href={`/profile/${peer.username}`}>
              View profile
            </Link>
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
      {request ? (
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
                <small>{replyTo.viewOnce ? "View once" : replyTo.content || attachmentLabel(replyTo)}</small>
              </span>
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
          {media && (
            <div className="dm-attachment">
              {media.status === "READY" && media.type === "IMAGE" ? (
                <img src={media.url} alt="" className="dm-attachment-thumb" />
              ) : media.type === "IMAGE" ? (
                <ImageIcon size={18} />
              ) : (
                <Video size={18} />
              )}
              <span>
                {media.status === "READY"
                  ? `${media.type === "IMAGE" ? "Photo" : "Video"} ready to send`
                  : "Processing video..."}
              </span>
              <button
                type="button"
                className={`dm-once-toggle ${viewOnce ? "on" : ""}`}
                aria-pressed={viewOnce}
                aria-label="View once"
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
                }}
              >
                <X size={16} />
              </button>
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
              disabled={!canMessage}
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
                disabled={!canMessage || attachment.busy}
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
            {c.user.isVerified && <VerifiedBadge />}
          </strong>
          <span>
            {own && <Ticks message={c.lastMessage} />}
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
    queryFn: ({ signal }) => api("usersGetProfile", { params: { username: to }, signal }),
    enabled: !!to && !!user,
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
