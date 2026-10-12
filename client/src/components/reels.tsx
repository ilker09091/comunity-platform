"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  ExternalLink,
  Flag,
  Heart,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  RotateCcw,
  Share2,
  UserRound,
  EyeOff, Ban,
  X,
  Home, Compass, Users, Bell, Search, PlusSquare, Settings,
  Trash2,
} from "lucide-react";
import { api, type Models, type Post } from "@/lib/api/client";
import { sharePath, usePostEngagement } from "@/lib/use-post-engagement";
import { useDoubleTap } from "@/lib/use-double-tap";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Dropdown, relativeTime } from "./ui";
import FollowButton from "./follow-button";
import CommentList, { CommentInput } from "./comments";
import ReportDialog from "./report-dialog";
import { useFeatures } from "@/lib/platform-config";
import ReelPlayer, { type PreloadLevel } from "./reel-player";
import { Brand, MobileNav } from "./main-layout";
import PostComposer from "./post-composer";
import { fitVideoBounds } from "@/lib/video-playback-coordinator";
import { flushReelWatches } from "@/lib/reel-watch-transport";
import { RichText } from "./post-card";

type ReelPost = Post | Models["ReferencedPostDto"];
type Reel = { post: ReelPost; video: Models["MediaDto"] };

const SWIPE_DISTANCE = 0.16; // fraction of viewport height
const SWIPE_VELOCITY = 0.45; // px per ms
const WHEEL_THRESHOLD = 55;
const WHEEL_IDLE_MS = 200;
const TRANSITION_MS = 320;

