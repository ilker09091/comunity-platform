# Circle logo and Reels polish — October 11, 2026

The existing frontend was updated in place. No backend endpoints, database schema, authentication contract or dependencies were changed.

## Implemented

- Official logo: inspected `client/public/circlelogo.jpeg` (1254×1254, white background, symbol only). A connected background trim produces `circle-logo.png` at 706×728 with 12px transparent padding. The original file remains unchanged. Navbar, mobile header, Reels sidebar and login/register share Next Image with reserved aspect ratio and responsive sizes. The favicon and Next icon use the same artwork, padded to a square rather than stretched. `node scripts/prepare-circle-logo.mjs` reproduces the derivatives.
- Native `loop` on every Reel; no loop-driven navigation, source reload, replay effect or player remount. Feed videos retain their replay behavior. Manual pause and shared playback ownership remain intact.
- One browser-local `{startMuted: boolean}` preference, default `true`, stored under `circle.video-preferences.v1`. Reels, feed players and the Settings “Video Playback” switch share it; storage events synchronize tabs. The backend has no existing audio preference field. The browser-local setting is therefore browser-wide, rather than synchronized between devices/accounts.
- Unmuted autoplay gets one muted fallback without changing the saved preference. A visible Unmute hint and control allow a trusted interaction. Stale fallback completions cannot pause a newer playback attempt. Audio changes do not override manual pause.
- The bottom playback dock contains the time row and seek slider. Media, readability scrim, creator overlay, controls and progress have deliberate layers. Obsolete floating progress/mute and caption-gradient CSS was removed. The 3px track remains inside the player, separate from the time label. Metadata drives duration; unknown duration disables seeking. Time/progress updates use DOM refs and animation frames without per-frame React rendering. Empty sources do not erase retained playback position.
- Actual feed/quoted/detail video media exposes an independent Open in Reels action carrying both encoded post and media IDs. The viewer fetches the requested post outside the paginated feed, handles missing/private/restricted targets and preserves direct URL behavior. Touch/wheel interaction with the seek controls cannot advance the carousel.
- Creator avatar and follow badge are separate interactions. Existing APIs handle public follows and private requests. Pending requests disable duplicates; followed creators show a check; own/blocked creators have no plus action. Profile cache updates immediately and feed/suggestion caches refresh. Controls use Lucide icons, accessible labels, focus rings and reduced-motion-aware transitions.

## Checks actually run

| Command/check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed, no warnings |
| `npm.cmd run build` | Passed, existing routes and icon generated |
| `npm.cmd test` | 20 production route/API/session/cache fixture groups passed |
| `npm.cmd run test:video` | 6 source lifecycle and playback DOM checks passed |
| `npm.cmd run test:video-experience` | 14 coordinator, fallback, looping/progress, source-budget, pause, sizing and cleanup groups passed |
| `npm.cmd run test:upgrade` | 13 gesture, comment stability, exact-media deep-link/restricted-state, blocked follow and profile/crop groups passed |
| `npm.cmd run test:reels-polish` | 5 Settings/player/storage, actual feed deep-link, real follow-control/cache and rapid-navigation race groups passed |
| `npm.cmd run test:profile` | 3 existing profile editor groups passed |
| Logo pixel/format check | All 273,762 opaque crop pixels retain the original decoded RGB; transparent margins and 48px PNG-in-ICO structure verified |

The production server served the cropped logo, favicon, icon and optimized 96px WebP successfully. Login/register HTML uses the official image and homepage brand link. The exact post/media Reels URL served directly. DOM tests verify target selection after a fresh mount, including a requested video absent from the feed; production route tests do not claim live browser hydration.

The crop was visually inspected, including 100px and 40px composites on black: [asset contrast check](circle-logo-dark-check.png). This is an image asset check, not an application screenshot.

## Verification limits

Media play/pause, IntersectionObserver and API writes in the DOM suites are mocked. No live follow operations, real account mutations or native decoding were tested. Native looping is verified as a stable video attribute with progress reset and no application reload; actual decoder loop smoothness requires browser QA.

Sizing arithmetic passes at 1920×1080, 1440×900 and 1280×800 (also 1024×768) with portrait, landscape, square and 4:3 sources, comments open/closed and engagement/navigation clearance. No enabled browser surface was available. Rendered responsive layout at those desktop sizes and 390×844 / 375×812 remains unverified, along with fullscreen, iOS safe areas, real touch seeking and browser-specific autoplay permission behavior.

The previous [video experience record](VIDEO_EXPERIENCE_VERIFICATION.md) contains earlier read-only live media transport checks; those checks were not repeated for this frontend-only polish.
