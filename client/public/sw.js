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

/* Notifications follow the app's language (the page tells us which, and we remember it). */
let LANG = null;
const TR = {
  "Sent you a message": "Sana mesaj gönderdi",
  "Sent a voice message": "Sesli mesaj gönderdi",
  "Wants to play a game 🎮": "Oyun oynamak istiyor 🎮",
  "Wants to have a baby with you 👶": "Seninle bebek sahibi olmak istiyor 👶",
  "Sent a GIF": "GIF gönderdi",
  "Sent a sticker": "Çıkartma gönderdi",
  "Sent a view once photo": "Bir kez görüntülenen fotoğraf gönderdi",
  "Sent a photo": "Fotoğraf gönderdi",
  "Sent a video": "Video gönderdi",
  "Shared a post": "Bir gönderi paylaştı",
  "There's something new for you two 💗": "Size özel yeni bir şey var 💗",
  "You have a new message": "Yeni bir mesajın var",
  "Ended a video call": "Görüntülü arama bitti",
  "Ended a voice call": "Sesli arama bitti",
  "Missed video call": "Cevapsız görüntülü arama",
  "Missed voice call": "Cevapsız sesli arama",
  "Incoming video call": "Gelen görüntülü arama",
  "Incoming voice call": "Gelen sesli arama",
};
async function language() {
  if (LANG) return LANG;
  try {
    const stored = await (await caches.open("circle-meta")).match("/__lang");
    LANG = stored ? await stored.text() : "en";
  } catch {
    LANG = "en";
  }
  return LANG;
}
function localize(lang, text) {
  if (lang !== "tr" || !text) return text;
  if (TR[text]) return TR[text];
  let m = text.match(/^Replied to your (note|story): ([\s\S]*)$/);
  if (m) return `${m[1] === "note" ? "Notuna" : "Hikâyene"} cevap verdi: ${m[2]}`;
  m = text.match(/^Reacted (\S+) to your message(?:: ([\s\S]*))?$/);
  if (m) return `Mesajına ${m[1]} bıraktı${m[2] ? `: ${m[2]}` : ""}`;
  return text;
}

function preview(message) {
  if (!message) return "Sent you a message";
  if (message.noteReply) return `Replied to your note: ${message.content || ""}`;
  if (message.storyReply) return `Replied to your story: ${message.content || ""}`;
  if (message.content) return message.content;
  if (message.call) {
    const kind = message.call.kind === "video" ? "video" : "voice";
    return message.call.status === "completed" ? `Ended a ${kind} call` : `Missed ${kind} call`;
  }
  if (message.audioUrl) return "Sent a voice message";
  if (message.game) return "Wants to play a game 🎮";
  if (message.baby) return "Wants to have a baby with you 👶";
  if (message.gif) return "Sent a GIF";
  if (message.hasSticker) return "Sent a sticker";
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
    // Only a successful fetch on the recipient's device may produce a second tick.
    try {
      const pending=await fetch(`${API}/messages/delivery`,{credentials:"include",cache:"no-store"});
      if(pending.ok){const body=await pending.json();if(body.messageIds?.length)await fetch(`${API}/messages/delivery`,{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json","X-Social-Client":"web"},body:JSON.stringify(body)
      });}
    }catch{}
    const conversation = data.items && data.items[0];
    if (!conversation) return null;
    const last = conversation.lastMessage;
    const url = `/messages?to=${encodeURIComponent(conversation.user.username)}`;
    const icon = conversation.user.avatarUrl || ICON;
    // Pushes also come for things that aren't new messages (your baby, a game move, a heart).
    // Then the newest message may be your own: never show it back to you as if they sent it.
    // They reacted to your message: say so (with your message as context).
    const reaction = last && last.senderId !== conversation.user.id &&
      (last.reactions || []).find((r) => r.userId === conversation.user.id);
    if (reaction) {
      const text = preview(last);
      return {
        title: conversation.user.displayName,
        body: `Reacted ${reaction.emoji} to your message${text && text !== "Sent you a message" ? `: ${text}` : ""}`,
        url,
        tag: `react-${conversation.user.id}`,
        icon,
        activity: true,
      };
    }
    if (!last || last.senderId !== conversation.user.id || !conversation.unreadCount) {
      return {
        title: conversation.user.displayName,
        body: "There's something new for you two 💗",
        url,
        tag: `activity-${conversation.user.id}`,
        icon,
        activity: true,
      };
    }
    return {
      title: conversation.user.displayName,
      body: preview(last),
      url,
      tag: `dm-${conversation.user.id}`,
      icon,
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
      const lang = await language();
      message.body = localize(lang, message.body);
      if (message.title === "Circle") message.body = localize(lang, message.body);
      // The call stopped ringing: drop its "Incoming call" notification.
      if (!message.call) {
        for (const shown of await self.registration.getNotifications())
          if (shown.tag && shown.tag.startsWith("call-")) shown.close();
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = windows.filter((w) => w.visibilityState === "visible");
      if (visible.length) {
        // The open app refreshes itself; only real messages and calls get the in-app banner and sound.
        if (!message.activity)
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
        // Calls ring like a phone (the Android app also plays the ringtone on its "Calls" channel).
        vibrate: message.call ? [800, 600, 800, 600, 800, 600, 800] : [80, 40, 80],
        silent: false,
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

// The browser can rotate a push subscription at any time; re-subscribe and tell the server at once,
// instead of waiting for the next visit (otherwise notifications silently stop).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
      const subscription = event.newSubscription ||
        (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!subscription) return;
      const json = subscription.toJSON();
      await fetch(`${API}/push/subscriptions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Social-Client": "web" },
        body: JSON.stringify({ endpoint: subscription.endpoint, p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth }),
      }).catch(() => undefined);
    })(),
  );
});

// The page tells us the app's language.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "circle:lang") return;
  LANG = event.data.lang === "tr" ? "tr" : "en";
  event.waitUntil(caches.open("circle-meta").then((c) => c.put("/__lang", new Response(LANG))).catch(() => undefined));
});

// The page asks to dismiss a ringing call notification once the call is answered, declined or over.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "circle:close-call-notifications") return;
  event.waitUntil(
    self.registration.getNotifications().then((list) => list.forEach((n) => { if (n.tag && n.tag.startsWith("call-")) n.close(); })),
  );
});
