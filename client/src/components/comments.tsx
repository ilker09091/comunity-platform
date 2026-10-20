"use client";
import Link from "next/link";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Heart,
  CornerDownRight,
  Send,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { useSession, useToast } from "./providers";
import {
  Avatar,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  LoadMore,
  relativeTime,
  VerifiedBadge,
} from "./ui";
import { useFeatures } from "@/lib/platform-config";
import { GifView, StickerButton, StickerView } from "./sticker-picker";

export function CommentInput({
  postId,
  parentId,
  onDone,
  inline = false,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
  /** Compact single-line variant shown at the bottom of feed cards. */
  inline?: boolean;
}) {
  const { user } = useSession();
  const { config, canWrite, readOnly } = useFeatures();
  const client = useQueryClient();
  const [content, setContent] = useState("");
  const mutation = useMutation({
    mutationFn: (attachment?: { stickerId?: string; gifId?: string }) => {
      const body = { content: content.trim() || undefined, ...attachment };
      return parentId
        ? api("commentsReply", { params: { id: parentId }, body })
        : api("commentsCreate", { params: { id: postId }, body });
    },
    onSuccess: () => {
      setContent("");
      void client.invalidateQueries({ queryKey: ["comments"] });
      void client.invalidateQueries({ queryKey: ["posts"] });
      void client.invalidateQueries({ queryKey: ["post"] });
      onDone?.();
    },
  });
  if (!user)
    return (
      <p className="comment-signin">
        <Link href="/login">Sign in</Link> to join the conversation.
      </p>
    );
  if (!canWrite("comments"))
    return (
      <p className="comment-signin" role="status">
        {readOnly ? (config?.maintenanceMessage || "Comments are paused while Circle is in read-only mode.") : "Comments are turned off right now."}
      </p>
    );
  const submit = () => {
    if (content.trim() && !mutation.isPending) mutation.mutate(undefined);
  };
  return (
    <form
      className={`comment-form ${inline ? "inline" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Link href={`/profile/${user.username}`} aria-label="Your profile"><Avatar user={user} size={inline ? 30 : 32} /></Link>
      <div className="comment-field has-sticker">
        <label
          className="sr-only"
          htmlFor={`comment-input-${inline ? "inline-" : ""}${parentId ?? postId}`}
        >
          {parentId ? "Write a reply" : "Write a comment"}
        </label>
        <textarea
          id={`comment-input-${inline ? "inline-" : ""}${parentId ?? postId}`}
          placeholder={parentId ? "Write a reply…" : "Write a comment…"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={config?.commentMaxLength ?? 2000}
          rows={1}
          disabled={mutation.isPending}
        />
        <StickerButton
          disabled={mutation.isPending}
          onPick={(sticker) => mutation.mutate({ stickerId: sticker.id })}
          onGif={(gif) => mutation.mutate({ gifId: gif.id })}
        />
        <button
          className="comment-send"
          type="submit"
          disabled={!content.trim() || mutation.isPending}
          aria-label={parentId ? "Send reply" : "Send comment"}
        >
          {mutation.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
        {mutation.isError && (
          <p className="inline-error" role="alert">
            {mutation.error.message}
          </p>
        )}
      </div>
    </form>
  );
}
export function CommentItem({
  item,
  postAuthorId,
}: {
  item: Models["CommentDto"];
  postAuthorId: string;
}) {
  const { user } = useSession();
  const { config, canWrite } = useFeatures();
  const toast = useToast();
  const client = useQueryClient();
  const [reply, setReply] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content ?? "");
  const [deleting, setDeleting] = useState(false);
  const mutation = useMutation({
    mutationFn: async (action: "like" | "edit" | "delete") => {
      if (action === "like")
        return api(item.isLiked ? "likesUnlikeComment" : "likesLikeComment", {
          params: { id: item.id },
        });
      if (action === "edit")
        return api("commentsUpdate", {
          params: { id: item.id },
          body: { content: content.trim() },
        });
      return api("commentsRemove", { params: { id: item.id } });
    },
    onSuccess: () => {
      setEditing(false);
      setDeleting(false);
      void client.invalidateQueries({ queryKey: ["comments"] });
      void client.invalidateQueries({ queryKey: ["post"] });
      void client.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const tombstone = item.status !== "ACTIVE";
  return (
    <article className="comment-item" id={`comment-${item.id}`}>
      {item.author ? <Link href={`/profile/${item.author.username}`} aria-label={`View @${item.author.username}'s profile`}><Avatar user={item.author} size={31} /></Link> : <Avatar user={item.author} size={31} />}
      <div className="comment-body">
        <div className={`comment-bubble ${!tombstone && !item.content && (item.sticker || item.gif) ? "sticker-only" : ""}`}>
          <div className="comment-heading">
            {item.author ? (
              <Link href={`/profile/${item.author.username}`}>
                <strong>{item.author.displayName}{item.author.isVerified && <VerifiedBadge size={14} />}</strong>
              </Link>
            ) : (
              <strong>Deleted comment</strong>
            )}
            <time dateTime={item.createdAt} suppressHydrationWarning>
              {relativeTime(item.createdAt)}
            </time>
          </div>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate("edit");
              }}
            >
              <textarea
                aria-label="Edit comment"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={config?.commentMaxLength ?? 2000}
              />
              <div className="inline-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <button
                  className="text-button"
                  disabled={!content.trim() || mutation.isPending}
                >
                  Save
                </button>
              </div>
            </form>
          ) : tombstone ? (
            <p className="muted">This comment is no longer available.</p>
          ) : (
            <>
              {item.content && <p>{item.content}</p>}
              {item.sticker && (
                <div className="comment-sticker">
                  <StickerView sticker={item.sticker} />
                </div>
              )}
              {item.stickerUnavailable && <p className="muted">Sticker unavailable</p>}
              {item.gif && <GifView gif={item.gif} className="comment-gif" maxWidth={220} />}
            </>
          )}
        </div>
        {!tombstone && (
          <div className="comment-actions">
            <button
              disabled={mutation.isPending}
              className={item.isLiked ? "liked" : ""}
              onClick={() => {
                if (!user) {
                  toast("Sign in to like comments.");
                  return;
                }
                mutation.mutate("like");
              }}
            >
              <Heart size={13} fill={item.isLiked ? "currentColor" : "none"} />
              {item.likeCount || "Like"}
            </button>
            {item.canReply && canWrite("comments") && (
              <button onClick={() => setReply(!reply)}>Reply</button>
            )}
            {user?.id === item.author?.id && !!item.content && (
              <button
                aria-label="Edit comment"
                onClick={() => setEditing(true)}
              >
                <Pencil size={12} />
              </button>
            )}
            {user &&
              (user.id === item.author?.id || user.id === postAuthorId) && (
                <button
                  aria-label="Delete comment"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            {item.editedAt && <span>Edited</span>}
          </div>
        )}
        {reply && (
          <CommentInput
            postId={item.postId}
            parentId={item.id}
            onDone={() => {
              setReply(false);
              setShowReplies(true);
            }}
          />
        )}{" "}
        {item.hasReplies && (
          <button
            className="replies-toggle"
            onClick={() => setShowReplies(!showReplies)}
          >
            <CornerDownRight size={14} />
            {showReplies
              ? "Hide replies"
              : `View replies${item.replyCount ? " (" + item.replyCount + ")" : ""}`}
          </button>
        )}
        {showReplies && (
          <CommentList
            postId={item.postId}
            parentId={item.id}
            postAuthorId={postAuthorId}
          />
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete this comment?"
          description="Replies will stay visible to preserve the conversation."
          pending={mutation.isPending}
          onClose={() => setDeleting(false)}
          onConfirm={() => mutation.mutate("delete")}
        />
      )}
    </article>
  );
}
export default function CommentList({
  postId,
  parentId,
  postAuthorId,
  showInput = true,
}: {
  postId: string;
  parentId?: string;
  postAuthorId: string;
  showInput?: boolean;
}) {
  const [sort, setSort] = useState("NEWEST");
  const query = useInfiniteQuery({
    queryKey: ["comments", postId, parentId, sort],
    queryFn: ({ pageParam, signal }) =>
      parentId
        ? api("commentsReplies", {
            params: { id: parentId },
            query: { cursor: pageParam, limit: 10 },
            signal,
          })
        : api("commentsListForPost", {
            params: { id: postId },
            query: { cursor: pageParam, limit: 10, sort },
            signal,
          }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className={parentId ? "reply-list" : "comments-section"}>
      {!parentId && (
        <>
          <div className="comments-title">
            <h3>Comments</h3>
            <select
              aria-label="Sort comments"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="NEWEST">Newest first</option>
              <option value="OLDEST">Oldest first</option>
              <option value="TOP">Most liked</option>
            </select>
          </div>
          {showInput && <CommentInput postId={postId} />}
        </>
      )}
      {query.isPending ? (
        <LoadingSkeleton compact />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : items.length ? (
        items.map((item) => (
          <CommentItem key={item.id} item={item} postAuthorId={postAuthorId} />
        ))
      ) : (
        !parentId && (
          <EmptyState
            title="No comments yet"
            description="Start the conversation."
          />
        )
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
      {query.isFetchNextPageError && (
        <ErrorState
          error={query.error}
          retry={() => void query.fetchNextPage()}
        />
      )}
    </section>
  );
}
