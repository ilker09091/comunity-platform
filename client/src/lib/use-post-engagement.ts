"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Models, type Post } from "@/lib/api/client";
import { patchPost } from "@/lib/post-cache";
import { useSession, useToast } from "@/components/providers";
import { haptic } from "@/lib/haptics";

export type EngagementAction = "like" | "bookmark" | "repost";
type Toggle = { action: EngagementAction; active: boolean };
const POST_QUERIES = (q: { queryKey: readonly unknown[] }) =>
  ["posts", "post", "discovery"].includes(String(q.queryKey[0]));

/**
 * Like / bookmark / repost toggles with optimistic updates across every cached copy of the
 * post (feeds, reels, profile tabs, detail, quotes) and rollback on failure. Shared by feed
 * cards and the Reels player.
 */
export function usePostEngagement(post: Post | Models["ReferencedPostDto"]) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ action, active }: Toggle) => {
      const params = { id: post.id };
      return action === "like"
        ? api(active ? "likesUnlikePost" : "likesLikePost", { params })
        : action === "bookmark"
          ? api(active ? "bookmarksRemove" : "bookmarksAdd", { params })
          : api(active ? "repostsUndo" : "repostsRepost", { params });
    },
    onMutate: async ({ action }: Toggle) => {
      await client.cancelQueries({ predicate: POST_QUERIES });
      const old =
        action === "like"
          ? { isLiked: post.isLiked, likeCount: post.likeCount }
          : action === "bookmark"
            ? { isBookmarked: post.isBookmarked, bookmarkCount: post.bookmarkCount }
            : { isReposted: post.isReposted, repostCount: post.repostCount };
      const patch =
        action === "like"
          ? { isLiked: !post.isLiked, likeCount: Math.max(0, post.likeCount + (post.isLiked ? -1 : 1)) }
          : action === "bookmark"
            ? {
                isBookmarked: !post.isBookmarked,
                bookmarkCount: Math.max(0, post.bookmarkCount + (post.isBookmarked ? -1 : 1)),
              }
            : { isReposted: !post.isReposted, repostCount: Math.max(0, post.repostCount + (post.isReposted ? -1 : 1)) };
      patchPost(client, post.id, patch);
      return old;
    },
    onSuccess: (result) => {
      if (result && "liked" in result) patchPost(client, post.id, { isLiked: result.liked, likeCount: result.likeCount });
      if (result && "bookmarked" in result)
        patchPost(client, post.id, { isBookmarked: result.bookmarked, bookmarkCount: result.bookmarkCount });
      if (result && "reposted" in result)
        patchPost(client, post.id, { isReposted: result.reposted, repostCount: result.repostCount });
    },
    onError: (error, _action, old) => {
      if (old) patchPost(client, post.id, old);
      toast(error.message, true);
    },
    onSettled: (_data, _error, { action }) => {
      void client.invalidateQueries({ predicate: POST_QUERIES });
      if (action === "repost") {
        void client.invalidateQueries({ queryKey: ["profile"] });
        void client.invalidateQueries({ queryKey: ["session"] });
      }
    },
  });
  const act = (action: EngagementAction) => {
    if (!user) {
      toast("Sign in to join the conversation.");
      return;
    }
    if (mutation.isPending) return;
    haptic("tap");
    mutation.mutate({
      action,
      active: action === "like" ? post.isLiked : action === "bookmark" ? post.isBookmarked : post.isReposted,
    });
  };
  return { act, pending: mutation.isPending, repostable: post.visibility === "PUBLIC" && !post.author.isPrivate };
}

/** Native share sheet when available, otherwise copies the link. */
export async function sharePath(path: string, toast: (message: string, error?: boolean) => void) {
  const url = `${window.location.origin}${path}`;
  try {
    if (navigator.share) await navigator.share({ url });
    else {
      await navigator.clipboard.writeText(url);
      toast("Link copied to clipboard.");
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) toast("Unable to share. Copy this link: " + url, true);
  }
}
