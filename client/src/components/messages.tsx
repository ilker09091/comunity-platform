"use client";
import { api, ApiError, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { getLang } from "@/lib/i18n";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  ChevronDown,
  Gamepad2,
  Images,
  ContactRound as Info,
  MoreHorizontal,
  Palette,
  PhoneCall as Phone,
  Search,
  Send,
  ShieldOff,
  MessageSquarePlus as SquarePen,
  Star,
  Trash2,
  UsersRound as Users,
  Video,
  WandSparkles,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { messageSoundsOn, setMessageSounds } from "./app-bridge";
import { BabyBubble, BabySheet } from "./baby";
import { useCalls } from "./calls";
import { ChatCustomize } from "./chat-customize";
import { GameBar, TogetherSheet, type GameKind } from "./chat-extras";
import { CHAT_THEMES, themeAttributes, ThemeStage, ThemeTray, type ChatThemeId } from "./chat-themes";
import { CreateGroup, GroupAvatar, GroupThread, useGroups } from "./group-chat";
import StreakChip,{ FlameIcon } from "./message-streak";
import { NotesTray } from "./notes";
import { useSession, useToast } from "./providers";
import { RecipientPicker } from "./social-controls";
import { Avatar, ConfirmDialog, Dropdown, ErrorState, LoadMore, Modal, SignInPrompt, VerifiedBadge } from "./ui";

import { ChatInfo } from "./chat-info";
import { Composer } from "./composer";
import {
  Conversation,
  Delivery,
  Effect,
  effectFor,
  Folder,
  GROUP_MS,
  Message,
  MessageItem,
  presence,
  preview,
  ScreenEffect,
  SEPARATOR_MS,
  separatorLabel,
  shortTime,
  Ticks,
} from "./message-item";
import {
  ALBUM_MS,
  albumable,
  blankMessage,
  Draft,
  dropMessage,
  HEAD_POLL_MS,
  InfoTab,
  insertMessage,
  LOCAL_PREFIX,
  mergeHead,
  nextLocalId,
  Outgoing,
  patchMessage,
  replyRef,
  ThreadData,
} from "./thread-shared";

/** Messages written without a connection survive a reload and go out once you are back online. */
const outboxKey = (userId: string, peerId: string) => `circle-outbox:${userId}:${peerId}`;
function savedOutbox(userId: string | undefined, peerId: string): Outgoing[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(outboxKey(userId, peerId)) ?? "[]") as Outgoing[];
    return Array.isArray(saved) ? saved.map((o) => ({ ...o, status: "waiting" as const })) : [];
  } catch {
    return [];
  }
}
function saveOutbox(userId: string | undefined, peerId: string, items: Outgoing[]) {
  if (!userId) return;
  try {
    const waiting = items.filter((o) => o.status === "waiting");
    if (waiting.length) localStorage.setItem(outboxKey(userId, peerId), JSON.stringify(waiting));
    else localStorage.removeItem(outboxKey(userId, peerId));
  } catch {
    /* storage unavailable */
  }
}
/** No answer at all (offline, or the server is restarting): worth sending again later. */
const unreachable = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 502;
const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

