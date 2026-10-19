"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Send, Link2, CirclePlus, Check, Search, Share2 } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { api, type User } from "@/lib/api/client";
import { sharePath } from "@/lib/use-post-engagement";
import { fetchMessageUnread } from "@/lib/message-delivery";
import { useSession, useToast } from "./providers";
import { Avatar, EmptyState, ErrorState, LoadMore, Modal } from "./ui";

export function useMessageUnread() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["messages", user?.id, "unread"],
    queryFn: ({ signal }) => fetchMessageUnread({ signal }),
    enabled: !!user,
    refetchInterval: 5000,
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
    : (recent.data?.items.filter(c=>!c.isUnavailable).map((c) => c.user) ?? []);
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

/**
 * TikTok-style "Send to" sheet: search, a grid of people to tick (several at once), an optional
 * message, and quick share actions (story, copy link, system share) when nobody is selected.
 */
function SendSheet({
  postId,
  story,
  reel,
  onClose,
}: {
  postId: string;
  story: boolean;
  reel:boolean;
  onClose: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<User[]>([]);
  const [note, setNote] = useState("");
  const [expanded,setExpanded]=useState(false);
  /** Reels: Instagram-style sheet that follows the finger on its handle (down closes, up expands). */
  const handle=useRef<HTMLButtonElement>(null);
  const drag=useRef<{y:number;id:number;moved:boolean}|null>(null);
  const [dragY,setDragY]=useState(0);
  useEffect(()=>{
    const dialog=handle.current?.closest('dialog');
    if(!dialog)return;
    dialog.style.setProperty('--sheet-drag',`${Math.max(0,dragY)}px`);
    dialog.classList.toggle('dragging',dragY!==0);
  },[dragY]);
  const following=useQuery({
    queryKey:['share-following',user?.id],
    queryFn:({signal})=>api('followsFollowing',{params:{id:user!.id},query:{limit:24},signal}),
    enabled:!!user,
  });
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const recent = useQuery({
    queryKey: ["messages", user?.id, "recent"],
    queryFn: ({ signal }) => api("messagesConversations", { query: { limit: 20 }, signal }),
    enabled: !!user,
  });
  const results = useQuery({
    queryKey: ["message-recipients", user?.id, term, "sheet"],
    queryFn: ({ signal }) => api("searchUsers", { query: { q: term, limit: 24 }, signal }),
    enabled: !!user && !!term,
  });
  const people = (term ? (results.data?.items ?? []) : [...new Map([
    ...(recent.data?.items.filter(c=>!c.isUnavailable).map(c=>c.user)??[]),...(following.data?.items??[])
  ].map(person=>[person.id,person])).values()]).filter(
    (p) => p.id !== user?.id,
  );
  // Keep picked people visible even when a search hides them.
  const shown = [...selected.filter((p) => !people.some((x) => x.id === p.id)), ...people];
  const pending = term ? results.isFetching : recent.isFetching;
  const toggle = (person: User) => {
    haptic("tap");
    setSelected((list) => (list.some((p) => p.id === person.id) ? list.filter((p) => p.id !== person.id) : [...list, person]));
  };
  const send = useMutation({
    mutationFn: async () => {
      const content = note.trim() || undefined;
      const outcomes = await Promise.allSettled(
        selected.map((r) => api("messagesSend", { params: { id: r.id }, body: { postId, content } })),
      );
      const failed = outcomes.flatMap((o, i) => (o.status === "rejected" ? [{ who: selected[i], error: o.reason as Error }] : []));
      if (failed.length === selected.length) throw failed[0].error;
      return { sent: selected.length - failed.length, failed };
    },
    onSuccess: ({ sent, failed }) => {
      haptic("success");
      toast(
        failed.length
          ? `Sent to ${sent}. Couldn't send to ${failed.map((f) => f.who.username).join(", ")}.`
          : sent === 1
            ? `Sent to ${selected[0].username}.`
            : `Sent to ${sent} people.`,
        failed.length > 0,
      );
      void client.invalidateQueries({ queryKey: ["messages"] });
      onClose();
    },
    onError: (e) => toast(e.message, true),
  });
  const addStory = useMutation({
    mutationFn: () => api("storiesCreate", { body: { postId } }),
    onSuccess: () => {
      haptic("success");
      toast("Added to your story for 24 hours.");
      void client.invalidateQueries({ queryKey: ["stories"] });
      onClose();
    },
    onError: (e) => toast(e.message, true),
  });
  const link = () => `${window.location.origin}/post/${postId}`;
  const busy = send.isPending || addStory.isPending;
  return (
    <Modal title={reel?'Share Reel':'Send to'} onClose={onClose} guardClose={() => !busy} className={`send-sheet ${reel?'reel-share-sheet':''} ${expanded?'expanded':''}`}>
      <button ref={handle} type="button" className="share-sheet-handle" aria-label={expanded?'Collapse share sheet':'Expand share sheet'} aria-expanded={expanded}
        onPointerDown={e=>{drag.current={y:e.clientY,id:e.pointerId,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{const start=drag.current;if(!start||start.id!==e.pointerId)return;const dy=e.clientY-start.y;if(Math.abs(dy)>6)start.moved=true;setDragY(dy);}}
        onPointerUp={e=>{const start=drag.current;if(!start||start.id!==e.pointerId)return;const dy=e.clientY-start.y;setDragY(0);
          if(dy>90){if(expanded)setExpanded(false);else if(!busy)onClose();}else if(dy<-40)setExpanded(true);}}
        onPointerCancel={()=>{drag.current=null;setDragY(0);}}
        onClick={()=>{const moved=drag.current?.moved;drag.current=null;if(!moved)setExpanded(value=>!value);}}><span/></button>
      <label className="send-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="Search recipients"
          placeholder="Search"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={()=>setExpanded(true)}
        />
      </label>
      <div className="send-grid" role="listbox" aria-label="People" aria-multiselectable="true">
        {shown.map((person) => {
          const on = selected.some((p) => p.id === person.id);
          return (
            <button
              type="button"
              key={person.id}
              role="option"
              aria-selected={on}
              className={`send-person ${on ? "on" : ""}`}
              disabled={busy}
              aria-label={`Send to ${person.displayName}`}
              onClick={() => toggle(person)}
            >
              <span className="send-avatar">
                <Avatar user={person} size={72} />
                {on && (
                  <span className="send-check" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="send-name">{person.displayName}</span>
            </button>
          );
        })}
        {pending && !shown.length && <p className="send-hint">Loading people...</p>}
        {!pending && !shown.length && (
          <p className="send-hint">{term ? "No people found. Try a different name." : "Search for someone to send this to."}</p>
        )}
      </div>
      {results.error&&term&&<ErrorState error={results.error} retry={()=>void results.refetch()}/>}
      {selected.length > 0 ? (
        <form
          className="send-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) send.mutate();
          }}
        >
          <input
            aria-label="Add a message"
            placeholder="Write a message..."
            maxLength={1500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="send-button" disabled={busy}>
            {send.isPending ? "Sending..." : selected.length > 1 ? `Send separately (${selected.length})` : "Send"}
          </button>
        </form>
      ) : (
        <div className="send-actions">
          {story && (
            <button type="button" disabled={busy} onClick={() => addStory.mutate()} aria-label="Add to your story">
              <span className="send-action-icon story">
                <CirclePlus size={22} />
              </span>
              <span>{addStory.isPending ? "Adding..." : "Add to story"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(link()).then(
                () => toast("Link copied."),
                () => toast("Unable to copy the link.", true),
              )
            }
          >
            <span className="send-action-icon">
              <Link2 size={22} />
            </span>
            <span>Copy link</span>
          </button>
          <button type="button" onClick={() => void sharePath(`/post/${postId}`, toast)}>
            <span className="send-action-icon">
              <Share2 size={21} />
            </span>
            <span>Share</span>
          </button>
          <Link href="/messages" className="send-action-link" onClick={onClose}>
            <span className="send-action-icon">
              <Send size={20} />
            </span>
            <span>Messages</span>
          </Link>
        </div>
      )}
    </Modal>
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
  return (
    <>
      <button
        type="button"
        className={reel ? "reel-action share" : "action"}
        aria-label="Send to a user"
        onClick={() => (user ? setOpen(true) : toast("Sign in to send videos and posts."))}
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
      {open && <SendSheet postId={postId} story={story} reel={reel} onClose={() => setOpen(false)} />}
    </>
  );
}
