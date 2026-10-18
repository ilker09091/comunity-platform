"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Eye,
  Heart,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { useMediaAttachment } from "@/lib/use-media-attachment";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import {
  Avatar,
  ConfirmDialog,
  ErrorState,
  LoadMore,
  Modal,
  relativeTime,
} from "./ui";
import { MediaVideo } from "./media-video";

type Story = Models["StoryDto"];

function StoryComposer({ onClose }: { onClose: () => void }) {
  const [caption, setCaption] = useState("");
  const attachment = useMediaAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () =>
      api("storiesCreate", {
        body: {
          mediaId: attachment.media!.id,
          caption: caption.trim() || undefined,
        },
      }),
    onSuccess: () => {
      attachment.attached();
      void client.invalidateQueries({ queryKey: ["stories"] });
      toast("Your story is live for 24 hours.");
      onClose();
    },
    onError: (e) => toast(e.message, true),
  });
  const close = () => {
    attachment.clear();
    onClose();
  };
  return (
    <Modal
      title="Share a story"
      onClose={close}
      guardClose={() => !attachment.uploading && !create.isPending}
      className="story-composer"
    >
      <form
        className="story-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (attachment.media?.status === "READY" && !create.isPending)
            create.mutate();
        }}
      >
        <p className="social-hint">
          Visible to your followers for 24 hours. Choose a photo or a video up
          to 60 seconds.
        </p>
        <input
          hidden
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void attachment.select(file);
          }}
        />
        {!attachment.media ? (
          <button
            type="button"
            className="story-upload"
            disabled={attachment.uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={28} />
            <strong>
              {attachment.uploading
                ? `Uploading... ${attachment.progress}%`
                : "Choose photo or video"}
            </strong>
          </button>
        ) : (
          <div className="story-preview">
            {attachment.media.status === "READY" ? (
              attachment.media.type === "VIDEO" ? (
                <MediaVideo
                  src={attachment.media.url}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img src={attachment.media.url} alt="Story preview" />
              )
            ) : (
              <p role="status">Processing video...</p>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Remove story media"
              disabled={create.isPending}
              onClick={attachment.clear}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {attachment.error && <p role="alert">{attachment.error}</p>}
        <textarea
          className="social-input"
          aria-label="Story caption"
          placeholder="Add a caption..."
          maxLength={300}
          value={caption}
          disabled={create.isPending}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
        />
        <button
          className="button"
          type="submit"
          disabled={
            !attachment.media ||
            attachment.busy ||
            !!attachment.error ||
            create.isPending
          }
        >
          {create.isPending ? "Sharing..." : "Share story"}
        </button>
      </form>
    </Modal>
  );
}

const IMAGE_STORY_MS = 5000;
const QUICK_REACTIONS = ["\u{1F602}", "\u{1F62E}", "\u{1F60D}", "\u{1F622}", "\u{1F44F}", "\u{1F525}", "\u{1F389}", "\u{1F4AF}"];

/**
 * Full-screen story player. A single <dialog> stays open while the viewer moves between
 * stories (only the slide remounts), so navigation never closes and reopens the overlay.
 * Desktop: the page behind is blurred (see `.story-overlay::backdrop`); mobile: edge to edge.
 */
function StoryViewer({
  story,
  group,
  previousId,
  nextId,
  onSelect,
  onClose,
}: {
  story: Story;
  group: Story[];
  previousId?: string;
  nextId?: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  /** Typing a reply or browsing viewers keeps the story on screen. */
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const move = useCallback(
    (direction: number) => {
      if (direction < 0) {
        if (previousId) onSelect(previousId);
      } else onSelect(nextId ?? null);
    },
    [previousId, nextId, onSelect],
  );
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const visibility = () => setHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      root.style.overflow = overflow;
      dialog?.close();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.parse(story.expiresAt) <= Date.now()) onClose();
    }, 1000);
    return () => clearInterval(timer);
  }, [story.expiresAt, onClose]);
  const position = Math.max(
    0,
    group.findIndex((s) => s.id === story.id),
  );
  return (
    <dialog
      ref={ref}
      className="story-overlay"
      aria-label={`Story by ${story.author.displayName}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!deleting) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (deleting) return;
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === "ArrowRight") move(1);
        else if (e.key === "ArrowLeft") move(-1);
        else if (e.key === " " && e.target === e.currentTarget) {
          e.preventDefault();
          setPaused((p) => !p);
        }
      }}
    >
      <div
        className="story-overlay-inner"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <button
          className="story-nav prev"
          aria-label="Previous story"
          disabled={!previousId}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={22} />
        </button>
        <StorySlide
          key={story.id}
          story={story}
          group={group}
          position={position}
          muted={muted}
          setMuted={setMuted}
          paused={paused || held || hidden || deleting || busy}
          setBusy={setBusy}
          togglePause={() => setPaused((p) => !p)}
          setHeld={setHeld}
          move={move}
          onDelete={() => setDeleting(true)}
          onClose={onClose}
        />
        <button
          className="story-nav next"
          aria-label={nextId ? "Next story" : "Close story"}
          onClick={() => move(1)}
        >
          <ChevronRight size={22} />
        </button>
        <button
          className="story-overlay-close"
          aria-label="Close story"
          onClick={onClose}
        >
          <X size={26} />
        </button>
      </div>
      {deleting && (
        <StoryDelete
          story={story}
          onClose={() => setDeleting(false)}
          onDeleted={onClose}
        />
      )}
    </dialog>
  );
}

function StoryDelete({
  story,
  onClose,
  onDeleted,
}: {
  story: Story;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => api("storiesDelete", { params: { id: story.id } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["stories"] });
      onDeleted();
      toast("Story deleted.");
    },
    onError: (e) => toast(e.message, true),
  });
  return (
    <ConfirmDialog
      title="Delete this story?"
      description="Your followers will no longer be able to view it."
      confirmLabel="Delete story"
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    />
  );
}

function StorySlide({
  story,
  group,
  position,
  muted,
  setMuted,
  paused,
  togglePause,
  setHeld,
  setBusy,
  move,
  onDelete,
  onClose,
}: {
  story: Story;
  group: Story[];
  position: number;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  paused: boolean;
  togglePause: () => void;
  setHeld: (held: boolean) => void;
  setBusy: (busy: boolean) => void;
  move: (direction: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { user } = useSession();
  const client = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const press = useRef<{ x: number; at: number; timer?: number } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const recorded = useRef(false);
  const own = user?.id === story.author.id;
  const isVideo = story.media.type === "VIDEO";
  const viewed = useMutation({
    mutationFn: () => api("storiesView", { params: { id: story.id } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["stories"] }),
    // An expired or newly hidden story simply disappears from the tray on the next refresh.
    onError: () => void client.invalidateQueries({ queryKey: ["stories"] }),
  });
  const record = () => {
    setReady(true);
    if (!own && !recorded.current) {
      recorded.current = true;
      viewed.mutate();
    }
  };
  // Try with sound (opening a story is a user gesture); fall back to muted autoplay.
  useEffect(() => {
    const el = video.current;
    if (!el || !isVideo || failed) return;
    if (paused) {
      el.pause();
      return;
    }
    el.muted = muted;
    el.play().catch((e: unknown) => {
      if (e instanceof Error && e.name === "NotAllowedError" && !el.muted) {
        el.muted = true;
        setMuted(true);
        void el.play().catch(() => {});
      }
    });
  }, [paused, muted, isVideo, failed, ready, setMuted]);
  const author = story.post?.author;
  const [viewersOpen, setViewersOpen] = useState(false);
  const viewers = useQuery({
    queryKey: ["stories", "viewers", story.id],
    queryFn: ({ signal }) =>
      api("storiesViewers", {
        params: { id: story.id },
        query: { limit: 50 },
        signal,
      }),
    enabled: own,
    // Live while the author watches their story, so new viewers appear without reopening it.
    refetchInterval: 4000,
  });
  const seen = viewers.data
    ? viewers.data.hasMore
      ? Math.max(story.viewCount, viewers.data.items.length)
      : viewers.data.items.length
    : story.viewCount;
  const likes = viewers.data
    ? viewers.data.items.filter((v) => v.liked).length
    : story.likeCount;
  const showViewers = (open: boolean) => {
    setViewersOpen(open);
    setBusy(open);
  };
  return (
    <div className="story-frame">
      <div className="story-progress" aria-hidden="true">
        {group.map((s, i) => (
          <span key={s.id}>
            <i
              className={
                i < position
                  ? "done"
                  : i === position && !isVideo && ready
                    ? "running"
                    : ""
              }
              style={
                i === position && isVideo
                  ? { width: `${progress * 100}%` }
                  : i === position && !isVideo
                    ? {
                        animationDuration: `${IMAGE_STORY_MS}ms`,
                        animationPlayState: paused ? "paused" : "running",
                      }
                    : undefined
              }
              onAnimationEnd={() => move(1)}
            />
          </span>
        ))}
      </div>
      <div className="story-top">
        <Avatar user={story.author} size={34} />
        <span className="story-top-copy">
          <strong>{story.author.username}</strong>
          <small>{relativeTime(story.createdAt)}</small>
        </span>
        {isVideo && (
          <button
            className="story-icon"
            aria-label={muted ? "Unmute story" : "Mute story"}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        )}
        <button
          className="story-icon"
          aria-label={paused ? "Resume story" : "Pause story"}
          onClick={togglePause}
        >
          {paused ? <Play size={20} /> : <Pause size={20} />}
        </button>
        {own && (
          <button
            className="story-icon"
            aria-label="Delete story"
            onClick={onDelete}
          >
            <Trash2 size={19} />
          </button>
        )}
        <button
          className="story-icon story-close-mobile"
          aria-label="Close story"
          onClick={onClose}
        >
          <X size={24} />
        </button>
      </div>
      <div
        className="story-stage"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const timer = window.setTimeout(() => setHeld(true), 200);
          press.current = { x: e.clientX, at: Date.now(), timer };
        }}
        onPointerUp={(e) => {
          const start = press.current;
          press.current = null;
          if (!start) return;
          window.clearTimeout(start.timer);
          setHeld(false);
          if (Date.now() - start.at > 250) return;
          const box = e.currentTarget.getBoundingClientRect();
          move(start.x - box.left < box.width / 3 ? -1 : 1);
        }}
        onPointerCancel={() => {
          if (press.current) window.clearTimeout(press.current.timer);
          press.current = null;
          setHeld(false);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isVideo ? (
          <MediaVideo
            ref={video}
            src={story.media.url}
            playsInline
            preload="auto"
            onCanPlay={() => setReady(true)}
            onPlaying={record}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration) setProgress(el.currentTime / el.duration);
            }}
            onEnded={() => move(1)}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            src={story.media.url}
            alt={story.caption || `Story by ${story.author.displayName}`}
            draggable={false}
            onLoad={record}
            onError={() => setFailed(true)}
          />
        )}
        {failed && (
          <p className="story-status" role="alert">
            This story could not be loaded.
          </p>
        )}
        {!ready && !failed && (
          <p className="story-status" role="status">
            <span className="story-spinner" /> Loading story...
          </p>
        )}
      </div>
      <div className="story-bottom">
        {story.post && author && (
          <Link
            className="story-reel-chip"
            href={`/post/${story.post.id}`}
            onClick={onClose}
          >
            <Clapperboard size={16} />
            <span>
              Reel by <strong>@{author.username}</strong>
            </span>
            <small>Watch</small>
          </Link>
        )}
        {story.caption && <p className="story-caption">{story.caption}</p>}
        {own ? (
          <button
            type="button"
            className="story-view-count"
            onClick={() => showViewers(true)}
          >
            <Eye size={16} /> {seen} {seen === 1 ? "view" : "views"}
            {likes > 0 && (
              <span className="story-like-count">
                <Heart size={14} fill="currentColor" /> {likes}
              </span>
            )}
          </button>
        ) : (
          <StoryReplyBar story={story} setBusy={setBusy} />
        )}
      </div>
      {own && viewersOpen && (
        <div
          className="story-viewers"
          role="dialog"
          aria-label="Story viewers"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // Close only the sheet; without this the dialog's cancel would close the story.
            e.preventDefault();
            e.stopPropagation();
            showViewers(false);
          }}
        >
          <header>
            <strong>
              <Eye size={18} /> {seen} {seen === 1 ? "viewer" : "viewers"}
            </strong>
            <button
              type="button"
              className="story-icon"
              aria-label="Close viewers"
              onClick={() => showViewers(false)}
            >
              <X size={20} />
            </button>
          </header>
          {viewers.isPending && <p className="story-viewers-empty">Loading...</p>}
          {viewers.data && !viewers.data.items.length && (
            <p className="story-viewers-empty">
              No views yet. People who watch your story will appear here.
            </p>
          )}
          <ul>
            {viewers.data?.items.map((v) => (
              <li key={v.user.id}>
                <Link href={`/profile/${v.user.username}`} onClick={onClose}>
                  <Avatar user={v.user} size={40} />
                  <span>
                    <strong>{v.user.username}</strong>
                    <small>{v.user.displayName}</small>
                  </span>
                </Link>
                {v.liked && (
                  <Heart
                    className="story-viewer-liked"
                    size={18}
                    fill="currentColor"
                    aria-label="Liked your story"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Instagram-style footer: reply privately, quick reactions and a like. */
function StoryReplyBar({
  story,
  setBusy,
}: {
  story: Story;
  setBusy: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [liked, setLiked] = useState(story.isLiked);
  const [pop, setPop] = useState(false);
  const like = useMutation({
    mutationFn: (next: boolean) =>
      api(next ? "storiesLike" : "storiesUnlike", { params: { id: story.id } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["stories"] }),
    onError: (e, next) => {
      setLiked(!next);
      toast(e.message, true);
    },
  });
  const reply = useMutation({
    mutationFn: (content: string) =>
      api("storiesReply", { params: { id: story.id }, body: { content } }),
    onSuccess: () => {
      setText("");
      haptic("success");
      toast(`Sent to ${story.author.username}.`);
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const send = (content: string) => {
    if (content.trim() && !reply.isPending) reply.mutate(content.trim());
  };
  return (
    <div className="story-reply">
      {focused && !text && (
        <div className="story-reactions" role="group" aria-label="Quick reactions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              type="button"
              key={emoji}
              // Keep the input focused so the reaction row does not vanish before the click lands.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                haptic("tap");
                send(emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <form
        className="story-reply-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          aria-label={`Reply to ${story.author.username}`}
          placeholder={`Reply to ${story.author.username}...`}
          maxLength={2000}
          value={text}
          disabled={reply.isPending}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            setFocused(true);
            setBusy(true);
          }}
          onBlur={() => {
            setFocused(false);
            setBusy(false);
          }}
        />
        {text.trim() ? (
          <button
            type="submit"
            className="story-icon"
            aria-label="Send reply"
            disabled={reply.isPending}
          >
            <Send size={22} />
          </button>
        ) : (
          <button
            type="button"
            className={`story-icon story-like ${liked ? "liked" : ""} ${pop ? "pop" : ""}`}
            aria-label={liked ? "Unlike story" : "Like story"}
            aria-pressed={liked}
            onAnimationEnd={() => setPop(false)}
            onClick={() => {
              const next = !liked;
              setLiked(next);
              if (next) {
                setPop(true);
                haptic("like");
              }
              like.mutate(next);
            }}
          >
            <Heart size={26} fill={liked ? "currentColor" : "none"} />
          </button>
        )}
      </form>
    </div>
  );
}

export default function Stories() {
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [viewing, setViewing] = useState<string | null>(null);
  const close = useCallback(() => setViewing(null), []);
  const query = useInfiniteQuery({
    queryKey: ["stories", user?.id],
    queryFn: ({ pageParam, signal }) =>
      api("storiesList", { query: { cursor: pageParam, limit: 50 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) =>
      p.hasMore ? (p.nextCursor ?? undefined) : undefined,
    enabled: !!user,
    refetchInterval: 30000,
  });
  const items = Array.from(
    new Map(
      (query.data?.pages.flatMap((p) => p.items) ?? []).map((s) => [s.id, s]),
    ).values(),
  ).filter((s) => Date.parse(s.expiresAt) > now);
  const groups = new Map<string, Story[]>();
  for (const story of items) {
    const group = groups.get(story.author.id) ?? [];
    group.push(story);
    groups.set(story.author.id, group);
  }
  const orderedGroups = [...groups.values()].sort(
    (a, b) =>
      Number(b[0].author.id === user?.id) - Number(a[0].author.id === user?.id),
  );
  for (const group of orderedGroups)
    group.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const ordered = orderedGroups.flat();
  const index = ordered.findIndex((s) => s.id === viewing);
  const story = ordered[index];
  const previousId = ordered[index - 1]?.id;
  const nextId = ordered[index + 1]?.id;
  const group = story ? (groups.get(story.author.id) ?? [story]) : [];
  if (!user) return null;
  return (
    <section className="card stories-card" aria-label="Stories">
      <div className="social-section-heading">
        <h2>Stories</h2>
        <span>Moments from your circle / 24h</span>
      </div>
      <div className="stories-tray">
        <button
          className="story-tile story-add"
          aria-label="Add story"
          onClick={() => setCreating(true)}
        >
          <span className="story-ring">
            <Avatar user={user} size={52} />
            <span className="story-add-icon">
              <Plus size={14} />
            </span>
          </span>
          <span>Add story</span>
        </button>
        {orderedGroups.map((group) => {
          const first = group.find((s) => !s.isViewed) ?? group[0];
          const unseen = group.some((s) => !s.isViewed);
          return (
            <button
              key={first.author.id}
              className={`story-tile ${unseen ? "unseen" : ""}`}
              onClick={() => setViewing(first.id)}
            >
              <span className="story-ring">
                <Avatar user={first.author} size={52} />
              </span>
              <span>
                {first.author.id === user.id
                  ? "Your story"
                  : first.author.displayName}
              </span>
            </button>
          );
        })}
        {query.isPending && <p role="status">Loading stories...</p>}
        {!query.isPending && !query.error && !items.length && (
          <p className="social-hint">Share a moment with your followers.</p>
        )}
      </div>
      {query.error && (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
      {creating && <StoryComposer onClose={() => setCreating(false)} />}
      {story && (
        <StoryViewer
          story={story}
          group={group}
          previousId={previousId}
          nextId={nextId}
          onSelect={setViewing}
          onClose={close}
        />
      )}
    </section>
  );
}
