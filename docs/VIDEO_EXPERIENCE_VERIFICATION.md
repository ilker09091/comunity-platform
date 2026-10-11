# Reels and universal video experience — October 11, 2026

## Implemented scope

The existing Next.js frontend was upgraded in place. Backend source, API schemas, authentication, database configuration and dependencies were preserved.

- Desktop Reels uses a black viewport, a 72px icon navigation rail, native-ratio sizing capped to 1200px, an attached engagement rail and previous/next controls. Source dimensions come from video metadata, then DTO dimensions, with a 16:9 placeholder while dimensions are unknown. Videos use `contain` throughout.
- Desktop comments use a dark 384px panel. The selected video remains mounted and keeps its playback position; stage resizing uses one ResizeObserver. Navigation remains available while desktop comments are open.
- Mobile Reels has a safe-area-aware header, right-side actions, creator/follow/caption overlays, a dark modal comments sheet and the existing MobileNav component in a Reels variant. Create actions open the existing uploader/composer and authenticated posting API. Mobile repost remains available in More.
- Feed, quoted posts and details share VideoPlayerCore with Reels: custom play/pause, seek, mute, replay, supported fullscreen, error recovery and exact signed source handling.
- Existing engagement mutations, cache reconciliation, comments, nested replies and visibility contracts remain in use. Reels loads the real creator profile follow status, including private-account requests, before enabling follow actions.

## Playback diagnosis and evidence

The earlier failure was a source lifecycle defect: cleanup removed `src` from a retained DOM video, but Strict Mode replay did not restore it if the URL prop was unchanged. MediaVideo balances source setup/cleanup, restoring the exact API-issued URL after effect replay without stripping or reconstructing signed query strings. This fix is retained in the new shared core and regression-tested.

Read-only live checks against the existing backend passed for **10** READY Reels video sources also present in the homepage feed. Exact URLs matched across feeds; every source returned HTTP 206 for a range request, `video/mp4`, Content-Range and the localhost frontend CORS origin. MP4 sample entries identify AVC (`avc1`) and AAC (`mp4a`). Eight files place metadata before video data. Two older 11MB/37MB files place metadata after the data, which can delay initial loading. No server files were rewritten. Signed URLs are excluded from logs.

These HTTP/container checks establish source/transport behavior; they do not prove browser decoder compatibility.

## Coordinator and resource policy

One IntersectionObserver serves mounted players. Feed activation requires 60% visibility; the current player remains eligible down to 45%, and a competing player needs a 12 percentage-point advantage. Reels selects only the requested visible item. A trusted manual play can claim ownership. The previous owner pauses before the next starts, and late playback events verify ownership.

Manual pause persists through rerenders, visibility fluctuations, modal interruptions and tab hiding. It resets only after a full viewport exit. Playback position survives source eviction and is restored on metadata load. Feed sources are lazy and capped at three; Reels mounts at most the current item and its immediate neighbors. Data saver, 2G and reduced-data preferences suppress automatic playback and unnecessary preloading. There is no poster/audio-attribution field in the existing media contract; the UI uses a loading placeholder and does not invent attribution.

Route changes, hidden documents, native dialogs and ARIA modal sheets block background playback. Desktop comments are a nonmodal region, so they preserve ongoing playback; mobile comments pause it without resetting position.

## Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed without warnings.
- `npm.cmd run build`: passed, all existing routes generated.
- `npm.cmd run test:video`: 6 source/playback DOM checks passed.
- `npm.cmd run test:video-experience`: 13 test groups passed for shared observation, visibility selection, hysteresis, manual pause/re-entry, native/ARIA modal blocking, route/tab transitions, source limits, retained position, native-ratio sizing, keyboard seeking, source retry, Save-Data and muted autoplay fallback.
- `npm.cmd run test:upgrade`: 10 groups passed, including source/player identity and time retention during comments, usable desktop navigation, wheel/swipe/keyboard navigation, insertion-safe selection and existing crop/profile helpers.
- `npm.cmd run test:profile`: 3 existing profile editor groups passed.
- `npm.cmd test`: 18 production route/API/session/cache fixture checks passed, including all 12 page routes, refresh/session behavior, documented API operations, optimistic rollback and account-cache isolation.
- `npm.cmd run check:media`: 10 read-only live media checks passed.

Media, IntersectionObserver and API operations in the DOM suites are mocks. No real account interactions or database writes were used. Sizing arithmetic covers 1920×1080, 1440×900, 1280×800 and 1024×768 with portrait, landscape, square and 4:3 sources, comments both open and closed, and verifies the engagement rail clears navigation. This is an arithmetic test, not a rendered viewport test.

## Remaining browser QA

The attachment folder contained only the written brief, without its three referenced screenshots. No enabled browser surface was available in the session. Exact screenshot fidelity, native decoding, live browser hydration, rendered layout/overflow, real trackpad/swipe and fullscreen behavior remain unverified.

Visually check all requested viewports: 1920×1080, 1440×900, 1280×800, 1024×768, 768×1024, 390×844 and 375×812. Verify landscape/portrait/square clips, desktop comments sizing, mobile keyboard/safe areas, native playback on Chrome/Safari/Firefox, fullscreen, and authenticated/private-account engagement with a test account.