function Thread({ peer: initialPeer }: { peer: Models["MessagePeerDto"] }) {
  const calls = useCalls();
  const { user } = useSession();
  const status = useQuery({
    queryKey: ["messages", user?.id, "status", initialPeer.id],
    queryFn: ({ signal }) => api("messagesStatus", { params: { id: initialPeer.id }, signal }),
    // Fast enough for a live "typing..." indicator.
    refetchInterval: 2000,
  });
  const unavailable=status.data?.isUnavailable??initialPeer.isUnavailable;
  const nickname = unavailable ? null : (status.data?.nickname ?? null);
  const wallpaperUrl = unavailable ? null : (status.data?.wallpaperUrl ?? null);
  const peer={...initialPeer,isUnavailable:unavailable,isBlocking:status.data?.isBlocking??initialPeer.isBlocking,
    ...(unavailable?{displayName:"Circle user",avatarUrl:null,isVerified:false}: {}),
    ...(nickname?{displayName:nickname}:{})};

  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message|null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>(() => savedOutbox(user?.id, initialPeer.id));
  const [online, setOnline] = useState(isOnline);
  const [info, setInfo] = useState<InfoTab | null>(null);
  const [together, setTogether] = useState(false);
  const [babyOpen, setBabyOpen] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [stickerDock,setStickerDock]=useState<HTMLDivElement|null>(null);
  const [showJump, setShowJump] = useState(false);
  const [effect, setEffect] = useState<Effect | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sending = useRef(0);
  /** Confirmed messages keep the React key of their local copy, so they do not re-animate. */
  const [keyAlias, setKeyAlias] = useState<ReadonlyMap<string, string>>(() => new Map());
  const userId = user?.id;
  const peerId = peer.id;
  const threadKey = ["messages", userId, "thread", peerId];
  const thread = useInfiniteQuery({
    queryKey: threadKey,
    queryFn: ({ pageParam, signal }) =>
      api("messagesList", {
        params: { id: peerId },
        query: { cursor: pageParam, limit: 30 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => (p.hasMore ? (p.nextCursor ?? undefined) : undefined),
  });
  /**
   * Older messages load one page at a time as you scroll up. The distance from the bottom is
   * kept across the insert, so the view stays on the same message instead of jumping to the
   * top (which used to trigger the next load, and the next, all the way to the first message).
   */
  const topSentinel = useRef<HTMLDivElement>(null);
  const restore = useRef<number | null>(null);
  const loadOlder = () => {
    const el = scroller.current;
    if (!el || !thread.hasNextPage || thread.isFetchingNextPage || restore.current !== null) return;
    restore.current = el.scrollHeight - el.scrollTop;
    void thread.fetchNextPage().then((result) => {
      // Nothing was added: forget the saved position.
      if (result.isError) restore.current = null;
    });
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const fromBottom = restore.current;
    if (!el || fromBottom === null || thread.isFetchingNextPage) return;
    restore.current = null;
    el.scrollTop = el.scrollHeight - fromBottom;
  }, [thread.data, thread.isFetchingNextPage]);
  const maybeLoadOlder = () => {
    const el = scroller.current;
    // Only while the person is reading back, never on the first paint at the bottom.
    if (el && el.scrollHeight > el.clientHeight && !pinned.current) loadOlder();
  };
  const onTopVisible = useEffectEvent(maybeLoadOlder);
  const canLoadOlder = !!thread.hasNextPage && !thread.isFetchingNextPage;
  useEffect(() => {
    const node = topSentinel.current;
    const root = scroller.current;
    if (!node || !root || !canLoadOlder) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onTopVisible();
    }, { root, rootMargin: "240px 0px 0px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadOlder]);
  // Live updates: poll only the newest page and fold it into the cache.
  useEffect(() => {
    const key = ["messages", userId, "thread", peerId];
    let stopped = false;
    let busy = false;
    let timer: number | undefined;
    const tick = async () => {
      if (busy || stopped) return;
      window.clearTimeout(timer);
      busy = true;
      try {
        if (document.visibilityState === "visible" && !sending.current && client.getQueryData(key)) {
          const head = await api("messagesList", { params: { id: peerId }, query: { limit: 30 } });
          if (!stopped && !sending.current) {
            const cached = client.getQueryData<ThreadData>(key);
            const known = new Set(cached?.pages[0]?.items.map((m) => m.id));
            // A heart or confetti message that just arrived plays its screen effect.
            const arrived = head.items.find((m) => m.senderId !== userId && !known.has(m.id) && Date.parse(m.createdAt) > mountedAt && effectFor(m.content ?? m.sticker?.emoji));
            const arrivedKind = arrived && effectFor(arrived.content ?? arrived.sticker?.emoji);
            if (arrived && arrivedKind) setEffect({ kind: arrivedKind, key: arrived.id });
            const merged = mergeHead(cached, head);
            if (merged) client.setQueryData(key, merged);
            else void client.refetchQueries({ queryKey: key, exact: true });
          }
        }
      } catch {
        /* The next tick tries again. */
      } finally {
        busy = false;
      }
      if (!stopped) timer = window.setTimeout(tick, HEAD_POLL_MS);
    };
    timer = window.setTimeout(tick, HEAD_POLL_MS);
    const wake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [client, userId, peerId, mountedAt]);
  const confirmed = Array.from(
    new Map((thread.data?.pages.flatMap((p) => p.items) ?? []).map((m) => [m.id, m])).values(),
  ).reverse();
  const deliveries = new Map(outbox.map((o) => [o.message.id, o.status]));
  const messages = outbox.length ? [...confirmed, ...outbox.map((o) => o.message)] : confirmed;
  const latest = messages.at(-1)?.id;
  // Consecutive photos/videos from one person become one album entry.
  const entries: { message: Message; album?: Message[] }[] = [];
  for (const m of messages) {
    const previous = entries.at(-1);
    const tail = previous?.message;
    if (
      previous && tail && albumable(m) && albumable(tail) && tail.senderId === m.senderId && !tail.content && !m.replyTo &&
      Date.parse(m.createdAt) - Date.parse(tail.createdAt) < ALBUM_MS
    ) {
      previous.album = [...(previous.album ?? [tail]), m];
      previous.message = m;
    } else entries.push({ message: m });
  }
  const request = !!status.data?.isRequest;
  const canCall = !voiceActive && !calls.busy && !!status.data?.canSend && !request;
  const awaiting = !!status.data?.awaitingAcceptance;
  const typing = !!status.data?.peerTyping;
  const presenceText = unavailable ? "This account is unavailable" : presence(!!status.data?.peerOnline, status.data?.peerLastActiveAt);
  const subtitle = presenceText ?? peer.username;
  const chatTheme = (status.data?.theme ?? "default") as ChatThemeId;
  /** Telegram-style tray: the chat previews each theme while it is open. */
  const [themeTray, setThemeTray] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<ChatThemeId>("default");
  const openThemeTray = () => {
    setPreviewTheme(chatTheme);
    setThemeTray(true);
  };
  const shownTheme = themeTray ? previewTheme : chatTheme;
  // While trying themes on, show them as they are (a personal wallpaper would hide them).
  const shownWallpaper = themeTray ? null : wallpaperUrl;
  const statusKey = ["messages", userId, "status", peerId];
  const setTheme = (theme: ChatThemeId) => {
    const previous = status.data?.theme ?? null;
    haptic("tap");
    client.setQueryData<Models["MessageStatusDto"]>(statusKey, (d) => d && { ...d, theme: theme === "default" ? null : theme });
    api("messagesSetTheme", { params: { id: peerId }, body: { theme } }).then(
      () => toast(theme === "default" ? "Chat theme removed." : `Theme changed to ${CHAT_THEMES.find((t) => t.id === theme)?.name}.`),
      (e: Error) => {
        client.setQueryData<Models["MessageStatusDto"]>(statusKey, (d) => d && { ...d, theme: previous });
        toast(e.message, true);
      },
    );
  };
  const accept = useMutation({
    mutationFn: () => api("messagesAccept", { params: { id: peer.id } }),
    onSuccess: () => {
      haptic("success");
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const decline = useMutation({
    mutationFn: () => api("messagesDecline", { params: { id: peer.id } }),
    onSuccess: () => {
      toast("Request deleted.");
      void client.invalidateQueries({ queryKey: ["messages"] });
      router.push("/messages");
    },
    onError: (e) => toast(e.message, true),
  });
  const [unsending, setUnsending] = useState<Message[] | null>(null);
  const [sounds, setSounds] = useState(messageSoundsOn);
  const [deletingChat, setDeletingChat] = useState(false);
  /** The inbox row and streak follow what was just sent; the thread itself is updated in place. */
  const refreshAround = () => {
    void client.invalidateQueries({ queryKey: ["messages", userId, "conversations"] });
    void client.invalidateQueries({ queryKey: ["messages", userId, "streak", peerId] });
  };
  const unsend = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api("messagesDelete", { params: { id } });
    },
    onMutate: (ids) => {
      setUnsending(null);
      const previous = client.getQueryData<ThreadData>(threadKey);
      client.setQueryData<ThreadData>(threadKey, (d) => ids.reduce((data, id) => dropMessage(data, id), d));
      return { previous };
    },
    onSuccess: (_data, ids) => {
      toast(ids.length > 1 ? `${ids.length} items unsent.` : "Message unsent.");
      refreshAround();
      void client.invalidateQueries({ queryKey: ["messages", userId, "favorites", peerId] });
    },
    onError: (e, _id, context) => {
      if (context?.previous) client.setQueryData(threadKey, context.previous);
      toast(e.message, true);
    },
  });
  const deleteChat = useMutation({
    mutationFn: () => api("messagesDeleteConversation", { params: { id: peer.id } }),
    onSuccess: () => {
      setDeletingChat(false);
      toast("Chat deleted.");
      client.removeQueries({ queryKey: threadKey });
      void client.invalidateQueries({ queryKey: ["messages"] });
      router.push("/messages");
    },
    onError: (e) => toast(e.message, true),
  });
  const read = useMutation({
    mutationFn: (id: string) => api("messagesRead", { params: { id } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["messages", userId, "conversations"] });
      void client.invalidateQueries({ queryKey: ["messages", userId, "unread"] });
    },
  });
  const markRead = read.mutate;
  const lastAcknowledged=useRef<string|null>(null);
  useEffect(() => {
    // A loaded thread behind another dialog, in a background tab or scrolled away from
    // new messages is not a read receipt. Observe the bubbles within this thread's viewport.
    const pending=thread.data?.pages.flatMap(page=>page.items).filter(message=>message.recipientId===user?.id&&!message.readAt)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))??[];
    if(!pending.length)return;
    const acknowledge = () => {
      if(!status.data||status.data.isRequest||status.data.isUnavailable||document.visibilityState!=='visible'||!document.hasFocus()||document.querySelector('dialog[open]'))return;
      const frame=scroller.current?.getBoundingClientRect();if(!frame)return;
      const visible=pending.find(message=>{
        const node=document.getElementById(`msg-${message.id}`),box=node?.getBoundingClientRect();
        if(!box||Math.min(box.bottom,frame.bottom)-Math.max(box.top,frame.top)<Math.min(box.height*.6,80))return false;
        const top=Math.max(box.top,frame.top),bottom=Math.min(box.bottom,frame.bottom);
        return node!.contains(document.elementFromPoint((Math.max(box.left,frame.left)+Math.min(box.right,frame.right))/2,(top+bottom)/2));
      });
      if(visible&&lastAcknowledged.current!==visible.id){lastAcknowledged.current=visible.id;markRead(visible.id,{onError:()=>{lastAcknowledged.current=null;}});}
    };
    const observer=new IntersectionObserver(acknowledge,{root:scroller.current,threshold:[0,.6,1]});
    for(const message of pending){const node=document.getElementById(`msg-${message.id}`);if(node)observer.observe(node);}
    const dialogs=new MutationObserver(acknowledge);dialogs.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open'],childList:true});
    const frame=requestAnimationFrame(acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    window.addEventListener('focus',acknowledge);
    return () => {observer.disconnect();dialogs.disconnect();cancelAnimationFrame(frame);document.removeEventListener("visibilitychange", acknowledge);window.removeEventListener('focus',acknowledge);};
  }, [thread.data, user?.id, markRead, status.data]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (pinned.current && scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    if (messageList.current) observer.observe(messageList.current);
    // The sticker tray and keyboard resize the chat itself; keep the latest message in view.
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (pinned.current&&scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [latest]);

  /** Sends in order, one request at a time, while the bubble is already on screen. */
  const deliver = (localId: string, draft: Draft) => {
    sending.current += 1;
    const run = async () => {
      try {
        const sent = await api("messagesSend", { params: { id: peerId }, body: draft });
        setKeyAlias((aliases) => new Map(aliases).set(sent.id, localId));
        if (client.getQueryData(threadKey)) client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
        else void client.invalidateQueries({ queryKey: threadKey, exact: true });
        setOutbox((o) => o.filter((x) => x.message.id !== localId));
        refreshAround();
      } catch (e) {
        // No connection: keep it queued (clock icon) and send it when the phone is back online.
        const later = unreachable(e);
        setOutbox((o) => o.map((x) => (x.message.id === localId ? { ...x, status: later ? "waiting" : "failed" } : x)));
        if (!later) {
          toast(e instanceof Error ? e.message : "Message not sent.", true);
          void status.refetch();
        }
      } finally {
        sending.current -= 1;
      }
    };
    sendQueue.current = sendQueue.current.then(run, run);
  };
  const send = (draft: Draft, preview: Partial<Message>, options?: { noReply?: boolean }) => {
    if (!userId) return;
    const id = nextLocalId();
    const reply = options?.noReply ? null : replyTo;
    const message: Message = { ...blankMessage(id, userId, peerId), ...preview, replyTo: reply ? replyRef(reply) : null };
    pinned.current = true;
    setShowJump(false);
    setOutbox((o) => [...o, { message, draft: { ...draft, replyToId: reply?.id }, status: "sending" }]);
    setReplyTo(null);
    deliver(id, { ...draft, replyToId: reply?.id });
    const kind = effectFor(draft.content ?? preview.sticker?.emoji);
    if (kind) setEffect({ kind, key: id });
  };
  const react = (message: Message, emoji: string | null) => {
    if (!userId || message.id.startsWith(LOCAL_PREFIX)) return;
    const previous = message.reactions ?? [];
    const next = [...previous.filter((r) => r.userId !== userId), ...(emoji ? [{ userId, emoji }] : [])];
    client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { reactions: next }));
    (emoji ? api("messagesReact", { params: { id: message.id }, body: { emoji } }) : api("messagesUnreact", { params: { id: message.id } })).catch(
      (e: Error) => {
        client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { reactions: previous }));
        toast(e.message, true);
      },
    );
  };
  const retry = (id: string) => {
    const item = outbox.find((o) => o.message.id === id);
    if (!item) return;
    setOutbox((o) => o.map((x) => (x.message.id === id ? { ...x, status: "sending" } : x)));
    deliver(id, item.draft);
  };
  const discard = (id: string) => setOutbox((o) => o.filter((x) => x.message.id !== id));
  useEffect(() => saveOutbox(userId, peerId, outbox), [userId, peerId, outbox]);
  const resendWaiting = useEffectEvent(() => {
    if (!isOnline()) return;
    const waiting = outbox.filter((o) => o.status === "waiting");
    if (!waiting.length) return;
    setOutbox((o) => o.map((x) => (x.status === "waiting" ? { ...x, status: "sending" } : x)));
    for (const item of waiting) deliver(item.message.id, item.draft);
  });
  useEffect(() => {
    const up = () => {
      setOnline(true);
      resendWaiting();
    };
    const down = () => setOnline(false);
    const visible = () => document.visibilityState === "visible" && resendWaiting();
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    document.addEventListener("visibilitychange", visible);
    // Messages saved before a reload (or a lost connection) go out as soon as possible.
    const first = window.setTimeout(resendWaiting, 600);
    // Some phones never fire "online"; check again now and then while something waits.
    const timer = window.setInterval(resendWaiting, 15_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      document.removeEventListener("visibilitychange", visible);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  const startGame = (kind: GameKind) => {
    setTogether(false);
    haptic("tap");
    api("messagesStartGame", { params: { id: peerId }, body: { kind, lang: getLang() } }).then(
      (sent) => {
        pinned.current = true;
        setShowJump(false);
        client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
        refreshAround();
        void client.invalidateQueries({ queryKey: ["messages", user?.id, "active-games", peerId] });
      },
      (e: Error) => toast(e.message, true),
    );
  };
  const sendGesture = (emoji: string) => {
    setTogether(false);
    send({ content: emoji }, { content: emoji }, { noReply: true });
  };
  const sendAudio = async (audioId: string) => {
    const reply = replyTo;
    const sent = await api("messagesSend", { params: { id: peerId }, body: { audioId, replyToId: reply?.id } });
    pinned.current = true;
    client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
    setReplyTo((current) => (current && current.id === reply?.id ? null : current));
    refreshAround();
  };
  const saveEdit = (message: Message, content: string) => {
    setEditing(null);
    const previous = { content: message.content, editedAt: message.editedAt };
    client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { content, editedAt: new Date().toISOString() }));
    api("messagesEdit", { params: { id: message.id }, body: { content } }).then(
      (saved) => client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, saved)),
      (e: Error) => {
        client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, previous));
        toast(e.message, true);
      },
    );
  };
  const toggleFavorite = (message: Message) => {
    const next = !message.isFavorite;
    haptic("tap");
    client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { isFavorite: next }));
    toast(next ? "Added to favorites." : "Removed from favorites.");
    api(next ? "messagesFavorite" : "messagesUnfavorite", { params: { id: message.id } }).then(
      () => void client.invalidateQueries({ queryKey: ["messages", userId, "favorites", peerId] }),
      (e: Error) => {
        client.setQueryData<ThreadData>(threadKey, (d) => patchMessage(d, message.id, { isFavorite: !next }));
        toast(e.message, true);
      },
    );
  };
  const [contactAction,setContactAction]=useState<"block"|"unblock"|null>(null);
  const contact=useMutation({
    mutationFn:(block:boolean)=>api(block?"followsBlock":"followsUnblock",{params:{id:peer.id}}),
    onSuccess:(_data,blocked)=>{
      setContactAction(null);
      void client.invalidateQueries();
      toast(blocked?"Account blocked.":"Account unblocked. Previous follows have not been restored.");
    },onError:error=>toast(error.message,true)
  });
  const canMessage = !unavailable && (status.data
    ? status.data.canSend
    : !peer.isBlocking && (!peer.isPrivate || peer.isFollowing));
  const flash = (el: HTMLElement) => {
    pinned.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  const jumpTo = async (id: string) => {
    let el = document.getElementById(`msg-${id}`);
    // Load older pages until the message is on screen (favorites can be far up).
    for (let i = 0; !el && i < 20; i++) {
      const pages = client.getQueryData<ThreadData>(threadKey)?.pages;
      if (!pages?.at(-1)?.hasMore) break;
      await thread.fetchNextPage();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      el = document.getElementById(`msg-${id}`);
    }
    if (!el) return toast("That message is no longer in this conversation.");
    flash(el);
  };
  const startReply = (m: Message) => {
    setEditing(null);
    setReplyTo(m);
    textRef.current?.focus({ preventScroll: true });
  };
  const startEdit = (m: Message) => {
    setReplyTo(null);
    setEditing(m);
    textRef.current?.focus({ preventScroll: true });
  };
  const toggleSounds = () => {
    setMessageSounds(!sounds);
    setSounds(!sounds);
  };
  return (
    <section
      className={`dm-thread ${themeTray ? "theming" : ""}`}
      {...themeAttributes(shownTheme, shownWallpaper)}
      aria-label={`Conversation with ${peer.displayName}`}
    >
      <ThemeStage theme={shownTheme} wallpaperUrl={shownWallpaper} />
      <header className="dm-thread-head">
        <Link className="dm-icon dm-back" href="/messages" aria-label="Back to conversations">
          <ArrowLeft size={24} />
        </Link>
        <button type="button" className="dm-thread-person" aria-label={`Chat info: ${peer.displayName}`} onClick={() => setInfo("media")}>
          <span className={`dm-avatar-wrap ${status.data?.peerOnline ? "online" : ""}`}>
            <Avatar user={peer} size={44} />
          </span>
          <span>
            <strong>
              <span className="dm-peer-name">{peer.displayName}</span>
              {peer.isVerified && <VerifiedBadge />}
            </strong>
            <small className={typing ? "typing" : ""} aria-live="polite">
              {typing ? (
                <>
                  <span className="dm-typing-dots" aria-hidden="true"><i /><i /><i /></span>
                  typing
                </>
              ) : (
                subtitle
              )}
            </small>
          </span>
        </button>
        <StreakChip peer={peer} />
        <div className="dm-thread-actions">
        <button type="button" className="dm-icon" aria-label="Start voice call" title="Voice call" disabled={!canCall} onClick={()=>calls.start(peer,"audio")}><Phone size={21}/></button>
        <button type="button" className="dm-icon" aria-label="Start video call" disabled={!canCall} onClick={()=>calls.start(peer,"video")}><Video size={22}/></button>
        <Dropdown label="Chat options" className="dm-chat-menu" summaryClassName="dm-icon" summary={<MoreHorizontal size={22} />}>
          <button type="button" onClick={() => setInfo("media")}>
            <Images size={16} /> Media and links
          </button>
          <button type="button" onClick={() => setInfo("favorites")}>
            <Star size={16} /> Favorite messages
          </button>
          {!unavailable && (
            <button type="button" onClick={openThemeTray}>
              <Palette size={16} /> Chat theme
            </button>
          )}
          {!unavailable && (
            <button type="button" onClick={() => setCustomize(true)}>
              <WandSparkles size={16} /> Nickname, wallpaper & sound
            </button>
          )}
          {canMessage && !request && (
            <button type="button" onClick={() => setTogether(true)}>
              <Gamepad2 size={16} /> Play a game
            </button>
          )}
          {!unavailable&&<Link href={`/profile/${peer.username}`}>
            <Info size={16} /> View profile
          </Link>}
          <button type="button" className={peer.isBlocking?"":"danger-text"} onClick={()=>setContactAction(peer.isBlocking?"unblock":"block")}>
            {peer.isBlocking?<ShieldOff size={16}/>:<Ban size={16}/>} {peer.isBlocking?"Unblock account":"Block account"}
          </button>
          <button type="button" onClick={toggleSounds}>
            {sounds ? <BellOff size={16} /> : <Bell size={16} />} {sounds ? "Mute message sounds" : "Turn on message sounds"}
          </button>
          <button type="button" className="danger-text" disabled={!messages.length} onClick={() => setDeletingChat(true)}>
            <Trash2 size={16} /> Delete chat
          </button>
        </Dropdown>
        </div>
      </header>
      {!unavailable && <GameBar peer={peer} onRematch={canMessage ? startGame : undefined} />}
      {customize && (
        <ChatCustomize
          peer={initialPeer}
          nickname={nickname}
          wallpaperUrl={wallpaperUrl}
          themeName={CHAT_THEMES.find((t) => t.id === chatTheme)?.name ?? "Classic"}
          themeId={chatTheme}
          onTheme={() => {
            setCustomize(false);
            openThemeTray();
          }}
          onClose={() => setCustomize(false)}
        />
      )}
      {together && (
        <TogetherSheet
          peer={peer}
          canPlay={canMessage && !request && !awaiting}
          onGesture={sendGesture}
          onGame={startGame}
          onBaby={() => { setTogether(false); setBabyOpen(true); }}
          onClose={() => setTogether(false)}
        />
      )}
      {babyOpen && (
        <BabySheet
          peer={initialPeer}
          onRequested={(sent) => {
            pinned.current = true;
            client.setQueryData<ThreadData>(threadKey, (d) => insertMessage(d, sent));
            refreshAround();
            setBabyOpen(false);
          }}
          onClose={() => setBabyOpen(false)}
        />
      )}
      {info && (
        <ChatInfo
          peer={peer}
          initialTab={info}
          presenceText={presenceText}
          canCall={canCall}
          sounds={sounds}
          onToggleSounds={toggleSounds}
          themeId={chatTheme}
          themeName={CHAT_THEMES.find((t) => t.id === chatTheme)?.name ?? "Classic"}
          onTheme={unavailable ? undefined : () => { setInfo(null); openThemeTray(); }}
          onBaby={canMessage && !request ? () => { setInfo(null); setBabyOpen(true); } : undefined}
          onBlock={() => { setInfo(null); setContactAction(peer.isBlocking ? "unblock" : "block"); }}
          onDelete={messages.length ? () => { setInfo(null); setDeletingChat(true); } : undefined}
          onCustomize={unavailable ? undefined : () => { setInfo(null); setCustomize(true); }}
          onTogether={canMessage && !request ? () => { setInfo(null); setTogether(true); } : undefined}
          onCall={(kind) => {
            setInfo(null);
            calls.start(peer, kind);
          }}
          onJump={(id) => {
            setInfo(null);
            requestAnimationFrame(() => void jumpTo(id));
          }}
          onClose={() => setInfo(null)}
        />
      )}
      {contactAction&&<ConfirmDialog className="ig-block-dialog" title={contactAction==="block"?"Block this account?":"Unblock this account?"}
        description={contactAction==="block"?"You won't be able to message or call each other. Your previous messages will stay in this chat. Follows are removed; their likes and comments on your posts are removed. They won't be notified.":"You can contact each other again, subject to account privacy. Previous follows, likes and comments are not restored."}
        confirmLabel={contactAction==="block"?"Block":"Unblock"} tone={contactAction==="block"?"danger":"primary"}
        pending={contact.isPending} onClose={()=>setContactAction(null)} onConfirm={()=>contact.mutate(contactAction==="block")}/>}
      {unsending && (
        <ConfirmDialog
          title={unsending.length > 1 ? `Unsend ${unsending.length} items?` : "Unsend message?"}
          description="It will be removed for everyone in this chat. This can't be undone."
          confirmLabel="Unsend"
          pending={unsend.isPending}
          onConfirm={() => unsend.mutate(unsending.map((m) => m.id))}
          onClose={() => setUnsending(null)}
        />
      )}
      {deletingChat && (
        <ConfirmDialog
          title="Delete this chat?"
          description={`All messages, photos and videos with ${peer.displayName} will be permanently deleted for both of you.`}
          confirmLabel="Delete chat"
          pending={deleteChat.isPending}
          onConfirm={() => deleteChat.mutate()}
          onClose={() => setDeletingChat(false)}
        />
      )}
      <div
        className="dm-scroll"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          pinned.current = distance < 80;
          // Reached the top by flinging: start the next page right away.
          if (el.scrollTop < 120 && !pinned.current) maybeLoadOlder();
          // Only re-render when crossing the threshold, never on every scroll event.
          const far = distance > 320;
          if (far !== showJump) setShowJump(far);
        }}
      >
        {!thread.hasNextPage && !thread.isPending && (
          <div className="dm-intro">
            <Avatar user={peer} size={96} />
            <strong>
              {peer.displayName}
              {peer.isVerified && <VerifiedBadge />}
            </strong>
            <span>{peer.username} · Circle</span>
            {!unavailable&&<Link className="dm-button secondary" href={`/profile/${peer.username}`}>
              View profile
            </Link>}
          </div>
        )}
        {thread.hasNextPage && (
          <div className="dm-older" ref={topSentinel} role="status" aria-live="polite">
            {thread.isFetchingNextPage ? (
              <span className="dm-older-spinner" aria-label="Loading earlier messages" />
            ) : (
              <button type="button" className="dm-older-button" onClick={loadOlder}>
                Load earlier messages
              </button>
            )}
          </div>
        )}
        {thread.isPending && (
          <ol className="dm-messages dm-messages-skeleton" aria-busy="true" aria-label="Loading messages">
            {[62, 38, 74, 46, 58].map((width, i) => (
              <li key={i} className={`dm-skeleton-bubble ${i % 2 ? "own" : ""}`} style={{ width: `${width}%` }} />
            ))}
          </ol>
        )}
        {thread.error && <ErrorState error={thread.error} retry={() => void thread.refetch()} />}
        <ol className="dm-messages" ref={messageList}>
          {entries.map((entry, i) => {
            const m = entry.message;
            const head = entry.album?.[0] ?? m;
            const prevEntry = entries[i - 1];
            const prev = prevEntry?.message;
            const next = entries[i + 1] && (entries[i + 1].album?.[0] ?? entries[i + 1].message);
            const at = Date.parse(head.createdAt);
            const separated =
              !prev ||
              at - Date.parse(prev.createdAt) > SEPARATOR_MS ||
              new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const nextSeparated =
              !next ||
              Date.parse(next.createdAt) - at > SEPARATOR_MS ||
              new Date(next.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const first =
              separated || prev.senderId !== m.senderId || at - Date.parse(prev.createdAt) > GROUP_MS;
            const last =
              nextSeparated || next.senderId !== m.senderId || Date.parse(next.createdAt) - at > GROUP_MS;
            const states = (entry.album ?? [m]).map((x) => deliveries.get(x.id));
            const delivery: Delivery | undefined = states.includes("failed") ? "failed" : states.includes("sending") ? "sending" : states.includes("waiting") ? "waiting" : undefined;
            const failedIds = (entry.album ?? [m]).filter((x) => deliveries.get(x.id) === "failed").map((x) => x.id);
            const key = keyAlias.get(head.id) ?? head.id;
            return (
              <Fragment key={key}>
                {separated && (
                  <li className="dm-separator" role="separator">
                    <span>{separatorLabel(m.createdAt)}</span>
                  </li>
                )}
                <MessageItem
                  message={m}
                  own={m.senderId === user?.id}
                  peer={peer}
                  first={first}
                  last={last}
                  album={entry.album}
                  enter={at > mountedAt}
                  delivery={delivery}
                  onRetry={delivery ? () => failedIds.forEach(retry) : undefined}
                  onRematch={canMessage ? startGame : undefined}
                  onBaby={() => setBabyOpen(true)}
                  onDiscard={delivery ? () => failedIds.forEach(discard) : undefined}
                  onReply={startReply}
                  onJump={jumpTo}
                  onUnsend={(message, album) => setUnsending(album ?? [message])}
                  onEdit={startEdit}
                  onFavorite={toggleFavorite}
                  onReact={react}
                  onCall={canCall ? (kind) => calls.start(peer, kind) : undefined}
                />
              </Fragment>
            );
          })}
          {typing && (
            <li className="dm-message first last dm-typing-row enter" aria-label={`${peer.displayName} is typing`}>
              <span className="dm-message-avatar" aria-hidden="true">
                <Avatar user={peer} size={28} />
              </span>
              <span className="dm-bubble dm-typing" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </li>
          )}
        </ol>
      </div>
      <button
        type="button"
        className={`dm-jump-latest ${showJump ? "show" : ""}`}
        aria-label="Jump to latest message"
        tabIndex={showJump ? undefined : -1}
        aria-hidden={!showJump || undefined}
        onClick={() => {
          const el = scroller.current;
          pinned.current = true;
          setShowJump(false);
          el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }}
      >
        <ChevronDown size={22} />
      </button>
      {!online && (
        <div className="dm-offline" role="status">
          <WifiOff size={15} /> No connection. Messages will send when you&apos;re back online.
        </div>
      )}
      {unavailable ? <div className="dm-blocked-state" role="status">
        <Ban size={22}/><strong>{peer.isBlocking?"You blocked this account":"You can't message this account"}</strong>
        <p>Your previous messages are still here. New messages and calls are unavailable.</p>
        {peer.isBlocking&&<button type="button" className="button secondary small" onClick={()=>setContactAction("unblock")}>Unblock</button>}
      </div> : request ? (
        <div className="dm-request">
          <strong>Accept message request from {peer.username}?</strong>
          <p>
            If you accept, {peer.displayName} can keep messaging you and will see when you&apos;ve
            read their messages.
          </p>
          <div className="dm-request-actions">
            <button
              type="button"
              className="dm-button secondary danger"
              disabled={decline.isPending || accept.isPending}
              onClick={() => decline.mutate()}
            >
              Delete
            </button>
            <button
              type="button"
              className="dm-button"
              disabled={decline.isPending || accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? "Accepting..." : "Accept"}
            </button>
          </div>
        </div>
      ) : (
        <Composer
          peer={peer}
          canMessage={canMessage}
          awaiting={awaiting}
          callsBusy={calls.busy}
          fieldRef={textRef}
          stickerDock={stickerDock}
          voiceActive={voiceActive}
          onVoiceActiveChange={setVoiceActive}
          replyTo={replyTo}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onJumpTo={(id) => void jumpTo(id)}
          onSaveEdit={saveEdit}
          onSend={send}
          onSendAudio={sendAudio}
          onTogether={() => setTogether(true)}
        />
      )}
      <div className="dm-sticker-dock" ref={setStickerDock}/>
      {themeTray && (
        <ThemeTray
          current={chatTheme}
          value={previewTheme}
          onChange={setPreviewTheme}
          onApply={(theme) => {
            setThemeTray(false);
            setTheme(theme);
          }}
          onCancel={() => setThemeTray(false)}
        />
      )}
      {!unavailable && !themeTray && <BabyBubble peer={peer} onOpen={() => setBabyOpen(true)} />}
      {effect && <ScreenEffect key={effect.key} effect={effect} onDone={() => setEffect(null)} />}
    </section>
  );
}

