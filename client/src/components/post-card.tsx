"use client";
import Link from "next/link";
import { Fragment, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  Share2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Quote,
  Globe2,
  Users,
  Loader2,
  Link2,
  ExternalLink,
  UserPlus,
  UserMinus,
  Flag,
  Clapperboard,
  EyeOff,
} from "lucide-react";
import ReportDialog from "./report-dialog";
import { useFeatures } from "@/lib/platform-config";
import { api, type Post, type Models } from "@/lib/api/client";
import { sharePath, usePostEngagement } from "@/lib/use-post-engagement";
import { useDoubleTap } from "@/lib/use-double-tap";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Dropdown, Modal, relativeTime, VerifiedBadge } from "./ui";
import CommentList, { CommentInput } from "./comments";
import PostComposer from "./post-composer";
import VideoPlayerCore from "./video-player-core";
import PhotoGallery from "./photo-gallery";
import { parseInteractive, InteractiveWidget } from "./interactive-post";

const HASHTAG = /(#[\p{L}\p{N}_]{1,60})/gu;
const SPOILER_RE = /#spoiler\b/iu;

export function hasSpoiler(text: string | null | undefined) {
  return !!text && SPOILER_RE.test(text);
}

/** Plain-text post content with hashtags linked to search. Never renders HTML. */
export function RichText({ text, className = "post-content" }: { text: string; className?: string }) {
  const parts = text.split(HASHTAG);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} href={`/explore?q=${encodeURIComponent(part)}`} className="hashtag">
            {part}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

function mediaAspect(item: Models["MediaDto"]): CSSProperties | undefined {
  if (!item.width || !item.height) return undefined;
  const ratio = item.width / item.height;
  return { aspectRatio: String(ratio) };
}

/** Threads-style spoiler veil: drifting sparkles and a frosted pill; tapping dissolves it. */
function SpoilerCover({ leaving, onReveal, onDone }: { leaving: boolean; onReveal: () => void; onDone: () => void }) {
  return (
    <button
      type="button"
      className={`media-spoiler-cover ${leaving ? "leaving" : ""}`}
      onClick={onReveal}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onDone();
      }}
      aria-label="Spoiler: show media"
      disabled={leaving}
    >
      <span className="spoiler-particles" aria-hidden="true" />
      <span className="media-spoiler-pill">
        <EyeOff size={16} aria-hidden="true" /> Spoiler
      </span>
      <span className="media-spoiler-hint">Görmek için dokun</span>
    </button>
  );
}

export function PostMedia({ media, postId, spoiler = false }: { media: Models["MediaDto"][]; postId?: string; spoiler?: boolean }) {
  const client = useQueryClient();
  /** hidden → revealing (unblur animation) → shown */
  const [spoilerPhase, setSpoilerPhase] = useState<"hidden" | "revealing" | "shown">("hidden");
  const reveal = () => setSpoilerPhase((phase) => (phase === "hidden" ? "revealing" : phase));
  const refresh = postId ? async () => {
    const post = await api("postsGet", { params: { id: postId } });
    client.setQueryData(["post", postId], post);
    await client.invalidateQueries({ predicate: query => query.queryKey[0] === "posts" || query.queryKey[0] === "discovery" });
  } : undefined;
  const single = media.length === 1;
  const showSpoilerCover = spoiler && spoilerPhase !== "shown";
  const spoilerClass = !showSpoilerCover ? "" : spoilerPhase === "revealing" ? "spoilered revealing" : "spoilered";
  const inner = media.length && media.every(item => item.type==='IMAGE' && item.status==='READY')
    ? <PhotoGallery photos={media}/>
    : null;
  if (inner) {
    // The frame takes the first photo's shape: tall (9:16) photos get a narrower frame instead of side bars.
    const first = media[0];
    const ratio = first.width && first.height ? first.width / first.height : 1;
    return (
      <div className={`post-media-spoiler-wrap is-gallery ${spoilerClass}`} style={{ "--photo-ratio": String(ratio) } as CSSProperties}>
        {inner}
        {showSpoilerCover && (
          <SpoilerCover leaving={spoilerPhase === "revealing"} onReveal={reveal} onDone={() => setSpoilerPhase("shown")} />
        )}
      </div>
    );
  }
  return (
    <div className={`post-media-spoiler-wrap ${spoilerClass}`}>
      <div className={`post-media count-${Math.min(media.length, 4)}`}>
        {media.slice(0, 4).map((item) => (
          <div key={item.id} className={`post-media-item ${item.type === "VIDEO" ? "has-video" : ""}`} style={single && item.type !== "VIDEO" ? mediaAspect(item) : undefined}>
            {item.status === "FAILED" ? (
              <p className="media-status">This attachment couldn’t be processed.</p>
            ) : item.status === "PROCESSING" ? (
              <p className="media-status">
                <Loader2 size={18} className="spin" /> Processing media…
              </p>
            ) : item.type === "VIDEO" ? (
              <VideoPlayerCore media={item} mode="feed" label="Post video" openInReelsHref={postId ? `/reels?start=${encodeURIComponent(postId)}&media=${encodeURIComponent(item.id)}` : undefined} onRefreshSource={refresh} />
            ) : (
              <img
                src={item.url}
                alt="Image shared in this post"
                loading="lazy"
                decoding="async"
                width={item.width ?? undefined}
                height={item.height ?? undefined}
              />
            )}
          </div>
        ))}
      </div>
      {showSpoilerCover && (
        <SpoilerCover leaving={spoilerPhase === "revealing"} onReveal={reveal} onDone={() => setSpoilerPhase("shown")} />
      )}
    </div>
  );
}

