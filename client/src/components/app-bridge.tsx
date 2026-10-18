"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Download, X } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import { Avatar } from "./ui";

type Notice = { key: string; user: Models["UserSummaryDto"]; body: string; url: string };

function preview(message: Models["DirectMessageDto"]) {
  if (message.noteReply) return `Replied to your note: ${message.content ?? ""}`;
  if (message.storyReply) return `Replied to your story: ${message.content ?? ""}`;
  if (message.content) return message.content;
  if (message.viewOnce) return "Sent a view once photo";
  if (message.media) return message.media.type === "IMAGE" ? "Sent a photo" : "Sent a video";
  if (message.post) return "Shared a post";
  return "Sent you a message";
}

/**
 * Instagram-style in-app banner for a new message: slides down from the top with the sender's
 * picture, name and text. Tap opens the chat, swipe up dismisses, it leaves by itself after 5 s.
 */
function MessageNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const router = useRouter();
  const start = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [notice.key, onClose]);
  return (
    <div
      className="message-notice"
      role="alert"
      style={offset ? { transform: `translate(-50%, ${offset}px)` } : undefined}
      onPointerDown={(e) => {
        start.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (start.current !== null) setOffset(Math.min(0, e.clientY - start.current));
      }}
      onPointerUp={() => {
        const dragged = offset;
        start.current = null;
        setOffset(0);
        if (dragged < -30) return onClose();
        if (dragged > -6) {
          onClose();
          router.push(notice.url);
        }
      }}
      onPointerCancel={() => {
        start.current = null;
        setOffset(0);
      }}
    >
      <Avatar user={notice.user} size={42} />
      <span className="message-notice-copy">
        <strong>
          {notice.user.username} <small>now</small>
        </strong>
        <span>{notice.body}</span>
      </span>
      <button
        type="button"
        className="message-notice-close"
        aria-label="Dismiss"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export const APK_URL = "/downloads/circle.apk";
const SOUND_KEY = "circle:message-sounds";
const NOTIFY_DISMISSED = "circle:notify-dismissed";
const APP_DISMISSED = "circle:app-banner-dismissed";
const IN_APP = "circle:in-android-app";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
};
/** Dismissed less than a week ago. */
const snoozed = (key: string) => Number(read(key) ?? 0) > Date.now() - 7 * 24 * 3600_000;

export const messageSoundsOn = () => read(SOUND_KEY) !== "off";
export const setMessageSounds = (on: boolean) => write(SOUND_KEY, on ? null : "off");

let audio: AudioContext | null = null;
/** A short two-note "ping", generated (no sound file to download). */
export function playMessageSound() {
  if (typeof window === "undefined" || !messageSoundsOn()) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    /* audio not available */
  }
}

const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function base64UrlToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Subscribes this browser to Web Push and links it to the signed-in account. */
async function ensureSubscription() {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await api("pushKey");
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
  }
  const json = subscription.toJSON();
  await api("pushSubscribe", {
    body: { endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  });
  return registration;
}

/** Asks for permission, subscribes, and confirms right away with a notification. */
export async function enableNotifications(): Promise<"granted" | "denied" | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const registration = await ensureSubscription();
  await registration.showNotification("Notifications are on", {
    body: "You'll get a notification when someone messages you.",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: "circle-welcome",
  });
  playMessageSound();
  return "granted";
}

const isAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * Global glue for app-like behaviour: service worker + push, message sounds, and the
 * "turn on notifications" / "get the Android app" banners.
 */