export function toReel(post: Post, mediaId?: string | null): Reel | null {
  const source = post.kind === "REPOST" && post.referencedPost ? post.referencedPost : post;
  const video = source.media.find((m) => m.type === "VIDEO" && m.status === "READY" && (!mediaId || m.id === mediaId));
  if (video) return { post: source, video };
  const referenced = post.referencedPost;
  const inherited = referenced?.media.find(m => m.type === "VIDEO" && m.status === "READY" && (!mediaId || m.id === mediaId));
  return inherited && referenced ? { post: referenced, video: inherited } : null;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function preferredPreload(): PreloadLevel {
  if (typeof navigator === "undefined") return "metadata";
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return "none";
  return "metadata";
}

function count(n: number) {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}K`
      : n >= 1000
        ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
        : String(n);
}

function ReelMedia({ reel, index, selected, active, preload, sessionId, onAspectRatio, onRefreshSource }: {
  reel: Reel;
  index: number;
  selected: boolean;
  active: boolean;
  preload: PreloadLevel;
  sessionId?: string;
  onAspectRatio: (ratio: number) => void;
  onRefreshSource: () => Promise<void>;
}) {
  const { user } = useSession();
  const { act } = usePostEngagement(reel.post);
  const [burst, setBurst] = useState<{ id: number; rot: number; dx: number; dy: number } | null>(null);
  const doubleTap = () => {
    if (!user) return;
    setBurst({ id: Date.now(), rot: (Math.random() - 0.5) * 40, dx: (Math.random() - 0.5) * 60, dy: (Math.random() - 0.5) * 60 });
    if (navigator.vibrate) navigator.vibrate(15);
    if (!reel.post.isLiked) act("like");
  };
  const clickHandler = useDoubleTap(doubleTap);
  return (
    <div className="reel-media-wrap" onClickCapture={clickHandler}>
      <ReelPlayer
        key={reel.video.id}
        media={reel.video}
        postId={reel.post.id}
        sessionId={sessionId}
        selected={selected}
        active={active}
        preload={preload}
        onAspectRatio={onAspectRatio}
        label={`Video by ${reel.post.author.displayName}`}
        onRefreshSource={onRefreshSource}
      />
      {burst && (
        <Heart
          key={burst.id}
          className="reel-double-tap-heart"
          size={140}
          fill="currentColor"
          style={{ "--rot": `${burst.rot}deg`, "--dx": `${burst.dx}px`, "--dy": `${burst.dy}px` } as React.CSSProperties}
          onAnimationEnd={() => setBurst(null)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function ReelActions({
  post,
  commentsOpen,
  onComments,
  onReport,
  onNotInterested, onBlock,
  onDelete,
}: {
  post: ReelPost;
  commentsOpen: boolean;
  onComments: () => void;
  onReport: () => void;
  onNotInterested: () => void; onBlock: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const { user } = useSession();
  const { act, pending, repostable } = usePostEngagement(post);
  const { on } = useFeatures();
  const [pop, setPop] = useState<"like" | "bookmark" | null>(null);
  const press = (action: "like" | "bookmark") => {
    if (action === "like" ? !post.isLiked : !post.isBookmarked) setPop(action);
    act(action);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}`);
      toast("Link copied to clipboard.");
    } catch {
      toast("Unable to copy the link.", true);
    }
  };
  return (
    <div className="reel-actions" aria-label="Reel actions">
      <div className="reel-toolbar-creator">
        <Link href={`/profile/${post.author.username}`} aria-label={`View @${post.author.username}'s profile`}><Avatar user={post.author} size={42} /></Link>
        {user && user.id !== post.author.id && <ReelFollow post={post} />}
      </div>
      <button
        type="button"
        className={`reel-action like ${post.isLiked ? "active" : ""} ${pop === "like" ? "pop" : ""}`}
        onAnimationEnd={() => setPop(null)}
        aria-pressed={post.isLiked}
        aria-label={`${post.isLiked ? "Unlike" : "Like"}, ${post.likeCount} likes`}
        disabled={pending}
        onClick={() => press("like")}
      >
        <span className="reel-action-icon">
          <Heart size={24} fill={post.isLiked ? "currentColor" : "none"} />
        </span>
        <span>{count(post.likeCount)}</span>
      </button>
      <button
        type="button"
        className={`reel-action ${commentsOpen ? "active-neutral" : ""}`}
        aria-expanded={commentsOpen}
        aria-label={`Comments, ${post.commentCount}`}
        onClick={onComments}
      >
        <span className="reel-action-icon">
          <MessageCircle size={24} />
        </span>
        <span>{count(post.commentCount)}</span>
      </button>
      {on("reposts") && (
      <button
        type="button"
        className={`reel-action repost ${post.isReposted ? "active" : ""}`}
        aria-pressed={post.isReposted}
        aria-label={post.isReposted ? "Undo repost" : "Repost"}
        title={repostable ? undefined : "Only public posts can be reposted"}
        disabled={pending || !repostable}
        onClick={() => act("repost")}
      >
        <span className="reel-action-icon">
          <Repeat2 size={24} />
        </span>
        <span>{count(post.repostCount + post.quoteCount)}</span>
      </button>
      )}
      <button
        type="button"
        className={`reel-action bookmark ${post.isBookmarked ? "active" : ""} ${pop === "bookmark" ? "pop" : ""}`}
        onAnimationEnd={() => setPop(null)}
        aria-pressed={post.isBookmarked}
        aria-label={post.isBookmarked ? "Remove bookmark" : "Bookmark"}
        disabled={pending}
        onClick={() => press("bookmark")}
      >
        <span className="reel-action-icon">
          <Bookmark size={23} fill={post.isBookmarked ? "currentColor" : "none"} />
        </span>
        <span>Save</span>
      </button>
      <button type="button" className="reel-action share" aria-label="Share" onClick={() => void sharePath(`/post/${post.id}`, toast)}>
        <span className="reel-action-icon">
          <Share2 size={22} />
        </span>
        <span>Share</span>
      </button>
      <Dropdown
        label="More options"
        className="reel-more"
        align="end"
        summaryClassName="reel-action"
        summary={
          <span className="reel-action-icon">
            <MoreHorizontal size={22} />
          </span>
        }
      >
        {on("reposts") && <button type="button" className="reel-mobile-repost" disabled={pending || !repostable} onClick={() => act("repost")}><Repeat2 size={16} />{post.isReposted ? "Undo repost" : "Repost"}</button>}
        <Link href={`/post/${post.id}`}>
          <ExternalLink size={16} /> View post
        </Link>
        <Link href={`/profile/${post.author.username}`}>
          <UserRound size={16} /> View profile
        </Link>
        <button type="button" onClick={() => void copy()}>
          <Link2 size={16} /> Copy link
        </button>
        {user && <button type="button" onClick={onNotInterested}><EyeOff size={16} /> Not interested</button>}
        {user && user.id !== post.author.id && <button type="button" className="danger-text" onClick={onBlock}><Ban size={16} /> Block creator</button>}
        {user && user.id !== post.author.id && on("reporting") && (
          <button type="button" className="danger-text" onClick={onReport}>
            <Flag size={16} /> Report
          </button>
        )}
        {user && user.id === post.author.id && (
          <button type="button" className="danger-text" onClick={onDelete}>
            <Trash2 size={16} /> Delete Reel
          </button>
        )}
      </Dropdown>
    </div>
  );
}

