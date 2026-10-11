"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  Repeat2,
  UserPlus,
  UserCheck,
  CheckCheck,
  Check,
  Loader2,
  Quote,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import {
  followRequestErrorMessage,
  useFollowRequestDecision,
} from "@/lib/follow-requests";
import {
  Avatar,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  LoadMore,
  relativeTime,
  SignInPrompt,
} from "./ui";
import { InboxSection, useInboxUnread } from "./inbox";
import { useSession, useToast } from "./providers";

type Notification = Models["NotificationDto"];

const labels: Record<string, string> = {
  POST_LIKE: "liked your post",
  COMMENT: "commented on your post",
  COMMENT_REPLY: "replied to your comment",
  COMMENT_LIKE: "liked your comment",
  NEW_FOLLOWER: "started following you",
  FOLLOW_REQUEST: "wants to follow you",
  FOLLOW_ACCEPTED: "accepted your follow request",
  REPOST: "reposted your post",
  QUOTE_REPOST: "quoted your post",
};

const icons: Record<string, typeof Heart> = {
  POST_LIKE: Heart,
  COMMENT_LIKE: Heart,
  COMMENT: MessageCircle,
  COMMENT_REPLY: MessageCircle,
  REPOST: Repeat2,
  QUOTE_REPOST: Quote,
  FOLLOW_ACCEPTED: UserCheck,
};

export function useUnread() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["unread"],
    queryFn: ({ signal }) => api("notificationsUnreadCount", { signal }),
    enabled: !!user,
    refetchInterval: 45000,
  });
}

/** Badge count: social notifications plus unread announcements/warnings. */
export function useUnreadTotal() {
  const unread = useUnread();
  const inbox = useInboxUnread();
  if (unread.data === undefined && inbox.data === undefined) return undefined;
  return (unread.data?.count ?? 0) + (inbox.data?.count ?? 0);
}

/** Refresh notification lists whenever the polled unread counter changes. */
function useSyncOnUnreadChange() {
  const client = useQueryClient();
  const unread = useUnread();
  const previous = useRef<number | undefined>(undefined);
  const count = unread.data?.count;
  useEffect(() => {
    if (previous.current !== undefined && count !== previous.current)
      void client.invalidateQueries({ queryKey: ["notifications"] });
    previous.current = count;
  }, [count, client]);
  return unread;
}

function notificationHref(item: Notification) {
  if (item.type === "FOLLOW_REQUEST" || item.type === "NEW_FOLLOWER" || item.type === "FOLLOW_ACCEPTED" || !item.postId)
    return `/profile/${item.actor.username}`;
  return `/post/${item.postId}${item.commentId ? "#comment-" + item.commentId : ""}`;
}

function useMarkRead(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api("notificationsMarkRead", { params: { id } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications"] });
      void client.invalidateQueries({ queryKey: ["unread"] });
    },
  });
}

