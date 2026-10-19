# Messages and stories

Users can open **Messages** from navigation or a profile. The inbox is a two-pane, Instagram-style workspace (conversation list + active chat); on mobile the list opens first and a chat covers the whole screen. Conversations are split into **Primary** and **Requests** (`GET /messages?folder=primary|requests`): a request is a thread with someone you do not follow and have never replied to. Users send text and uploaded videos, and send existing posts/Reels with **Send to a user**. A private recipient must first approve the sender's follow request. Blocks in either direction prevent new contact. Existing blocked threads stay readable with hidden profile and presence details. Only the two participants can read a thread; shared posts are checked against the viewer's current permissions on every request. Read acknowledgements apply only through a received message actually visible in the active conversation.

The home feed includes **Stories**. Reels and video posts can be added to your story from **Send to a user → Add to your story** (`POST /stories` with `postId`); the story plays the post's video and links back to it, the post's visibility is re-checked for every viewer, and deleting the story never deletes the Reel. The player blurs the page behind it on desktop and is edge-to-edge on mobile, with progress bars, tap/hold navigation and pause. Followers can view photo and video stories for 24 hours. Videos must finish processing and last no more than 60 seconds. Views are recorded once per viewer; only the author sees the count. Authors can delete their stories. Expired stories stop appearing in lists, reject views, and reject already-issued media URLs immediately; an hourly job removes their rows and files.

Media attachments are exclusive to one post/profile/message/story. Attachment locking and both automatic and administrator orphan cleanup protect media in use. Messaging and story uploads reuse the existing chunked upload, video transcoding, signed URLs and cookie-authenticated API gateway. Message threads poll every 3 seconds; the navigation unread badge and device delivery handshake poll every 5 seconds. No WebSocket server is required.

## Story engagement, message requests and stickers

- **Stories:** viewers can like a story (`POST/DELETE /stories/{id}/like`) and reply (`POST /stories/{id}/reply`), which sends a direct message linked to the story; the author sees a live list of who watched and liked it (`GET /stories/{id}/viewers`). Liking or replying also counts as a view.
- **Message requests:** someone you do not follow can send you one message. It lands in **Requests**, is not marked seen, and the sender cannot write again until you **Accept** (`POST /messages/{id}/accept`) or follow/reply to them. **Delete** (`DELETE /messages/{id}/request`) removes the request; they may send a new one later. `GET /messages/{id}/status` reports the state for the composer.
- **Stickers:** comments can carry a sticker (`stickerId`) with or without text. Everyone gets the built-in pack; users can create up to 60 of their own from a photo (`POST /stickers`) and delete them (`DELETE /stickers/{id}`). Comments that already use a deleted sticker keep showing it.
- **Haptics:** revealing a `#spoiler`, liking a story and sending stickers trigger a short vibration on devices that support it (Android Chrome; iOS Safari does not expose vibration).

## Chat features and notes

- **Receipts (WhatsApp style):** one grey tick = accepted by the server, two grey = explicitly acknowledged by the recipient's device, two dark blue = visible in the focused conversation. Fetching unread counts or history alone does not mark delivery. Every bubble shows its time.
- **Replies:** hover a message and press Reply (desktop) or swipe it right (phone); the quote links back to the original (`replyToId`).
- **Photos and view once:** photos can now be sent in DMs. With the "1" toggle the recipient can open the photo/video once (`POST /messages/{messageId}/open`); the file is deleted two minutes after it is opened and the URL stops working at the same time.
- **Typing and online:** the composer sends `POST /messages/{id}/typing` while you write; `GET /messages/{id}/status` returns `peerTyping`, `peerOnline` and `peerLastActiveAt`. Presence uses `users.last_active_at`, refreshed by the app's unread-count poll (online = active in the last 45 s). Only people you have a conversation with see it.
- **Notes:** a 60-character note above the inbox for 24 hours, visible to your followers. You can add a song from your device and pick which 15 seconds play; the server cuts it with ffmpeg to AAC (`POST /notes/audio`, then `POST /notes`). Production needs ffmpeg/ffprobe, as for video.

## Deployment

Run the existing migration command before starting the updated server:

```powershell
cd server
npm.cmd run migration:run
```

The additive migrations are `MessagesAndStories1760191200000`, `StoryPostShares1760191300000`, `StoryEngagementRequestsStickers1760191400000` and `MessagingPresenceNotes1760191500000`. The generated OpenAPI document, client types and gateway operation allowlist include the new routes.

## Checks

```powershell
cd server
npm.cmd run test:e2e -- messages-stories.e2e-spec.ts media.e2e-spec.ts deletion.e2e-spec.ts
cd ../client
npm.cmd run build
cd ..
$env:PYTHONPATH = (Resolve-Path '.tools/tiktok').Path # if using the project's existing browser-test dependencies
python tools/test_messages_stories_browser.py
```

The browser script uses isolated API fixtures, real H264 decoding, and desktop/mobile screenshots under `.tools/messages-stories-qa/`. It does not write fixture users or content to the application database.

The existing `test:reels-polish` suite currently fails because its fixture does not export `VerifiedBadge`; `test:upgrade` fails its wheel-gesture assertion. Both failures were reproduced against the pre-change components from Git HEAD.

See [DM attachments and mobile update](DM_ATTACHMENTS_AND_MOBILE.md) for voice messages, personal sticker favorites, explicit device acknowledgments and fullscreen mobile content dialogs.