function ConversationRow({
  conversation: c,
  active,
  own,
}: {
  conversation: Conversation;
  active: boolean;
  own: boolean;
}) {
  const unread = c.unreadCount > 0;
  return (
    <li>
      <Link
        className={`dm-row ${active ? "active" : ""} ${unread ? "unread" : ""}`}
        href={`/messages?to=${encodeURIComponent(c.user.username)}`}
        aria-current={active ? "page" : undefined}
        title={c.nickname ?? c.user.displayName}
      >
        <span className={`dm-avatar-wrap ${c.online ? "online" : ""}`}>
          <Avatar user={c.user} size={56} />
          {c.online && <span className="sr-only">Active now</span>}
        </span>
        <span className="dm-row-copy">
          <strong>
            {c.nickname ?? c.user.displayName}
            {!!c.streakDays&&<span className={`dm-streak-badge ${c.streakFading?"fading":""}`} aria-label={`${c.streakDays} day streak${c.streakFading?", about to end":""}`}><FlameIcon size={14} dim={c.streakFading}/>{c.streakDays}{c.streakFading&&<span aria-hidden="true">⌛</span>}</span>}
            {c.user.isVerified && <VerifiedBadge />}
          </strong>
          <span>
            {own && !c.lastMessage.call && <Ticks message={c.lastMessage} />}
            <span className="dm-row-preview">{preview(c.lastMessage, own)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={c.lastMessage.createdAt}>{shortTime(c.lastMessage.createdAt)}</time>
          </span>
        </span>
        {unread && (
          <span className="dm-unread-dot">
            <span className="sr-only">{c.unreadCount} unread</span>
          </span>
        )}
      </Link>
    </li>
  );
}

function useConversations(folder: Folder, enabled: boolean) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: ["messages", user?.id, "conversations", folder],
    queryFn: ({ pageParam, signal }) =>
      api("messagesConversations", {
        query: { cursor: pageParam, limit: 20, folder },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => (p.hasMore ? (p.nextCursor ?? undefined) : undefined),
    enabled,
    refetchInterval: 10000,
  });
}

