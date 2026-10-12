"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSession } from "./providers";
import PostComposer from "./post-composer";
import PostCard from "./post-card";
import ProfileGrid from "./profile-grid";
import PullToRefresh from "./pull-to-refresh";
import { EmptyState, ErrorState, LoadingSkeleton, LoadMore, PageHeader, SignInPrompt } from "./ui";

export type FeedMode = "global" | "following" | "explore" | "saved";

const SORTS = [
  { value: "recent", label: "Recent", mode: "global" },
  { value: "following", label: "Following", mode: "following" },
  { value: "popular", label: "Popular", mode: "explore" },
] as const;

/** Compact divider with a "Sort by" control, as in the reference feed. */
export function FeedToolbar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="feed-toolbar">
      <span className="feed-toolbar-line" aria-hidden="true" />
      <label className="feed-sort">
        Sort by:
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Sort feed">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Home: composer, sort toolbar and the selected feed. */
export function HomeFeed() {
  const params = useSearchParams();
  const pathname = usePathname();
  const sort = SORTS.find((s) => s.value === params.get("sort")) ?? SORTS[0];
  return (
    <>
      <h1 className="sr-only">Home</h1>
      <PostComposer />
      <FeedToolbar
        value={sort.value}
        onChange={(value) =>
          window.history.replaceState(null, "", value === "recent" ? pathname : `${pathname}?sort=${value}`)
        }
      />
      <Feed mode={sort.mode} embedded />
    </>
  );
}

const headers: Record<Exclude<FeedMode, "global">, [string, string]> = {
  following: ["Following", "The latest from the people you follow."],
  explore: ["Popular", "What’s sparking conversations right now."],
  saved: ["Saved posts", "Posts you’ve bookmarked. Only you can see this list."],
};

export default function Feed({
  mode = "global",
  userId,
  kinds,
  emptyTitle,
  emptyDescription,
  embedded = false,
  content = 'all',
  layout = 'classic',
}: {
  mode?: FeedMode;
  userId?: string;
  content?: 'home'|'reels'|'all';
  layout?: 'classic'|'grid';
  /** Profile timeline filter, e.g. ["POST", "QUOTE"] or ["REPOST"]. */
  kinds?: ("POST" | "REPOST" | "QUOTE")[];
  emptyTitle?: string;
  emptyDescription?: string;
  /** Rendered inside another page section: no page header. */
  embedded?: boolean;
}) {
  const { user, loading } = useSession();
  const protectedFeed = mode === "following" || mode === "saved";
  const query = useInfiniteQuery({
    queryKey: ["posts", userId ? "profile" : mode, userId, kinds?.join(","),content],
    queryFn: ({ pageParam, signal }) => {
      const options = { query: { cursor: pageParam, limit: 10 }, signal };
      if (userId)
        return api("postsByUser", {
          ...options,
          query: { ...options.query, kinds: kinds?.join(","),content },
          params: { id: userId },
        });
      if (mode === "saved") return api("bookmarksList", options);
      return api(mode === "following" ? "feedFollowing" : mode === "explore" ? "feedExplore" : "feedGlobal", options);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: !loading && (!protectedFeed || !!user),
  });
  const items = Array.from(
    new Map((query.data?.pages.flatMap((page) => page.items) ?? []).map((post) => [post.id, post])).values(),
  );
  const header = !embedded && !userId && mode !== "global" ? headers[mode] : null;

  return (
    <>
      {header && <PageHeader title={header[0]} description={header[1]} />}
      {loading || (query.isPending && (!protectedFeed || user)) ? (
        <div className="post-list">
          <LoadingSkeleton />
          <LoadingSkeleton compact />
        </div>
      ) : protectedFeed && !user ? (
        <SignInPrompt
          title={mode === "saved" ? "Keep your favorites close" : "Find your people"}
          description={
            mode === "saved"
              ? "Sign in to view your bookmarked posts."
              : "Sign in to see posts from the people you follow."
          }
        />
      ) : query.isError ? (
        <div className="card">
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        </div>
      ) : items.length ? (
        <PullToRefresh onRefresh={() => query.refetch()}>
          {layout === 'grid' ? <ProfileGrid posts={items} reelsUserId={userId}/> : <div className="post-list">
            {items.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>}
        </PullToRefresh>
      ) : (
        <section className="card">
          <EmptyState
            title={
              emptyTitle ??
              (mode === "saved"
                ? "No saved posts yet"
                : mode === "following"
                  ? "Nothing from your circle yet"
                  : userId
                    ? "No posts yet"
                    : "Be the first to share something")
            }
            description={
              emptyDescription ??
              (mode === "saved"
                ? "Tap the bookmark on any post to keep it here."
                : mode === "following"
                  ? "Follow people to see their posts here."
                  : userId
                    ? "When this person shares something, it will appear here."
                    : "A thought, a photo, a small discovery — there’s room for it here.")
            }
            action={
              userId ? undefined : mode === "following" || mode === "saved" ? (
                <Link href="/explore" className="button secondary small">
                  Explore the community <ArrowUpRight size={15} />
                </Link>
              ) : (
                <button className="button secondary small" onClick={() => void query.refetch()}>
                  <RefreshCw size={15} /> Refresh
                </button>
              )
            }
          />
        </section>
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
      {query.isFetchNextPageError && (
        <ErrorState error={query.error} retry={() => void query.fetchNextPage()} />
      )}
    </>
  );
}