/** Accept/Reject controls for a pending FOLLOW_REQUEST notification. */
function FollowRequestActions({
  item,
  onResolved,
}: {
  item: Notification;
  onResolved: () => void;
}) {
  const toast = useToast();
  const decision = useFollowRequestDecision(item.actor.id);
  const [error, setError] = useState<string | null>(null);
  const run = (choice: "accept" | "reject") => {
    setError(null);
    decision.mutate(choice, {
      onSuccess: () => {
        onResolved();
        toast(
          choice === "accept"
            ? `${item.actor.displayName} can now see your posts.`
            : "Follow request declined.",
        );
      },
      onError: (e) => setError(followRequestErrorMessage(e)),
    });
  };
  if (decision.isSuccess)
    return (
      <span className={`notice-status ${decision.variables === "accept" ? "accepted" : ""}`}>
        {decision.variables === "accept" ? (
          <>
            <Check size={13} /> Accepted
          </>
        ) : (
          "Declined"
        )}
      </span>
    );
  return (
    <div className="notice-request">
      <div className="notice-actions" role="group" aria-label={`Follow request from ${item.actor.displayName}`}>
        <button
          type="button"
          className="button xs"
          disabled={decision.isPending}
          aria-busy={decision.isPending && decision.variables === "accept"}
          onClick={() => run("accept")}
        >
          {decision.isPending && decision.variables === "accept" && <Loader2 size={13} className="spin" />}
          Accept
        </button>
        <button
          type="button"
          className="button xs neutral"
          disabled={decision.isPending}
          aria-busy={decision.isPending && decision.variables === "reject"}
          onClick={() => run("reject")}
        >
          {decision.isPending && decision.variables === "reject" && <Loader2 size={13} className="spin" />}
          Reject
        </button>
      </div>
      {error && (
        <p className="notice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function NotificationRow({
  item,
  compact = false,
}: {
  item: Notification;
  compact?: boolean;
}) {
  const markRead = useMarkRead(item.id);
  const pending = item.type === "FOLLOW_REQUEST" && item.followRequestStatus === "PENDING";
  const Icon = icons[item.type] ?? UserPlus;
  const label =
    item.type === "FOLLOW_REQUEST" && item.followRequestStatus !== "PENDING"
      ? "requested to follow you"
      : labels[item.type] ?? "sent you an update";
  const markIfUnread = () => {
    if (!item.isRead && !markRead.isPending) markRead.mutate();
  };
  return (
    <li className={`notice ${item.isRead ? "" : "unread"} ${compact ? "compact" : ""}`}>
      <div className="notice-link">
        <Link href={`/profile/${item.actor.username}`} className="notice-avatar" aria-label={`View @${item.actor.username}'s profile`} onClick={markIfUnread}>
          <Avatar user={item.actor} size={compact ? 36 : 42} />
          <span className={`notice-icon type-${item.type.toLowerCase()}`} aria-hidden="true">
            <Icon size={10} strokeWidth={2.6} />
          </span>
        </Link>
        <span className="notice-text">
          <span className="notice-line">
            <Link href={`/profile/${item.actor.username}`} onClick={markIfUnread}><strong>{item.actor.displayName}</strong></Link> <Link href={notificationHref(item)} onClick={markIfUnread}>{label}</Link>
          </span>
          {!compact && item.type === "FOLLOW_REQUEST" && (
            <span className="notice-handle">@{item.actor.username}</span>
          )}
          {item.preview && <Link href={notificationHref(item)} className="notice-preview" onClick={markIfUnread}>{item.preview}</Link>}
          <time dateTime={item.createdAt} suppressHydrationWarning>
            {relativeTime(item.createdAt)}
          </time>
        </span>
      </div>
      {pending ? (
        <FollowRequestActions item={item} onResolved={markIfUnread} />
      ) : item.type === "FOLLOW_REQUEST" && item.followRequestStatus === "ACCEPTED" ? (
        <span className="notice-status accepted">
          <Check size={13} /> Accepted
        </span>
      ) : null}
      {!item.isRead && !pending && (
        <button
          type="button"
          className="unread-dot"
          aria-label="Mark as read"
          title="Mark as read"
          onClick={markIfUnread}
          disabled={markRead.isPending}
        />
      )}
    </li>
  );
}

export function ActivityWidget() {
  const { user, loading } = useSession();
  useSyncOnUnreadChange();
  const query = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: ({ signal }) => api("notificationsList", { query: { limit: 15 }, signal }),
    enabled: !!user,
    refetchInterval: 45000,
  });
  // Actionable follow requests are pinned to the top so they never scroll out of the widget.
  const items = query.data
    ? [
        ...query.data.items.filter((n) => n.followRequestStatus === "PENDING"),
        ...query.data.items.filter((n) => n.followRequestStatus !== "PENDING"),
      ].slice(0, 5)
    : [];
  return (
    <section className="card widget" aria-labelledby="activity-title">
      <div className="widget-heading">
        <h2 id="activity-title">Activity</h2>
        {user && <Link href="/notifications">See all</Link>}
      </div>
      {loading || (user && query.isPending) ? (
        <WidgetSkeleton />
      ) : !user ? (
        <p className="widget-note">
          <Link href="/login">Sign in</Link> to see likes, comments and new followers.
        </p>
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : items.length ? (
        <ul className="notice-list">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} compact />
          ))}
        </ul>
      ) : (
        <p className="widget-note">You’re all caught up. New activity will appear here.</p>
      )}
    </section>
  );
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="widget-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton circle" />
          <div>
            <div className="skeleton line short" />
            <div className="skeleton line tiny" />
          </div>
        </div>
      ))}
    </div>
  );
}

function groupLabel(value: string) {
  const date = new Date(value);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - date.getTime()) / 86400000) + 1;
  if (date >= startOfToday) return "Today";
  if (days <= 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

export default function NotificationCenter() {
  const { user, loading } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const unread = useSyncOnUnreadChange();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const query = useInfiniteQuery({
    queryKey: ["notifications", "list", filter],
    queryFn: ({ pageParam, signal }) =>
      api("notificationsList", {
        query: { cursor: pageParam, limit: 20, unreadOnly: filter === "unread" || undefined },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: !!user,
  });
  const markAll = useMutation({
    mutationFn: () => api("notificationsMarkAllRead"),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications"] });
      void client.invalidateQueries({ queryKey: ["unread"] });
      toast("All notifications marked as read.");
    },
    onError: (e) => toast(e.message, true),
  });
  if (loading) return <LoadingSkeleton compact />;
  if (!user)
    return <SignInPrompt title="Stay in the loop" description="Sign in to see your notifications." />;

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const groups: [string, Notification[]][] = [];
  for (const item of items) {
    const label = groupLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  const unreadCount = unread.data?.count ?? 0;

  return (
    <section className="card notification-center">
      <header className="notification-header">
        <div className="notification-title">
          <h1>Notifications</h1>
          {unreadCount > 0 && <span className="count-chip">{unreadCount} unread</span>}
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || !unreadCount}
        >
          {markAll.isPending ? <Loader2 size={14} className="spin" /> : <CheckCheck size={15} />}
          Mark all as read
        </button>
      </header>
      <div className="segmented" role="tablist" aria-label="Filter notifications">
        {(["all", "unread"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "All" : "Unread"}
          </button>
        ))}
      </div>
      <InboxSection unreadOnly={filter === "unread"} />
      {query.isPending ? (
        <WidgetSkeleton rows={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : items.length ? (
        groups.map(([label, group]) => (
          <div className="notice-group" key={label}>
            <h2 className="group-label">{label}</h2>
            <ul className="notice-list">
              {group.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <EmptyState
          title={filter === "unread" ? "No unread notifications" : "You’re all caught up"}
          description="Likes, replies and new connections will appear here."
        />
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </section>
  );
}
