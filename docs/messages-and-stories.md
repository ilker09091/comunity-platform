# Messages and stories

Users can open **Messages** from navigation or a profile. The inbox is a two-pane, Instagram-style workspace (conversation list + active chat); on mobile the list opens first and a chat covers the whole screen. Conversations are split into **Primary** and **Requests** (`GET /messages?folder=primary|requests`): a request is a thread with someone you do not follow and have never replied to. Users send text and uploaded videos, and send existing posts/Reels with **Send to a user**. A private recipient must first approve the sender's follow request. Blocks in either direction prevent reading and sending. Only the two participants can read a thread; shared posts are checked against the viewer's current permissions on every request. Read acknowledgements apply only through the last received message loaded by the reader.

The home feed includes **Stories**. Reels and video posts can be added to your story from **Send to a user → Add to your story** (`POST /stories` with `postId`); the story plays the post's video and links back to it, the post's visibility is re-checked for every viewer, and deleting the story never deletes the Reel. The player blurs the page behind it on desktop and is edge-to-edge on mobile, with progress bars, tap/hold navigation and pause. Followers can view photo and video stories for 24 hours. Videos must finish processing and last no more than 60 seconds. Views are recorded once per viewer; only the author sees the count. Authors can delete their stories. Expired stories stop appearing in lists, reject views, and reject already-issued media URLs immediately; an hourly job removes their rows and files.

Media attachments are exclusive to one post/profile/message/story. Attachment locking and both automatic and administrator orphan cleanup protect media in use. Messaging and story uploads reuse the existing chunked upload, video transcoding, signed URLs and cookie-authenticated API gateway. Message threads poll every 5 seconds; the navigation unread badge polls every 15 seconds. No WebSocket server is required.

## Deployment

Run the existing migration command before starting the updated server:

```powershell
cd server
npm.cmd run migration:run
```

The additive migrations are `MessagesAndStories1760191200000` and `StoryPostShares1760191300000`. The generated OpenAPI document, client types and gateway operation allowlist include the new routes.

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