function ReelFollow({ post, active = true }: { post: ReelPost; active?: boolean }) {
  const { user } = useSession();
  const enabled = active && !!user && user.id !== post.author.id;
  const profile = useQuery({ queryKey: ["profile", post.author.username], queryFn: ({ signal }) => api("usersGetProfile", { params: { username: post.author.username }, signal }), enabled });
  if (enabled && profile.isPending) return <button type="button" className="reel-follow-badge" disabled aria-label="Loading follow status"><Loader2 size={13} className="spin" /></button>;
  if (enabled && profile.isError) return <button type="button" className="reel-follow-badge" onClick={() => void profile.refetch()} aria-label="Retry follow status" title="Retry follow status"><RotateCcw size={13} /></button>;
  if (profile.data?.isBlocking) return null;
  return <FollowButton id={post.author.id} following={profile.data?.isFollowing ?? post.isFollowingAuthor} requested={profile.data?.isFollowRequested ?? false} variant="badge" />;
}

function ReelInfo({ post, active }: { post: ReelPost; active: boolean }) {
  const { user } = useSession();
  const [expanded, setExpanded] = useState(false);
  const author = post.author;
  return (
    <div className="reel-info" onClick={(e) => e.stopPropagation()}>
      <div className="reel-creator">
        <Link href={`/profile/${author.username}`} className="reel-creator-link">
          <Avatar user={author} size={36} />
          <span>
            <strong>{author.displayName}</strong>
            <small>
              @{author.username} · {relativeTime(post.createdAt)}
            </small>
          </span>
        </Link>
        {user?.id !== author.id && !post.isFollowingAuthor && (
          <span className="reel-follow">
            <ReelFollow post={post} active={active} />
          </span>
        )}
      </div>
      {post.content && (
        <div
          className={`reel-caption ${expanded ? "expanded" : ""}`}
        >
          <RichText text={post.content} className="reel-caption-text" />
          <button type="button" className="reel-caption-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "More"}</button>
        </div>
      )}
    </div>
  );
}

function ReelComments({ post, onClose }: { post: ReelPost; onClose: () => void }) {
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const close = useCallback(() => {
    if (window.matchMedia(REDUCED_MOTION).matches) return onClose();
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(onClose, 180);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const background = [...document.querySelectorAll<HTMLElement>(".reels-shell,.reels-nav,.reels-topbar,.reels-sidebar,.reels-mobile-nav")];
    const originalInert = background.map((node) => node.inert);
    const mobile = window.matchMedia("(max-width: 899px)");
    const accessibility = () => {
      background.forEach((node, i) => { node.inert = mobile.matches || originalInert[i]; });
      sheet.current?.setAttribute("role", mobile.matches ? "dialog" : "region");
      if (mobile.matches) sheet.current?.setAttribute("aria-modal", "true"); else sheet.current?.removeAttribute("aria-modal");
    };
    accessibility(); mobile.addEventListener("change", accessibility);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) close();
      if (e.key === "Tab" && window.matchMedia("(max-width: 899px)").matches) {
        const items = sheet.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),textarea,input,[tabindex="0"]');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const viewport = window.visualViewport;
    const resize = () => {
      sheet.current?.style.setProperty("--sheet-available", `${viewport?.height ?? window.innerHeight}px`);
      sheet.current?.style.setProperty("--keyboard-offset", "0px");
    };
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    window.addEventListener("keydown", onKey);
    sheet.current?.focus();
    return () => { background.forEach((node, i) => { node.inert = originalInert[i]; }); mobile.removeEventListener("change", accessibility); window.removeEventListener("keydown", onKey); viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); previousFocus?.focus(); };
  }, [close]);
  return (
    <>
      <div className={`reel-sheet-backdrop ${closing ? "closing" : ""}`} onClick={close} aria-hidden="true" />
      <aside
        ref={sheet}
        tabIndex={-1}
        className={`reel-comments ${closing ? "closing" : ""}`}
        aria-label="Comments"
        style={offset ? ({ transform: `translateY(${offset}px)`, transition: "none" } as CSSProperties) : undefined}
      >
        <div
          className="reel-sheet-handle"
          onTouchStart={(e) => (drag.current = { y: e.touches[0].clientY, dy: 0 })}
          onTouchMove={(e) => {
            if (!drag.current) return;
            drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y);
            setOffset(drag.current.dy);
          }}
          onTouchEnd={() => {
            const dy = drag.current?.dy ?? 0;
            drag.current = null;
            setOffset(0);
            if (dy > 90) close();
          }}
        >
          <span />
        </div>
        <header>
          <h2>
            Comments <span>{post.commentCount}</span>
          </h2>
          <button type="button" className="icon-button" aria-label="Close comments" onClick={close}>
            <X size={19} />
          </button>
        </header>
        <div className="reel-comments-body">
          <CommentList postId={post.id} postAuthorId={post.author.id} showInput={false} />
        </div>
        <footer>
          <CommentInput postId={post.id} inline />
        </footer>
      </aside>
    </>
  );
}

