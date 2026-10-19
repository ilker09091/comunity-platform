# DM attachments, receipts and mobile dialogs

Apply `DirectMessageAttachments1760191900000` before starting the updated API, then rebuild/restart the frontend. Compose already runs migrations. Native deployment:

```powershell
cd server
npm.cmd run migration:run
```

The new migration adds sticker favorites, voice draft storage and DM attachment fields. Existing messages remain intact. No production database was changed during development.

## Receipts

- A single gray tick means the API accepted the message.
- Two gray ticks require acknowledgment from the recipient's browser/device. Fetching presence, unread counts, conversations or history does not change delivery state. The device fetches pending IDs, then acknowledges only the IDs it received. This also runs in the service worker after a successful push fetch. Sending a push to a push provider is not delivery proof.
- Two dark blue ticks mean a received message was visible in the focused, active conversation. Background tabs, another dialog, an overlay obscuring the message, pending requests, blocks and messages below the scroll position do not manufacture read receipts. Read implies delivery; timestamps never regress.
- The active app checks delivery every five seconds; thread updates poll every three seconds. If the recipient's browser/app is suspended and cannot receive push, its receipt waits for the next successful connection. Internet connectivity alone is not observable from another device.

## Stickers

DMs support the existing built-in sticker pack and custom image stickers. **Your stickers → Create** uploads an image; PNG/WebP transparency is retained. A user can keep up to 60 personal stickers. This does not perform automatic background removal.

The star beside a received sticker saves/removes it in **Favorites**; saved stickers can be sent to other conversations. A stranger cannot enumerate another account's private library or favorite/send a guessed private sticker ID. Deleting a sticker removes it from its owner's tray while existing messages, comments and favorites retain it. Permanent account/media deletion still removes the original asset and leaves an unavailable attachment indicator.

## Voice messages and photos

Tap the microphone, record up to two minutes, stop, listen and send, or discard. Recording requires HTTPS/localhost and microphone permission. Recording uses [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) with a supported audio format; the server decodes the actual content and normalizes it to AAC/M4A. Production already needs ffmpeg/ffprobe for video and note audio. Uploads are limited to 10 MB. Voice playback supports seeking and 1×/1.5×/2× speed.

Draft audio belongs to its uploader and is consumed once. Discarded/abandoned drafts expire after six hours. Transactional deletion triggers queue audio file removal for unsend, deleted chats, declined requests and account deletion. Deleted audio stops resolving immediately; storage removal retries durably.

Choosing a DM image immediately displays a large local preview in the conversation while uploading. It can be enlarged, removed, captioned and optionally marked view-once before sending. Closing the preview never submits the surrounding form. Local preview URLs, recordings and unused owned uploads are released when discarded or when leaving the thread.

## Mobile

Content dialogs, including sharing, post/Reel creation, new messages, notes and the DM sticker library, fill mobile viewports up to 767 px. They follow visual viewport height changes and safe areas. Short confirmation prompts retain their compact layout. Interactive post builders also fill the screen.

## Checks

`server/test/dm-attachments-receipts.e2e-spec.ts` covers authenticated device acknowledgments, cross-account and blocked receipt protection, sticker favorites/private libraries/reuse, real audio normalization, draft ownership/single consumption and durable erasure. Existing messaging and calls suites cover compatibility.

`tools/test_calls_browser.py` uses isolated local PostgreSQL and real Chrome with synthetic microphone/camera sources. It checks offline → delivered → read tick changes, actual MediaRecorder recording/AAC playback, custom sticker creation/favorite/reuse, in-DM photo previews, mobile dialogs and existing WebRTC flows. Physical phones and production network/proxy behavior need deployment/device verification.

Verified on 2026-10-19: client/server production builds, complete server TypeScript check, client ESLint, 16 server unit tests, messaging/calls/deletion integration suites, 23 frontend gateway/contract checks and six media/discovery groups. Chrome passed the new DM flows, full-screen post/share dialogs at 320/390/430/767 px and the existing voice/video calls, block/unblock, deletion and Reels checks. Screenshots are under `.tools/calls-qa/`.
