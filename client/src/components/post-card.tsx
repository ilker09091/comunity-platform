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
} from "lucide-react";
import ReportDialog from "./report-dialog";
import { useFeatures } from "@/lib/platform-config";
import { api, type Post, type Models } from "@/lib/api/client";
import { sharePath, usePostEngagement } from "@/lib/use-post-engagement";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Dropdown, Modal, relativeTime } from "./ui";
import CommentList, { CommentInput } from "./comments";
import PostComposer from "./post-composer";
import VideoPlayerCore from "./video-player-core";
import PhotoGallery from "./photo-gallery";

const HASHTAG = /(#[\p{L}\p{N}_]{1,60})/gu;

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

export function PostMedia({ media, postId }: { media: Models["MediaDto"][]; postId?: string }) {
  const client = useQueryClient();
  const refresh = postId ? async () => {
    const post = await api("postsGet", { params: { id: postId } });
    client.setQueryData(["post", postId], post);
    await client.invalidateQueries({ predicate: query => query.queryKey[0] === "posts" || query.queryKey[0] === "discovery" });
  } : undefined;
  const single = media.length === 1;
  if (media.length && media.every(item => item.type==='IMAGE' && item.status==='READY')) return <PhotoGallery photos={media}/>;
  return (
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
            <strong id={`post-${post.id}-author`}>{visible.author.displayName}</strong>
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
          {visible.content && <RichText text={visible.content} />}
          {visible.media.length > 0 && <PostMedia media={visible.media} postId={visible.id} />}
        </>
      )}
      {post.kind === "QUOTE" &&
        (post.referencedPostUnavailable || !quoted ? (
          <div className="quoted-post unavailable">This post is unavailable.</div>
        ) : (
          <div className="quoted-post">
            <Link className="user-identity" href={`/profile/${quoted.author.username}`}>
              <Avatar user={quoted.author} size={24} />
              <strong>{quoted.author.displayName}</strong>
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
