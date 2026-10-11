"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, ShieldAlert } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { useSession, useToast } from "./providers";
import { LoadMore, relativeTime } from "./ui";

type Item = Models["InboxItemDto"];

/** Unread announcements and policy warnings (separate from social notifications). */
export function useInboxUnread() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["inbox", "unread"],
    queryFn: ({ signal }) => api("inboxUnread", { signal }),
    enabled: !!user,
    refetchInterval: 60000,
  });
}

function useMarkInboxRead() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (items?: { kind: Item["kind"]; id: string }[]) => api("inboxRead", { body: items ? { items } : {} }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["inbox"] }),
    onError: (e) => toast(e.message, true),
  });
}

/** “From Circle” section shown at the top of the notification center. Renders nothing when empty. */
export function InboxSection({ unreadOnly }: { unreadOnly: boolean }) {
  const { user } = useSession();
  const markRead = useMarkInboxRead();
  const query = useInfiniteQuery({
    queryKey: ["inbox", "list"],
    queryFn: ({ pageParam, signal }) => api("inboxList", { query: { cursor: pageParam, limit: 10 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: !!user,
  });
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !unreadOnly || !i.isRead);
  if (!items.length) return null;
  const unread = items.filter((i) => !i.isRead);
  return (
    <div className="notice-group inbox-group">
      <h2 className="group-label">
        From Circle
        {unread.length > 1 && (
          <button type="button" className="text-button" onClick={() => markRead.mutate(undefined)} disabled={markRead.isPending}>
            Mark all read
          </button>
        )}
      </h2>
      <ul className="notice-list">
        {items.map((item) => {
          const warning = item.kind === "WARNING";
          const Icon = warning ? ShieldAlert : Megaphone;
          return (
            <li key={`${item.kind}-${item.id}`} className={`notice inbox-item ${warning ? "warning" : ""} ${item.isRead ? "" : "unread"}`}>
              <div className="notice-link">
                <span className="inbox-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="notice-text">
                  <span className="notice-line">
                    <strong>{item.title}</strong>
                  </span>
                  <span className="inbox-body">{item.body}</span>
                  <time dateTime={item.createdAt} suppressHydrationWarning>
                    {warning ? "Policy warning · " : "Announcement · "}
                    {relativeTime(item.createdAt)}
                  </time>
                </span>
              </div>
              {!item.isRead && (
                <button
                  type="button"
                  className="unread-dot"
                  aria-label="Mark as read"
                  title="Mark as read"
                  onClick={() => markRead.mutate([{ kind: item.kind, id: item.id }])}
                  disabled={markRead.isPending}
                />
              )}
            </li>
          );
        })}
      </ul>
      <LoadMore hasMore={query.hasNextPage} pending={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </div>
  );
}