export default function AppBridge() {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [banner, setBanner] = useState<"notify" | "app" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const previous = useRef<number | null>(null);
  const lastUser = useRef<string | null>(null);

  // Service worker (push + notification clicks). Also remembers when we run inside the Android app.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("source") === "android-app" || document.referrer.startsWith("android-app://"))
      write(IN_APP, "1");
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  // Keep this device linked to whoever is signed in; forget it after signing out.
  useEffect(() => {
    if (!pushSupported()) return;
    const id = user?.id ?? null;
    if (id && Notification.permission === "granted") void ensureSubscription().catch(() => undefined);
    if (!id && lastUser.current)
      void navigator.serviceWorker.ready
        .then((r) => r.pushManager.getSubscription())
        .then((s) => s?.unsubscribe())
        .catch(() => undefined);
    lastUser.current = id;
  }, [user?.id]);

  // Messages that arrive while the app is visible: the service worker hands them to us.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; title?: string; body?: string; url?: string } | undefined;
      if (data?.type !== "circle:new-message") return;
      // Refreshing the unread count brings up the in-app banner (below).
      void client.invalidateQueries({ queryKey: ["messages"] });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [client, toast]);

  // Sound when the unread count goes up (works with or without push).
  const unread = useQuery({
    queryKey: ["messages", user?.id, "unread"],
    queryFn: ({ signal }) => api("messagesUnread", { signal }),
    enabled: !!user,
    refetchInterval: 8000,
  });
  const count = unread.data?.count;
  const me = user?.id;
  useEffect(() => {
    if (count === undefined) return;
    const before = previous.current;
    previous.current = count;
    if (before === null || count <= before) return;
    playMessageSound();
    // Show who wrote, unless a messages screen is open (it shows the message already).
    if (window.location.pathname.startsWith("/messages")) return;
    void api("messagesConversations", { query: { limit: 1 } })
      .then((page) => {
        const c = page.items[0];
        if (!c || c.lastMessage.senderId === me) return;
        haptic("tap");
        setNotice({
          key: c.lastMessage.id,
          user: c.user,
          body: preview(c.lastMessage),
          url: `/messages?to=${encodeURIComponent(c.user.username)}`,
        });
      })
      .catch(() => undefined);
  }, [count, me]);
  const closeNotice = useCallback(() => setNotice(null), []);

  // Which banner, if any: the Android app first (it brings its own notifications), then push.
  // Shown shortly after the page settles rather than over the first paint.
  const signedIn = !!user;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!signedIn) return setBanner(null);
      const inApp = read(IN_APP) === "1" || window.matchMedia("(display-mode: standalone)").matches;
      if (isAndroid() && !inApp && !snoozed(APP_DISMISSED)) return setBanner("app");
      if (pushSupported() && Notification.permission === "default" && !snoozed(NOTIFY_DISMISSED)) return setBanner("notify");
      setBanner(null);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [signedIn]);

  const noticeView = notice && <MessageNotice key={notice.key} notice={notice} onClose={closeNotice} />;
  if (!banner) return noticeView;
  const dismiss = () => {
    write(banner === "app" ? APP_DISMISSED : NOTIFY_DISMISSED, String(Date.now()));
    setBanner(null);
  };
  return (
    <>
    {noticeView}
    <div className="app-banner" role="region" aria-label={banner === "app" ? "Get the app" : "Notifications"}>
      <img src="/icon-192.png" alt="" width={40} height={40} />
      <span className="app-banner-copy">
        <strong>{banner === "app" ? "Get the Circle app" : "Turn on notifications"}</strong>
        <small>
          {banner === "app"
            ? "Faster, full screen, with message notifications."
            : "Know right away when someone messages you."}
        </small>
      </span>
      {banner === "app" ? (
        <a className="app-banner-action" href={APK_URL} download onClick={dismiss}>
          <Download size={16} aria-hidden="true" /> Download
        </a>
      ) : (
        <button
          type="button"
          className="app-banner-action"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await enableNotifications();
              if (result === "granted") toast("Notifications are on.");
              else if (result === "denied") toast("Notifications are blocked. You can allow them in your browser settings.", true);
              else toast("This browser doesn't support notifications.", true);
            } catch {
              toast("Couldn't turn on notifications. Try again.", true);
            } finally {
              setBusy(false);
              write(NOTIFY_DISMISSED, String(Date.now()));
              setBanner(null);
            }
          }}
        >
          <Bell size={16} aria-hidden="true" /> Turn on
        </button>
      )}
      <button type="button" className="app-banner-close" aria-label="Not now" onClick={dismiss}>
        <X size={18} />
      </button>
    </div>
    </>
  );
}
