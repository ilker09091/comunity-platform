"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Send, Link2, CirclePlus } from "lucide-react";
import { api, type User } from "@/lib/api/client";
import { sharePath } from "@/lib/use-post-engagement";
import { useSession, useToast } from "./providers";
import { Avatar, EmptyState, ErrorState, LoadMore, Modal } from "./ui";

export function useMessageUnread() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["messages", user?.id, "unread"],
    queryFn: ({ signal }) => api("messagesUnread", { signal }),
    enabled: !!user,
    refetchInterval: 15000,
  });
}

export function RecipientPicker({
  onSelect,
  disabled = false,
}: {
  onSelect: (user: User) => void;
  disabled?: boolean;
}) {
  const { user } = useSession();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useInfiniteQuery({
    queryKey: ["message-recipients", user?.id, term],
    queryFn: ({ pageParam, signal }) =>
      api("searchUsers", {
        query: { q: term, limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
    enabled: !!user && !!term,
  });
  const recent = useQuery({
    queryKey: ["messages", user?.id, "recent"],
    queryFn: ({ signal }) =>
      api("messagesConversations", { query: { limit: 10 }, signal }),
    enabled: !!user && !term,
  });
  const people = term
    ? (results.data?.pages.flatMap((p) => p.items) ?? [])
    : (recent.data?.items.map((c) => c.user) ?? []);
  const error = term ? results.error : recent.error;
  const pending = term ? results.isFetching : recent.isFetching;
  return (
    <div className="recipient-picker">
      <input
        className="social-input"
        data-autofocus
        aria-label="Search recipients"
        placeholder="Search by name or username"
        maxLength={100}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="social-hint">
        {term ? "Search results" : "Recent conversations"}
      </p>
      {pending && <p role="status">Loading people...</p>}
      {error && (
        <ErrorState
          error={error}
          retry={() => void (term ? results.refetch() : recent.refetch())}
        />
      )}
      {people
        .filter((p) => p.id !== user?.id)
        .map((person) => (
          <button
            className="recipient-row"
            type="button"
            key={person.id}
            disabled={disabled}
            onClick={() => onSelect(person)}
          >
            <Avatar user={person} size={40} />
            <span>
              <strong>{person.displayName}</strong>
              <small>@{person.username}</small>
            </span>
            <Send size={17} />
          </button>
        ))}
      {!pending && !error && !people.length && (
        <EmptyState
          title={term ? "No people found" : "Start a conversation"}
          description={
            term
              ? "Try a different name."
              : "Search for someone to send a message."
          }
        />
      )}
      {term && (
        <LoadMore
          hasMore={results.hasNextPage}
          pending={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        />
      )}
    </div>
  );
}

export function SendPostButton({
  postId,
  reel = false,
  story = false,
}: {
  postId: string;
  reel?: boolean;
  /** Offer "Add to your story" (Reels and video posts). */
  story?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const send = useMutation({
    mutationFn: (recipient: User) =>
      api("messagesSend", { params: { id: recipient.id }, body: { postId } }),
    onSuccess: () => {
      toast("Sent to your conversation.");
      setOpen(false);
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const share = useMutation({
    mutationFn: () => api("storiesCreate", { body: { postId } }),
    onSuccess: () => {
      toast("Added to your story for 24 hours.");
      setOpen(false);
      void client.invalidateQueries({ queryKey: ["stories"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const pending = send.isPending || share.isPending;
  return (
    <>
      <button
        type="button"
        className={reel ? "reel-action share" : "action"}
        aria-label="Send to a user"
        onClick={() =>
          user ? setOpen(true) : toast("Sign in to send videos and posts.")
        }
      >
        {reel ? (
          <>
            <span className="reel-action-icon">
              <Send size={22} />
            </span>
            <span>Send</span>
          </>
        ) : (
          <Send size={17} />
        )}
      </button>
      {open && (
        <Modal
          title="Send to someone"
          onClose={() => setOpen(false)}
          guardClose={() => !pending}
        >
          {story && (
            <button
              type="button"
              className="story-share-row"
              disabled={pending}
              onClick={() => share.mutate()}
            >
              <span className="story-share-icon">
                <CirclePlus size={22} />
              </span>
              <span>
                <strong>
                  {share.isPending ? "Adding..." : "Add to your story"}
                </strong>
                <small>Your followers can watch it for 24 hours</small>
              </span>
            </button>
          )}
          <RecipientPicker
            onSelect={(recipient) => send.mutate(recipient)}
            disabled={pending}
          />
          {send.isPending && <p role="status">Sending...</p>}
          <div className="social-dialog-footer">
            <button
              className="button secondary small"
              onClick={() => void sharePath(`/post/${postId}`, toast)}
            >
              <Link2 size={16} /> Share link
            </button>
            <Link href="/messages" className="text-button">
              Open messages
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}