export function PostActions({
  post,
  onComments,
  onQuote,
  commentsOpen,
}: {
  post: Post | Models["ReferencedPostDto"];
  onComments: () => void;
  onQuote: () => void;
  commentsOpen?: boolean;
}) {
  const { user } = useSession();
  const toast = useToast();
  const { act, pending, repostable } = usePostEngagement(post);
  const { on, canWrite } = useFeatures();
  const mutation = { isPending: pending };
  const [pop, setPop] = useState<"like" | "bookmark" | null>(null);
  const press = (action: "like" | "bookmark") => {
    if (action === "like" ? !post.isLiked : !post.isBookmarked) setPop(action);
    act(action);
  };
  const share = () => sharePath(`/post/${post.id}`, toast);
  return (
    <div className="post-actions">
      <button
        type="button"
        className={`action like ${post.isLiked ? "active" : ""} ${pop === "like" ? "pop" : ""}`}
        onAnimationEnd={() => setPop(null)}
        aria-label={`${post.isLiked ? "Unlike" : "Like"}, ${post.likeCount} likes`}
        aria-pressed={post.isLiked}
        disabled={mutation.isPending}
        onClick={() => press("like")}
      >
        <Heart size={18} fill={post.isLiked ? "currentColor" : "none"} />
        <span>{post.likeCount}</span>
      </button>
      <button
        type="button"
        className={`action ${commentsOpen ? "active-neutral" : ""}`}
        aria-label={`Comments, ${post.commentCount}`}
        aria-expanded={commentsOpen}
        onClick={onComments}
      >
        <MessageCircle size={18} />
        <span>{post.commentCount}</span>
      </button>
      {on("reposts") && (
      <Dropdown
        label="Repost options"
        align="start"
        className="repost-menu"
        summaryClassName={`action repost ${post.isReposted ? "active" : ""}`}
        summary={
          <>
            <Repeat2 size={18} />
            <span>{post.repostCount + post.quoteCount}</span>
          </>
        }
      >
        <button type="button" disabled={!repostable || mutation.isPending} onClick={() => act("repost")}>
          <Repeat2 size={16} />
          {post.isReposted ? "Undo repost" : "Repost"}
        </button>
        <button
          type="button"
          disabled={!repostable || !canWrite("postCreation")}
          onClick={() => {
            if (!user) toast("Sign in to quote a post.");
            else onQuote();
          }}
        >
          <Quote size={16} /> Quote post
        </button>
        {!repostable && <p className="menu-note">Only public posts can be reposted.</p>}
      </Dropdown>
      )}
      <span className="post-action-spacer" />
      <button
        type="button"
        className={`action bookmark ${post.isBookmarked ? "active" : ""} ${pop === "bookmark" ? "pop" : ""}`}
        onAnimationEnd={() => setPop(null)}
        aria-label={post.isBookmarked ? "Remove bookmark" : "Bookmark"}
        aria-pressed={post.isBookmarked}
        disabled={mutation.isPending}
        onClick={() => press("bookmark")}
      >
        <Bookmark size={18} fill={post.isBookmarked ? "currentColor" : "none"} />
      </button>
      <button type="button" className="action" aria-label="Share" onClick={() => void share()}>
        <Share2 size={17} />
      </button>
    </div>
  );
}

