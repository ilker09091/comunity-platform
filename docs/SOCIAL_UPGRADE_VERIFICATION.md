# Social upgrade verification — 2026-10-11

## Playback diagnosis

The homepage used a native video element with the API URL unchanged. The old Reels player used that same URL but installed an effect with no source setup. Its cleanup paused the element, removed `src`, and called `load()`. Next's App Router enables development Strict Mode by default. Its effect cleanup/setup replay retained the element while clearing its source; the empty setup did not restore it. Retrying `load()` on that element could not recover the missing source. The old code also swallowed playback promise failures other than autoplay denial.

`client/src/components/media-video.tsx` now supplies the common source lifecycle for feed and Reels. Setup restores the exact URL if missing; cleanup releases the source. Source effects depend on the source alone, so changing preload, sound, comments or engagement does not reload a video. The mounted DOM regression suite reproduces the original cleanup defect and verifies the corrected component under React Strict Mode.

Reels additionally provides a native play call inside the user's click, muted fallback, media-code errors, refresh/retry, loading skeleton, buffering feedback, progress, visibility pausing and listener/timer cleanup. Development diagnostics contain event, media error code, ready/network states and recognized rejection names; they exclude URLs and exception messages. Reels mounts the current video plus at most two neighbors. Neighbors preload metadata, or nothing with Save-Data/2G; only the active video plays.

## Live backend evidence

Read-only checks used the existing service on `localhost:3002`. Global feed and Reels feed both returned HTTP 200 and identical absolute signed URLs for the two ready videos. Requests used their exact URLs without a bearer token. URL signatures were never printed or saved.

| Media ID | Total bytes | Partial response | MIME | Sample entries | Fast-start MP4 |
| --- | ---: | --- | --- | --- | --- |
| `87375cc6-b7d8-428a-b7ea-e7f8bf8a3855` | 11,362,436 | 206, bytes 0–1023 | video/mp4 | avc1, mp4a | No |
| `6fff4ed4-5ace-46cd-9599-b1b3f7ab8e74` | 37,167,256 | 206, bytes 0–1023 | video/mp4 | avc1, mp4a | No |

Both responses supplied `Accept-Ranges: bytes`, a matching 1,024-byte Content-Length, the correct total in Content-Range and `Access-Control-Allow-Origin: http://localhost:3000`. MP4 atoms were inspected with bounded Range reads; this identifies codec sample entries, not actual device decoder compatibility. The documented signed URLs last 24–48 hours and direct media routes support Range. Retry refetches post/feed data before reloading, allowing renewed URLs.

A later read-only run found six additional ready videos in the live feed. All eight matched the homepage sources and passed the same Range/MIME/CORS checks. The six newer files were 281,208–749,632 bytes, had `avc1`/`mp4a` sample entries, and placed metadata before video data (fast-start). Their media IDs were `de7b2eb8-b338-4cf9-a7b0-ba1d51f87e94`, `1ae3a5aa-34ed-42fe-a456-619708c3b466`, `b87b8aed-06da-4405-8435-40ad1f5ce181`, `df3938e9-c6b5-425b-a971-eddf7762f71e`, `9646ff5d-df3d-4f58-b761-4ea917ab2d49`, and `1f30e2ad-a211-4cfe-baaf-f520659e4b09`. This agent did not create or modify these backend records.

The current backend is a passthrough processor serving original MP4s. Both files place `moov` after `mdat`, requiring an additional metadata seek. A future `faststart` remux would improve startup for these originals; Range support makes them playable without adding HLS/transcoding. This does not explain why the same source worked only on the homepage. Backend, database, auth, gateway configuration and API contracts were not changed by this upgrade.

## Delivered UI

- Dedicated Reels navigation at 240px, collapsing to icons on smaller desktops; centered canvas and 380px/340px comments panel.
- Shared 9:16 canvas calculation, capped by viewport height and available width; video uses `object-fit: contain`. Mobile retains that ratio with dark fill outside the canvas.
- Swipe, one navigation per continuous wheel gesture, keyboard and visible desktop controls. Stable reel IDs survive earlier feed insertions. Comments preserve the same video DOM element, scroll independently and use a mobile bottom sheet with focus trapping, inert background, safe-area input and VisualViewport keyboard adjustment.
- Creator/avatar/profile links, original-post actions for a repost's video, shared optimistic engagement, nested comments and report flows.
- `/profile/edit` fetches the current editable DTO and includes appearance, personal information, supported privacy and a live preview. Existing edit buttons and legacy `?edit=1` links lead to this page.
- Interactive avatar 1:1 circular crop frame and cover 3:1 crop frame, dragging/pinch/slider zoom, keyboard repositioning, Cancel/Apply and client-side JPEG export. Orientation is normalized before editing. Output is bounded to 1024px avatar/1800×600 cover and source resolution; temporary URLs/bitmaps are released. GIFs are explicitly saved as still photos. Upload happens only on Save.
- Dirty-only profile patches, validation, duplicate-save prevention, leave/reload warnings, cache reconciliation after each successful stage and truthful partial failure recovery.
- Locally optimized Poppins 400/500/600/700, multilingual fallbacks, refined controls, crop/dialog/panel transitions and reduced-motion handling. Home keeps the existing three columns and 80vw/90vw desktop container.

## Executed checks

| Check | Actual result |
| --- | --- |
| TypeScript `npm.cmd run typecheck` | Passed |
| ESLint `npm.cmd run lint` | Passed with no warnings/errors |
| Next production build | Passed; `/profile/edit` and `/reels` generated |
| Existing HTTP/contract/cache suite | 18 checks passed; 12 page routes render |
| Video DOM suite | 6 checks passed, native media methods mocked |
| Reels/upgrade DOM suite | 10 checks passed, API/native media mocked |
| Profile editor DOM suite | 3 checks passed, API/upload/crop UI fixtures |
| Live media HTTP/MP4 inspection | Eight ready MP4s passed source/header checks on the final run |
| Compiled CSS inspection | Poppins, Reels sidebar and profile editor styles present |
| Backend compilation | Not run: no backend files changed |

The editor test covers a successful avatar upload followed by a failed cover upload, verifies updated session data, then retries only the remaining cover and dirty text fields. It verifies untouched biography preservation and navigation to a renamed username. No real account/profile/comment writes were performed during tests.

## Browser QA still required

The computer-use inventory returned no apps or browsers. Actual HTML media decoding, startup timings, EXIF image fixtures, crop dragging/pinch/canvas output appearance, real comment/profile submissions and visual layout were not executed in a browser. jsdom checks verify component logic, not browser geometry or playback.

| Requested viewport | Actual visual result |
| --- | --- |
| 1920×1080 | Not run — no browser surface |
| 1440×900 | Not run — no browser surface |
| 1280×800 | Not run — no browser surface |
| 768×1024 | Not run — no browser surface |
| 390×844 | Not run — no browser surface |
| 375×812 | Not run — no browser surface |

At those sizes, manually check the same uploaded videos on Home and Reels, portrait/landscape proportions, audible/muted/manual playback, wheel/swipe/keyboard behavior, comments and mobile keyboard, avatar/cover cropping and save/cancel, global typography, and follow/block/post interactions. No device/browser pass is claimed here.
