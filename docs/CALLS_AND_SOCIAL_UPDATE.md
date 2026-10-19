# Calls and social update

## Deploy

Apply `CallsAndStreaks1760191800000` before starting the API. Compose applies it automatically:

```sh
docker compose up -d --build api web
```

For native deployments: `cd server && npm run migration:run`, then restart the API and rebuild/restart Next.
The Android TWA uses the updated web application; this change does not need a new APK.

Calls need HTTPS (localhost is accepted for development), microphone permission, and camera permission for video.
Configure a coturn-compatible TURN relay for reliable calls between mobile networks, corporate firewalls and restrictive NATs:

```dotenv
CALL_STUN_URLS=stun:stun.l.google.com:19302
CALL_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
CALL_TURN_SECRET=<the relay's TURN REST shared secret>
```

The relay must use the same shared secret (`use-auth-secret` / `static-auth-secret` in coturn), an actual reachable external address, TLS certificates for `turns:`, and open listening/relay ports. Keep its secret private. The API issues expiring HMAC credentials; browser code never receives the shared secret. A relay/domain is not provisioned automatically. STUN-only calls can work directly, but are insufficient on some networks.

## Calls

- One audio or video call per account. Both user locks are taken in sorted order to prevent crossing calls.
- Start from the conversation header. Accepted message permissions, private accounts, blocks and active account status apply server-side. Pending message requests cannot place calls.
- Incoming calls appear globally. Answer/decline, hang up, mute, camera toggle, camera switching and audio-to-video upgrade are supported. A camera is never enabled on the other participant's behalf.
- SDP/ICE signaling uses authenticated, device-owned, ordered polling through the existing HttpOnly-cookie gateway. Perfect negotiation supports simultaneous camera changes. Audio/video travel through WebRTC, directly or through TURN, and are not recorded/stored by this application.
- A single browser tab/device owns each participant's call. Answering elsewhere cannot hijack the connection. Ringing expires at 60 seconds; abandoned accepted calls expire after a 45-second heartbeat gap. Connection failures release media. Maximum call duration is four hours; signaling records expire after one day.
- Push wakes registered devices for incoming calls. The notification opens Circle to answer; it does not provide native OS call integration or promise background ringing on suspended browsers.
- Browser reload, logout and page exit release local tracks and attempt to end the call. Server expiry covers dropped connections and failed unload requests.

## Messaging streaks

The behavior follows [TikTok's documented pattern](https://support.tiktok.com/en/using-tiktok/messaging-and-notifications/streaks): a badge from three reciprocal messaging days, fading after a missed day, expiry 24 hours later and restoration within 48 hours of expiry. Circle uses UTC calendar days consistently for both participants. Its monthly restoration allowance is three per pair, shared by both people.

All successful message types count: text, images, video, post shares and story/note replies. Both participants must send; repeatedly sending, retrying reads or unsending cannot manufacture days. The database trigger updates one locked pair row, including concurrent sends. Historical messages are not backfilled into fictitious streaks. The badge appears in the conversation list and thread; restore is guarded atomically and blocked users cannot restore together.

## Privacy, deletion and UI

- A blocked viewer gets `404 USER_NOT_FOUND` for the blocker profile and message/call attempts. The frontend shows “Kullanıcı bulunamadı” and removes cached profile content on refetch; open profiles poll every 15 seconds, open DM peers every 5 seconds. Old messages remain in the database and do not authorize new contact.
- Admin user actions include **Delete account permanently**. Requires a lower-ranked target, `users.ban` + `media.manage`, step-up password verification and exact username confirmation. Self-deletion and deleting a super administrator are rejected.
- Account deletion transactionally erases the user and dependent sessions, social relationships, content, DMs, stories, media, calls and streak data. Neighbor counters are repaired. Storage deletion is queued durably and runs after commit, including note clips, staged audio and incomplete uploads. The existing append-only administration audit keeps an ID-only deletion record and reason; it is not a recoverable user account.
- Profile photos enlarge with a desktop click / touch hold (keyboard activation also works). DM photos open inside an accessible modal. Escape, close and outside clicks return to the same conversation.
- Menus use native top-layer popovers, positioned within the viewport. Dialog headers, long usernames and action buttons wrap within the available width. Message popovers are clamped at the viewport edges.
- Reels retains the preloaded player when selecting it, buffers the next video, and prevalidates its access shortly before navigation. Previous video uses metadata preloading. Save-Data / slow connections retain restricted preloading. Access checks still gate actual playback and visibility; preloading does not create an impression.

## Verification

Backend: unit tests and `test/calls-streaks-account.e2e-spec.ts`, plus existing messages/stories, social graph, deletion and admin integration suites, on isolated `*_test` PostgreSQL databases.

`tools/test_calls_browser.py` launches production Next and the compiled API against `circle_calls_browser_test` on the local QA PostgreSQL cluster (:55433). It uses two real Chromium contexts with fake camera/microphone sources to verify actual WebRTC media transport, and checks dialog/menu bounds at 1440, 1024, 768 and 390 pixels. Fake sources do not establish physical phone/iOS/network interoperability.

The signaling/media negotiation follows [WebRTC perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation).

Verified on 2026-10-19:

- Backend production build, complete TypeScript check, 16 unit tests, and 7 new PostgreSQL integration tests passed. Existing messaging/stories, social graph, permanent deletion, administration and importer administration suites passed (one pre-existing skip).
- Frontend production build, TypeScript and ESLint passed; 23 gateway/contract checks, 12 Reels V2 checks and 14 video experience groups passed.
- Native Chrome passed bidirectional RTP audio, bidirectional decoded video, direct video calls, audio-to-video upgrade, mute/unmute, camera off/on, switching, answer/decline and remote hangup. The test uses synthetic camera/microphone devices, not physical phones.
- Photo viewing stayed in the thread; profile click/hold and a blocked open profile were checked. Menus/deletion dialogs fit all four viewport widths and screenshots were inspected.
- Native Reels decoding retained the warmed video DOM element across selection: **187 ms** in the local three-video fixture. This measures the isolated fixture, not production network latency.

Real TURN relay deployment, cross-network calling and physical iOS/Android microphone/camera behavior still need deployment/device verification. The test databases are isolated; no production database migration was applied during this work.