function PostMenu({
  post,
  visible,
  onEdit,
  onDelete,
}: {
  post: Post;
  visible: Post | Models["ReferencedPostDto"];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const own = user?.id === post.author.id;
  const author = visible.author;
  const [reporting, setReporting] = useState(false);
  const { on } = useFeatures();
  const hasVideo = visible.media.some((m) => m.type === "VIDEO");
  const follow = useMutation({
    mutationFn: () => api(visible.isFollowingAuthor ? "followsUnfollow" : "followsFollow", { params: { id: author.id } }),
    onSuccess: (data) => {
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "suggestions" });
      toast(
        data.status === "FOLLOWING"
          ? `You’re now following ${author.displayName}.`
          : data.status === "REQUESTED"
            ? "Follow request sent."
            : `You unfollowed ${author.displayName}.`,
      );
    },
    onError: (e) => toast(e.message, true),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/post/${visible.id}`);
      toast("Link copied to clipboard.");
    } catch {
      toast("Unable to copy the link.", true);
    }
  };
  return (
    <>
    <Dropdown
      label="Post options"
      className="post-menu"
      summaryClassName="icon-button"
      summary={<MoreHorizontal size={19} />}
    >
      <Link href={`/post/${visible.id}`}>
        <ExternalLink size={16} /> View post
      </Link>
      {hasVideo && on("reels") && (
        <Link href={`/reels?start=${visible.id}`}>
          <Clapperboard size={16} /> Watch in Reels
        </Link>
      )}
      <button type="button" onClick={() => void copy()}>
        <Link2 size={16} /> Copy link
      </button>
      {user && user.id !== author.id && (
        <button type="button" disabled={follow.isPending} onClick={() => follow.mutate()}>
          {visible.isFollowingAuthor ? <UserMinus size={16} /> : <UserPlus size={16} />}
          {visible.isFollowingAuthor ? `Unfollow @${author.username}` : `Follow @${author.username}`}
        </button>
      )}
      {own && post.kind !== "REPOST" && (
        <button type="button" onClick={onEdit}>
          <Pencil size={16} /> Edit post
        </button>
      )}
      {own && (
        <button type="button" className="danger-text" onClick={onDelete}>
          <Trash2 size={16} /> {post.kind === "REPOST" ? "Undo repost" : "Delete post"}
        </button>
      )}
      {user && user.id !== author.id && on("reporting") && (
        <button type="button" className="danger-text" onClick={() => setReporting(true)}>
          <Flag size={16} /> Report post
        </button>
      )}
    </Dropdown>
    {reporting && (
      <ReportDialog targetType="POST" targetId={visible.id} subject="this post" onClose={() => setReporting(false)} />
    )}
    </>
  );
}

export default function PostCard({ post, detail = false }: { post: Post; detail?: boolean }) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [comments, setComments] = useState(detail);
  const [quote, setQuote] = useState(false);
  const [edit, setEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [content, setContent] = useState(post.content ?? "");
  const [heartBurst, setHeartBurst] = useState<{ id: number; rot: number; dx: number; dy: number } | null>(null);
  const mutation = useMutation({
    mutationFn: async (action: "edit" | "delete") =>
      action === "delete"
        ? api("postsRemove", { params: { id: post.id } })
        : api("postsUpdate", { params: { id: post.id }, body: { content } }),
    onSuccess: async (_data, action) => {
      setEdit(false);
      setDeleting(false);
      await client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "suggestions" });
      toast(action === "delete" ? "Post permanently deleted." : "Post updated.");
    },
    onError: (error) => toast(error.message, true),
  });
  const visible = post.kind === "REPOST" && post.referencedPost ? post.referencedPost : post;
  const quoted = post.kind === "QUOTE" ? post.referencedPost : null;
  const engagement = usePostEngagement(visible);
  const doubleTapLike = () => {
    if (!user || !visible.media.length) return;
    setHeartBurst({ id: Date.now(), rot: (Math.random() - 0.5) * 40, dx: (Math.random() - 0.5) * 40, dy: (Math.random() - 0.5) * 40 });
    if (navigator.vibrate) navigator.vibrate(15);
    if (!visible.isLiked) engagement.act("like");
  };
  const mediaClickHandler = useDoubleTap(doubleTapLike);

  return (
    <article className="card post-card" aria-labelledby={`post-${post.id}-author`}>
      {post.kind === "REPOST" && (
        <div className="reposted-label">
          <Repeat2 size={14} aria-hidden="true" />
          <Link href={`/profile/${post.author.username}`}>
            Reposted by {user?.id === post.author.id ? "you" : `@${post.author.username}`}
          </Link>
        </div>
      )}
      <header className="post-header">
        <Link href={`/profile/${visible.author.username}`} className="user-identity">
          <Avatar user={visible.author} size={42} />
          <span className="post-author">
            <strong id={`post-${post.id}-author`}>{visible.author.displayName}{visible.author.isVerified && <VerifiedBadge />}</strong>
            <span className="post-meta">
              <span className="post-handle">@{visible.author.username}</span>
              <span className="meta-dot" aria-hidden="true">
                ·
              </span>
              <time dateTime={visible.createdAt} suppressHydrationWarning>
                {relativeTime(visible.createdAt)}
              </time>
              {visible.editedAt && <span className="edited-label">· Edited</span>}
              <span
                className="visibility-icon"
                title={visible.visibility === "PUBLIC" ? "Public" : "Followers only"}
                aria-label={visible.visibility === "PUBLIC" ? "Public" : "Followers only"}
              >
                {visible.visibility === "PUBLIC" ? <Globe2 size={11} /> : <Users size={11} />}
              </span>
            </span>
          </span>
        </Link>
        <PostMenu
          post={post}
          visible={visible}
          onEdit={() => {
            setContent(post.content ?? "");
            setEdit(true);
          }}
          onDelete={() => setDeleting(true)}
        />
      </header>
      {post.kind === "REPOST" && post.referencedPostUnavailable ? (
        <div className="quoted-post unavailable">This post is unavailable.</div>
      ) : (
        <>
          {visible.content && (() => {
            const parsed = parseInteractive(visible.content);
            return <>
              {parsed.before && <RichText text={parsed.before} />}
              {parsed.widget && <InteractiveWidget postId={visible.id} widget={parsed.widget} />}
              {parsed.after && <RichText text={parsed.after} />}
            </>;
          })()}
          {visible.media.length > 0 && (
            <div className="post-media-wrap" onClickCapture={mediaClickHandler}>
              <PostMedia media={visible.media} postId={visible.id} spoiler={hasSpoiler(visible.content)} />
              {heartBurst && (
                <Heart
                  key={heartBurst.id}
                  className="post-double-tap-heart"
                  size={96}
                  fill="currentColor"
                  style={{ "--rot": `${heartBurst.rot}deg`, "--dx": `${heartBurst.dx}px`, "--dy": `${heartBurst.dy}px` } as React.CSSProperties}
                  onAnimationEnd={() => setHeartBurst(null)}
                  aria-hidden="true"
                />
              )}
            </div>
          )}
        </>
      )}
      {post.kind === "QUOTE" &&
        (post.referencedPostUnavailable || !quoted ? (
          <div className="quoted-post unavailable">This post is unavailable.</div>
        ) : (
          <div className="quoted-post">
            <Link className="user-identity" href={`/profile/${quoted.author.username}`}>
              <Avatar user={quoted.author} size={24} />
              <strong>{quoted.author.displayName}{quoted.author.isVerified && <VerifiedBadge size={14} />}</strong>
              <span className="muted">@{quoted.author.username}</span>
            </Link>
            {quoted.content && <Link className="quoted-content" href={`/post/${quoted.id}`}>{quoted.content}</Link>}
            {quoted.media.length > 0 && <PostMedia media={quoted.media} postId={quoted.id} />}
            <Link href={`/post/${quoted.id}`} className="text-button muted small">View post <ExternalLink size={12} /></Link>
          </div>
        ))}
      {!(post.kind === "REPOST" && post.referencedPostUnavailable) && (
        <PostActions
          post={visible}
          commentsOpen={comments}
          onComments={() => setComments(!comments)}
          onQuote={() => setQuote(true)}
        />
      )}
      {comments && (
        <CommentList postId={visible.id} postAuthorId={visible.author.id} showInput={detail} />
      )}
      {!detail && user && !(post.kind === "REPOST" && post.referencedPostUnavailable) && (
        <CommentInput
          postId={visible.id}
          inline
          onDone={() => {
            setComments(true);
            toast("Comment posted.");
          }}
        />
      )}
      {quote && (
        <Modal title="Quote post" onClose={() => setQuote(false)}>
          <PostComposer quoteId={visible.id} onDone={() => setQuote(false)} />
        </Modal>
      )}
      {edit && (
        <Modal title="Edit post" onClose={() => setEdit(false)}>
          <form
            className="edit-post-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate("edit");
            }}
          >
            <textarea
              className="composer-textarea"
              aria-label="Edit post content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={5000}
              rows={6}
              data-autofocus
            />
            {mutation.isError && <p className="inline-error">{mutation.error.message}</p>}
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setEdit(false)}>
                Cancel
              </button>
              <button className="button" disabled={mutation.isPending || (!content.trim() && !post.media.length)}>
                {mutation.isPending && <Loader2 size={15} className="spin" />}
                Save changes
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title={post.kind === "REPOST" ? "Undo this repost?" : "Delete this post?"}
          description={
            post.kind === "REPOST"
              ? "The repost will be removed from your profile."
              : "This will remove the post from your profile and everyone’s feed."
          }
          onClose={() => setDeleting(false)}
          pending={mutation.isPending}
          onConfirm={() => mutation.mutate("delete")}
        />
      )}
    </article>
  );
}
