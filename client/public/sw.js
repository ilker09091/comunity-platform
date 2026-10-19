/* Circle service worker: message notifications (Web Push).
 *
 * Pushes carry no payload. On a push we fetch the newest conversation through the site's own API
 * gateway (the session cookie is sent) and show it. When the app is open and visible we let the
 * page handle it instead (in-app sound and banner) rather than showing a system notification. */
const API = "/api/backend/api";
const ICON = "/icon-192.png";
const BADGE = "/badge-72.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function preview(message) {
  if (!message) return "Sent you a message";
  if (message.noteReply) return `Replied to your note: ${message.content || ""}`;
  if (message.storyReply) return `Replied to your story: ${message.content || ""}`;
  if (message.content) return message.content;
  if (message.viewOnce) return "Sent a view once photo";
  if (message.media) return message.media.type === "IMAGE" ? "Sent a photo" : "Sent a video";
  if (message.post) return "Shared a post";
  return "Sent you a message";
}

async function latest() {
  try {
    const response = await fetch(`${API}/messages?limit=1`, { credentials: "include", cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    const conversation = data.items && data.items[0];
    if (!conversation) return null;
    return {
      title: conversation.user.displayName,
      body: preview(conversation.lastMessage),
      url: `/messages?to=${encodeURIComponent(conversation.user.username)}`,
      tag: `dm-${conversation.user.id}`,
      icon: conversation.user.avatarUrl || ICON,
    };
  } catch {
    return null;
  }
}

async function incomingCall() {
  try {
    const response=await fetch(`${API}/calls/current?deviceId=${crypto.randomUUID()}`,{credentials:"include",cache:"no-store"});
    if(!response.ok)return null;
    const {call}=await response.json();
    if(!call||call.outgoing||call.state!=="ringing")return null;
    return {title:call.peer.displayName,body:`Incoming ${call.kind} call`,url:`/messages?to=${encodeURIComponent(call.peer.username)}`,
      tag:`call-${call.id}`,icon:call.peer.avatarUrl||ICON,call:true};
  }catch{return null;}
}
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const message = (await incomingCall()) || (await latest()) || {
        title: "Circle",
        body: "You have a new message",
        url: "/messages",
        tag: "dm",
        icon: ICON,
      };
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = windows.filter((w) => w.visibilityState === "visible");
      if (visible.length) {
        for (const w of visible) w.postMessage({ type: message.call ? "circle:incoming-call" : "circle:new-message", ...message });
        return;
      }
      await self.registration.showNotification(message.title, {
        body: message.body,
        icon: message.icon,
        badge: BADGE,
        tag: message.tag,
        renotify: true,
        requireInteraction: !!message.call,
        vibrate: [80, 40, 80],
        data: { url: message.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await existing.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