export default function Messages() {
  const { user, loading } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const to = params.get("to") ?? "";
  const groupId=params.get('group')??'';
  const [creating, setCreating] = useState(false);
  const [creatingGroup,setCreatingGroup]=useState(false);
  const groups=useGroups();
  const [folder, setFolder] = useState<Folder>("primary");
  const [search, setSearch] = useState("");
  const primary = useConversations("primary", !!user);
  const requests = useConversations("requests", !!user);
  const conversations = folder === "primary" ? primary : requests;
  const peer = useQuery({
    queryKey: ["message-peer", user?.id, to],
    queryFn: ({ signal }) => api("messagesPeer", { params: { username: to }, signal }),
    enabled: !!to && !!user,
    refetchInterval: 5000,
  });
  // Mobile: the inbox is pinned between the header and the bottom navigation, so the page
  // itself must not keep a scroll offset carried over from the previous page.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dm-page");
    window.scrollTo(0, 0);
    return () => root.classList.remove("dm-page");
  }, []);
  // Mobile: an open chat covers the whole screen (header and bottom navigation included) and
  // follows the visual viewport, so the composer stays above the on-screen keyboard.
  useEffect(() => {
    if (!to&&!groupId) return;
    const root = document.documentElement;
    root.classList.add("dm-chat-open");
    const viewport = window.visualViewport;
    const resize = () => {
      root.style.setProperty("--dm-viewport", `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--dm-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      root.classList.remove("dm-chat-open");
      root.style.removeProperty("--dm-viewport");
      root.style.removeProperty("--dm-viewport-top");
    };
  }, [to,groupId]);
  if (loading) return <p role="status">Loading...</p>;
  if (!user)
    return (
      <SignInPrompt
        title="Your conversations"
        description="Sign in to send messages and videos."
      />
    );
  const term = search.trim().toLowerCase();
  const items = (conversations.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (c) =>
      !term ||
      c.user.username.toLowerCase().includes(term) ||
      c.user.displayName.toLowerCase().includes(term),
  );
  const requestCount = requests.data?.pages.flatMap((p) => p.items).length ?? 0;
  const groupItems=folder==='primary'?(groups.data?.pages.flatMap(page=>page.items)??[]).filter(group=>!term||group.name.toLowerCase().includes(term)):[];
  return (
    <div className={`dm-shell card ${to||groupId ? "has-chat" : ""}`}>
      <h1 className="sr-only">Messages</h1>
      <aside className="dm-sidebar" aria-label="Conversations">
        <header className="dm-sidebar-head">
          <strong>{user.username}</strong>
          <div className="dm-inbox-actions">
          <button type="button" className="dm-icon" aria-label="New group chat" title="New group chat" onClick={()=>setCreatingGroup(true)}><Users size={21}/></button>
          <button
            type="button"
            className="dm-icon dm-new-message"
            aria-label="New message"
            title="New message"
            onClick={() => setCreating(true)}
          >
            <SquarePen size={21} />
          </button>
          </div>
        </header>
        <label className="dm-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search conversations"
            placeholder="Search"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <NotesTray />
        <div className="dm-tabs" role="tablist" aria-label="Conversation folders">
          {(["primary", "requests"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={folder === f}
              className={folder === f ? "active" : ""}
              onClick={() => setFolder(f)}
            >
              {f === "primary" ? "Primary" : "Requests"}
              {f === "requests" && requestCount > 0 && (
                <span className="dm-tab-count">
                  {requestCount}
                  {requests.hasNextPage ? "+" : ""}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="dm-list-scroll">
          {conversations.isPending && (
            <p className="dm-status" role="status">
              Loading conversations...
            </p>
          )}
          {conversations.error && (
            <ErrorState
              error={conversations.error}
              retry={() => void conversations.refetch()}
            />
          )}
          <ul className="dm-list">
            {groupItems.map(group=><li key={group.id}><Link href={`/messages?group=${group.id}`} className={`dm-row dm-group-row ${groupId===group.id?'active':''}`} aria-current={groupId===group.id?'page':undefined}><GroupAvatar group={group}/><span className="dm-row-copy"><strong>{group.name}{group.muted&&<BellOff size={13} className="grp-muted-icon" aria-label="Muted"/>}</strong><span className="dm-row-preview">{group.lastSenderName&&<b className="grp-row-sender">{group.lastSenderName}: </b>}{group.lastMessage??`${group.memberCount} members`}</span></span>{group.unreadCount>0&&<span className={`group-unread ${group.muted?'muted':''}`} aria-label={`${group.unreadCount} unread`}>{group.unreadCount}</span>}</Link></li>)}
            {items.map((c) => (
              <ConversationRow
                key={c.user.id}
                conversation={c}
                active={c.user.username === to}
                own={c.lastMessage.senderId === user.id}
              />
            ))}
          </ul>
          {!conversations.isPending && !conversations.error && !items.length && !groupItems.length && (
            <p className="dm-list-empty">
              {term
                ? "No conversations match your search."
                : folder === "requests"
                  ? "No message requests. Messages from people you don't follow appear here."
                  : "No messages yet. Start a conversation to say hello."}
            </p>
          )}
          <LoadMore
            hasMore={conversations.hasNextPage}
            pending={conversations.isFetchingNextPage}
            onClick={() => void conversations.fetchNextPage()}
          />
          {folder==='primary'&&<LoadMore hasMore={groups.hasNextPage} pending={groups.isFetchingNextPage} onClick={()=>void groups.fetchNextPage()}/>}
        </div>
      </aside>
      <div className="dm-main">
        {groupId?<GroupThread key={groupId} id={groupId} renderMessage={(message,actions)=><MessageItem message={message} peer={{...message.sender,isUnavailable:!message.sender.username,isBlocking:false,isFollowing:false}} {...actions}/>}/>:to ? (
          peer.isPending ? (
            <p className="dm-status" role="status">
              Loading conversation...
            </p>
          ) : peer.error ? (
            <div className="dm-empty">
              <ErrorState error={peer.error} retry={() => void peer.refetch()} />
              <Link className="dm-button secondary" href="/messages">
                Back to messages
              </Link>
            </div>
          ) : (
            peer.data && (
              <Thread key={peer.data.id} peer={peer.data} />
            )
          )
        ) : (
          <div className="dm-empty">
            <span className="dm-empty-icon">
              <Send size={44} strokeWidth={1.4} />
            </span>
            <h2>Your messages</h2>
            <p>Send private messages, videos and Reels to a friend.</p>
            <button type="button" className="dm-button" onClick={() => setCreating(true)}>
              Send message
            </button>
          </div>
        )}
      </div>
      {creatingGroup&&<CreateGroup onClose={()=>setCreatingGroup(false)}/>}
      {creating && (
        <Modal title="New message" onClose={() => setCreating(false)}>
          <RecipientPicker
            onSelect={(p) => {
              setCreating(false);
              router.push(`/messages?to=${encodeURIComponent(p.username)}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
