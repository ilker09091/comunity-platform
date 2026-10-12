"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api/client";
import {
  Avatar,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  LoadMore,
  VerifiedBadge,
} from "./ui";
import FollowButton from "./follow-button";
import PostCard from "./post-card";
import Feed from "./feed";

export default function Explore() {
  const params = useSearchParams();
  return (
    <ExploreResults
      key={params.toString()}
      initialSearch={params.get("q") ?? ""}
      initialTab={params.get("tab") === "people" ? "people" : "posts"}
    />
  );
}
function ExploreResults({
  initialSearch,
  initialTab,
}: {
  initialSearch: string;
  initialTab: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [q, setQ] = useState(search);
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQ(search.trim());
    }, 350);
    return () => clearTimeout(timeout);
  }, [search]);
  const posts = useInfiniteQuery({
    queryKey: ["posts", "search", q],
    queryFn: ({ pageParam, signal }) =>
      api("searchPosts", {
        query: { q, cursor: pageParam, limit: 10 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
    enabled: !!q && tab === "posts",
  });
  const users = useInfiniteQuery({
    queryKey: ["users", "search", q],
    queryFn: ({ pageParam, signal }) =>
      api("searchUsers", {
        query: { q, cursor: pageParam, limit: 10 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
    enabled: !!q && tab === "people",
  });
  const query = tab === "posts" ? posts : users;
  return (
    <>
      <section className="card explore-search">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.replace(
              `/explore?q=${encodeURIComponent(search.trim())}&tab=${tab}`,
            );
          }}
        >
          <Search size={21} />
          <input
            aria-label="Search the community"
            placeholder="Find people and conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
          />
          {search && (
            <button
              className="icon-button"
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                router.replace("/explore");
              }}
            >
              <X size={18} />
            </button>
          )}
        </form>
        <div className="search-tabs">
          <button
            className={tab === "posts" ? "active" : ""}
            aria-pressed={tab === "posts"}
            onClick={() => setTab("posts")}
          >
            Posts
          </button>
          <button
            className={tab === "people" ? "active" : ""}
            aria-pressed={tab === "people"}
            onClick={() => setTab("people")}
          >
            People
          </button>
        </div>
      </section>
      {!q ? (
        tab === "people" ? (
          <div className="card">
            <EmptyState
              title="Your next connection is out there"
              description="Search for a name or username to discover people."
            />
          </div>
        ) : (
          <Feed mode="explore" embedded />
        )
      ) : (
        <>
          <div className="search-results-heading">
            <h1>Results for “{q}”</h1>
            <span className="muted">
              {tab === "posts" ? "Conversations" : "People"}
            </span>
          </div>
          {query.isPending ? (
            <LoadingSkeleton />
          ) : query.isError ? (
            <div className="card">
              <ErrorState
                error={query.error}
                retry={() => void query.refetch()}
              />
            </div>
          ) : tab === "posts" ? (
            posts.data?.pages.some((p) => p.items.length) ? (
              <div className="post-list">
                {posts.data.pages
                  .flatMap((p) => p.items)
                  .map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
              </div>
            ) : (
              <div className="card">
                <EmptyState
                  title="No conversations found"
                  description="Try a different word or a shorter search."
                />
              </div>
            )
          ) : users.data?.pages.some((p) => p.items.length) ? (
            <section className="card people-results">
              {users.data.pages
                .flatMap((p) => p.items)
                .map((user) => (
                  <div className="people-result" key={user.id}>
                    <Link
                      href={`/profile/${user.username}`}
                      className="user-identity"
                    >
                      <Avatar user={user} size={48} />
                      <div>
                        <strong>{user.displayName}{user.isVerified && <VerifiedBadge />}</strong>
                        <span>@{user.username}</span>
                        {user.bio && <p>{user.bio}</p>}
                      </div>
                    </Link>
                    <FollowButton id={user.id} following={user.isFollowing} />
                  </div>
                ))}
            </section>
          ) : (
            <div className="card">
              <EmptyState
                title="No people found"
                description="Try searching for a name or username."
              />
            </div>
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
        </>
      )}
    </>
  );
}