export default function Reels() {
  const router = useRouter();
  const { user } = useSession();
  const toast = useToast();
  const cache = useQueryClient();
  const [cycle, setCycle] = useState({ id: 0, rewatch: false });
  const viewer = user?.id ?? 'guest';
  const owner = useRef(viewer);
  const sessionRef = useRef(cache.getQueryData<{pages: {sessionId: string}[]}>(['posts','reels',viewer,0,false])?.pages[0]?.sessionId);
  if (owner.current !== viewer) { owner.current = viewer; sessionRef.current = undefined; }
  const params = useSearchParams();
  const startId = params.get("start");
  const startMedia = params.get("media");
  const [selection, setSelection] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const target = `${startId ?? ""}:${startMedia ?? ""}`;
  const [requestedStart, setRequestedStart] = useState(target);
  if (requestedStart !== target) { setRequestedStart(target); setSelection({ id: null, index: 0 }); }
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reporting, setReporting] = useState<ReelPost | null>(null);
  const [deleting, setDeleting] = useState<ReelPost | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [creating, setCreating] = useState(params.get("create") === "1");
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [stageSize, setStageSize] = useState({ width: 960, height: 760 });
  const shell = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [preload] = useState<PreloadLevel>(preferredPreload);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const stage = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const lockTimer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const toggleSound = useCallback(() => {
    stage.current?.querySelector<HTMLButtonElement>('section[aria-hidden="false"] .video-sound')?.click();
  }, []);

  // Opened from a profile: only that person's Reels, newest first. Otherwise: everyone's recommended Reels.
  const profileUserId = params.get("user");
  const feed = useInfiniteQuery({
    queryKey: ["posts", "reels", profileUserId ? `user:${profileUserId}` : (user?.id ?? "guest"), cycle.id, cycle.rewatch],
    queryFn: async ({ pageParam, signal }): Promise<{ items: Post[]; nextCursor?: string | null; hasMore: boolean; sessionId?: string }> => {
      if (profileUserId)
        return api("postsByUser", { params: { id: profileUserId }, query: { cursor: pageParam, limit: 15, content: "reels", kinds: "POST,QUOTE" }, signal });
      const page = await api("feedReels", { query: { cursor: pageParam, session: pageParam ? undefined : sessionRef.current, limit: 15, rewatch: cycle.rewatch }, signal });
      sessionRef.current = page.sessionId;
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  });
  const restart = async (rewatch = false) => {
    await flushReelWatches();
    sessionRef.current = undefined;
    setSelection({ id: null, index: 0 }); setCommentsOpen(false);
    setCycle(previous => ({ id: previous.id + 1, rewatch }));
    if (startId || profileUserId) router.replace('/reels');
  };
  const hideCurrent = async (block = false) => {
    if (!current) return;
    try {
      if (block) await api('followsBlock', { params: { id: current.post.author.id } });
      else await api('feedFeedback', { body: { postId: current.post.id, notInterested: true } });
      setCommentsOpen(false);
      await cache.invalidateQueries({ queryKey: ['posts'] });
      if (block) await cache.invalidateQueries({ queryKey: ['profile'] });
      toast(block ? 'Creator blocked.' : 'We will show fewer reels like this.');
      if (startId) router.replace('/reels');
    } catch (error) { toast(error instanceof Error ? error.message : 'Unable to update recommendations.', true); }
  };
  /** Permanently deletes the viewer's own Reel and moves on to the next one without restarting the feed. */
  const deleteReel = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await api("postsRemove", { params: { id: deleting.id } });
      const removedId = deleting.id;
      cache.setQueriesData<{ pages: { items: Post[] }[]; pageParams: unknown[] }>({ queryKey: ["posts", "reels"] }, (data) =>
        data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== removedId) })) } : data,
      );
      cache.removeQueries({ queryKey: ["post", removedId] });
      void cache.invalidateQueries({ predicate: (q) => (q.queryKey[0] === "posts" && q.queryKey[1] !== "reels") || q.queryKey[0] === "profile" });
      setCommentsOpen(false);
      setDeleting(null);
      toast("Reel deleted.");
      if (startId === removedId) router.replace("/reels");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to delete this Reel.", true);
    } finally {
      setDeletePending(false);
    }
  };
  const start = useQuery({
    queryKey: ["post", startId],
    queryFn: ({ signal }) => api("postsGet", { params: { id: startId! }, signal }),
    enabled: !!startId,
    retry: false,
  });

  const reels = useMemo(() => {
    // Wait for an explicitly requested post before anchoring the selection to a feed item.
    if (startId && (start.isPending || start.isError || (start.data && !toReel(start.data, startMedia)))) return [];
    const posts = [...(start.data ? [start.data] : []), ...(feed.data?.pages.flatMap((p) => p.items) ?? [])];
    const seen = new Set<string>();
    const list: Reel[] = [];
    for (const post of posts) {
      const reel = toReel(post, post.id === startId ? startMedia : undefined);
      if (reel && !seen.has(reel.post.id)) {
        seen.add(reel.post.id);
        list.push(reel);
      }
    }
    return list;
  }, [feed.data, start.data, startId, startMedia, start.isPending, start.isError]);

  const profileOwner = profileUserId
    ? (reels.find((r) => r.post.author.id === profileUserId)?.post.author.username ?? (start.data?.author.id === profileUserId ? start.data.author.username : null))
    : null;
  const atEnd = !feed.hasNextPage && !feed.isPending;
  const slideCount = reels.length + (atEnd && reels.length ? 1 : 0);
  const selectedIndex = selection.id === "end" ? reels.length : reels.findIndex((reel) => reel.post.id === selection.id);
  const index = Math.min(selectedIndex >= 0 ? selectedIndex : selection.index, Math.max(0, slideCount - 1));
  const current = reels[index];
  const sourceRatio = current ? ratios[current.video.id] ?? (current.video.width && current.video.height ? current.video.width / current.video.height : 16 / 9) : 16 / 9;
  const bounds = fitVideoBounds(sourceRatio, Math.max(1, stageSize.width - 264), Math.max(1, stageSize.height - 48));
  useEffect(() => {
    const el = shell.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (current && requestedStart === target && selection.id !== current.post.id) setSelection({ id: current.post.id, index });

  useEffect(() => {
    // Immersive page: no document scrolling (and no pull-to-refresh) underneath the player.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    root.classList.add("reels-mode");
    // iOS Safari: 100vh/100dvh do not match the visible area while its toolbars animate, which pushed
    // the bottom of the Reel off-screen. Track the real visible height instead.
    let frame = 0;
    const viewport = window.visualViewport;
    const syncHeight = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (viewport && Math.abs(viewport.scale - 1) > .01) return;
        root.style.setProperty("--app-h", `${viewport?.height ?? window.innerHeight}px`);
        root.style.setProperty("--app-top", `${viewport?.offsetTop ?? 0}px`);
      });
    };
    syncHeight();
    window.addEventListener("resize", syncHeight);
    window.addEventListener("orientationchange", syncHeight);
    viewport?.addEventListener("resize", syncHeight);
    viewport?.addEventListener("scroll", syncHeight);
    return () => {
      root.style.overflow = previous;
      root.classList.remove("reels-mode");
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
      window.removeEventListener("resize", syncHeight);
      window.removeEventListener("orientationchange", syncHeight);
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", syncHeight);
      viewport?.removeEventListener("scroll", syncHeight);
    };
  }, []);

  // Prefetch the next page before the viewer reaches the end.
  useEffect(() => {
    if (index >= reels.length - 4 && feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage();
  }, [index, reels.length, feed]);

  const go = useCallback(
    (delta: 1 | -1) => {
      if (locked.current) return;
      locked.current = true;
      lockTimer.current = window.setTimeout(() => (locked.current = false), reducedMotion ? 120 : TRANSITION_MS + 80);
      setSelection((previous) => {
        const found = previous.id === "end" ? reels.length : reels.findIndex((reel) => reel.post.id === previous.id);
        const from = found >= 0 ? found : Math.min(previous.index, Math.max(0, slideCount - 1));
        const next = Math.min(Math.max(from + delta, 0), Math.max(slideCount - 1, 0));
        return { id: reels[next]?.post.id ?? "end", index: next };
      });
    },
    [slideCount, reducedMotion, reels],
  );
  useEffect(() => () => { window.clearTimeout(lockTimer.current); window.clearTimeout(tapTimer.current); }, []);
  const navigateWheel = useEffectEvent((delta: 1 | -1) => go(delta));

  // Mouse wheel / trackpad: one gesture moves at most one reel.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let accumulated = 0;
    let consumed = false;
    let idle: number | undefined;
    const onWheel = (e: WheelEvent) => {
      if ((commentsOpen && window.matchMedia("(max-width: 899px)").matches) || (e.target as HTMLElement).closest(".dropdown-menu,.reel-caption.expanded,[data-player-controls]")) return;
      e.preventDefault();
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        accumulated = 0;
        consumed = false;
      }, WHEEL_IDLE_MS);
      if (consumed) return;
      accumulated += e.deltaY;
      if (Math.abs(accumulated) >= WHEEL_THRESHOLD) {
        consumed = true;
        navigateWheel(accumulated > 0 ? 1 : -1);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(idle);
    };
  }, [commentsOpen]);

  // Touch: follow the finger, then commit on distance or velocity.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (commentsOpen || e.touches.length !== 1 || (target.closest("a,button,input,summary,[data-player-controls],.dropdown-menu") && !target.closest(".reel-play-surface")))
        return;
      tracking = true;
      startY = e.touches[0].clientY;
      startT = performance.now();
      dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      dy = e.touches[0].clientY - startY;
      // Resist at the edges so the first/last reel feels anchored.
      const edge = (dy > 0 && index === 0) || (dy < 0 && index >= slideCount - 1);
      setDragOffset(edge ? dy * 0.25 : dy);
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      const height = el.clientHeight || 1;
      const velocity = Math.abs(dy) / Math.max(1, performance.now() - startT);
      setDragOffset(0);
      if (Math.abs(dy) > height * SWIPE_DISTANCE || (Math.abs(dy) > 40 && velocity > SWIPE_VELOCITY)) {
        go(dy < 0 ? 1 : -1);
        // Suppress the tap-to-pause click that follows a swipe.
        el.dataset.swiped = "1";
        tapTimer.current = window.setTimeout(() => delete el.dataset.swiped, 350);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    const onCancel = () => { tracking = false; setDragOffset(0); };
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [go, commentsOpen, index, slideCount]);

  // Keyboard navigation (ignored while typing or when a panel/dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.("input,textarea,select,[contenteditable]") || document.querySelector("dialog[open]")) return;
      if (commentsOpen && (window.matchMedia("(max-width: 899px)").matches || target.closest?.(".reel-comments"))) return;
      if (["ArrowDown", "PageDown", "j"].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowUp", "PageUp", "k"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === "m") {
        toggleSound();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, commentsOpen, toggleSound]);

  const exit = () => (window.history.length > 1 ? router.back() : router.push("/"));
  const closeComments = useCallback(() => setCommentsOpen(false), []);

  const empty = !feed.isPending && (!startId || !start.isPending) && reels.length === 0;

  return (
    <div className={`reels-page ${commentsOpen ? "comments-open" : ""}`} style={{ "--reel-w": `${bounds.width}px`, "--reel-h": `${bounds.height}px` } as CSSProperties}>
      <ReelsSidebar onCreate={() => setCreating(true)} />
      <div className="reels-topbar">
        <button type="button" className="reels-icon-button" aria-label="Leave Reels" onClick={exit}>
          <ArrowLeft size={20} />
        </button>
        <span className="reels-title">
          <Clapperboard size={18} aria-hidden="true" /> {profileOwner ? <>@{profileOwner}</> : "Reels"}
        </span>
        {profileUserId && (
          <Link href="/reels" className="reels-all-link" replace>
            All Reels
          </Link>
        )}
        <button type="button" className="reels-icon-button reels-create" aria-label="Create Reel" onClick={() => setCreating(true)}><PlusSquare size={23} /></button>
      </div>

      <div className="reels-workspace">
      <div className="reels-shell" ref={shell}>
        <div
          ref={stage}
          className="reel-viewport"
          role="region"
          aria-roledescription="carousel"
          aria-label="Reels"
          onClickCapture={(e) => {
            if (stage.current?.dataset.swiped && (e.target as HTMLElement).closest("[data-reel-tap]")) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          {((!startId && feed.isPending) || (!!startId && start.isPending)) && !reels.length ? (
            <div className="reel-state">
              <Loader2 size={28} className="spin" />
            </div>
          ) : startId && (start.isError || (start.data && !toReel(start.data, startMedia))) ? (
            <div className="reel-state" role="status"><Clapperboard size={30} /><h2>Reel unavailable</h2><p>This video may be private, deleted or restricted.</p><button type="button" className="button small" onClick={() => void start.refetch()}>Try again</button><Link href="/reels" className="button secondary small">Browse Reels</Link></div>
          ) : feed.isError && !reels.length ? (
            <div className="reel-state">
              <p>Reels couldn’t load.</p>
              <button type="button" className="button small" onClick={() => void feed.refetch()}>
                Try again
              </button>
            </div>
          ) : empty ? (
            <div className="reel-state">
              <Clapperboard size={34} />
              <h2>{profileUserId ? (profileOwner ? `That's all from @${profileOwner}` : "No Reels here yet") : "You're all caught up"}</h2>
              <p>{profileUserId ? "You've seen every Reel on this profile." : "No unseen reels are available right now."}</p>
              <button type="button" className="button small" onClick={() => restart()}>Refresh for new content</button>
              <button type="button" className="button secondary small" onClick={() => restart(true)}>Watch again</button>
              <Link href="/" className="button secondary small">Return to Home</Link>
              <button type="button" className="button secondary small" onClick={() => setCreating(true)}>Create Reel</button>
            </div>
          ) : (
            <div className="reel-track">
              {Array.from({ length: slideCount }, (_, i) => i)
                .filter((i) => Math.abs(i - index) <= 1)
                .map((i) => {
                  const reel = reels[i];
                  const style = {
                    transform: `translate3d(0, calc(${(i - index) * 100}% + ${dragOffset}px), 0)`,
                    transition: dragOffset || reducedMotion ? "none" : undefined,
                  } as CSSProperties;
                  if (!reel)
                    return (
                      <section key="end" className="reel-slide reel-end" style={style} aria-hidden={i !== index}>
                        <div className="reel-state">
                          <Clapperboard size={30} />
                          <h2>You’re all caught up</h2>
                          <p>You’ve seen every reel for now.</p>
                          <button type="button" className="button small" onClick={() => void restart()}>Refresh for new content</button>
                          <Link href="/" className="button secondary small">Return to Home</Link>
                          <button type="button" className="button secondary small" onClick={() => void restart(true)}>Watch again</button>
                        </div>
                      </section>
                    );
                  const source = reel.post;
                  return (
                    <section
                      key={reel.post.id}
                      className="reel-slide"
                      style={style}
                      aria-hidden={i !== index}
                      inert={i !== index}
                      aria-label={`Reel ${i + 1} by @${source.author.username}`}
                    >
                      <ReelMedia
                        reel={reel}
                        index={i}
                        selected={i === index}
                        active={i === index && !reporting && !creating}
                        preload={i === index ? "auto" : preload}
                        sessionId={feed.data?.pages[0]?.sessionId}
                        onAspectRatio={ratio => setRatios(previous => previous[reel.video.id] === ratio ? previous : { ...previous, [reel.video.id]: ratio })}
                        onRefreshSource={async () => { await Promise.all([feed.refetch({ throwOnError: true }), ...(startId ? [start.refetch({ throwOnError: true })] : [])]); }}
                      />
                      <ReelInfo post={reel.post} active={i === index} />
                    </section>
                  );
                })}
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {current ? `Reel ${index + 1}${atEnd ? ` of ${reels.length}` : ""} by @${current.post.author.username}` : ""}
          </p>
        </div>

        {current && (
          <ReelActions
            post={current.post}
            commentsOpen={commentsOpen}
            onComments={() => setCommentsOpen((open) => !open)}
            onReport={() => setReporting(current.post)}
            onNotInterested={() => void hideCurrent()}
            onBlock={() => void hideCurrent(true)}
            onDelete={() => setDeleting(current.post)}
          />
        )}

      </div>

        {commentsOpen && current && <ReelComments key={current.post.id} post={current.post} onClose={closeComments} />}

      <div className="reels-nav" aria-label="Reel navigation">
        <button type="button" className="reels-icon-button" aria-label="Previous reel" disabled={index === 0} onClick={() => go(-1)}>
          <ChevronUp size={22} />
        </button>
        <button
          type="button"
          className="reels-icon-button"
          aria-label="Next reel"
          disabled={index >= slideCount - 1}
          onClick={() => go(1)}
        >
          {feed.isFetchingNextPage && index >= reels.length - 1 ? <Loader2 size={20} className="spin" /> : <ChevronDown size={22} />}
        </button>
      </div>
      {feed.isFetchNextPageError && <div className="reels-network-error" role="alert">Could not load more reels. <button type="button" onClick={() => void feed.fetchNextPage()}>Retry</button></div>}
      </div>

      <MobileNav variant="reels" onCreate={() => setCreating(true)} />
      <PostComposer mode="reel" modalOpen={creating} onModalClose={() => setCreating(false)} />
      {deleting && (
        <ConfirmDialog
          title="Delete this Reel?"
          description="The video, its likes and comments are removed permanently. This can’t be undone."
          confirmLabel="Delete"
          pending={deletePending}
          onConfirm={() => void deleteReel()}
          onClose={() => !deletePending && setDeleting(null)}
        />
      )}
      {reporting && (
        <ReportDialog
          targetType="POST"
          targetId={reporting.id}
          subject="this reel"
          onClose={() => setReporting(null)}
        />
      )}
    </div>
  );
}

function ReelsSidebar({ onCreate }: { onCreate: () => void }) {
  const { user } = useSession();
  const nav = [
    { href: "/explore", label: "Search", icon: Search },
    { href: "/", label: "Home", icon: Home },
    { href: "/explore", label: "Explore", icon: Compass },
    { href: "/following", label: "Following", icon: Users },
    { href: "/reels", label: "Reels", icon: Clapperboard },
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: user ? `/profile/${user.username}` : "/login", label: "Profile", icon: UserRound },
  ];
  return <aside className="reels-sidebar"><Brand /><nav aria-label="Main navigation">{nav.map(({ href, label, icon: Icon }) => <Link key={label} href={href} aria-label={label} aria-current={href === "/reels" ? "page" : undefined}>{label === "Profile" && user ? <Avatar user={user} size={26} /> : <Icon size={23} />}<span className="reels-tooltip">{label}</span></Link>)}
    <button type="button" className="reels-rail-create" aria-label="Create Reel" onClick={onCreate}><PlusSquare size={23} /><span className="reels-tooltip">Create Reel</span></button>
    <Dropdown label="More" className="reels-rail-more" summary={<><MoreHorizontal size={23} /><span className="reels-tooltip">More</span></>}><Link href="/saved"><Bookmark size={17} /> Saved posts</Link><Link href="/settings"><Settings size={17} /> Settings</Link></Dropdown>
    </nav></aside>;
}
