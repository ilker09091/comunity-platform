# Circle frontend

Social networking frontend built inside the existing Next.js 16.4 App Router setup. React 19, Tailwind 4, Cache Components, partial prefetching, and the React Compiler remain enabled. No backend source, migrations, or database configuration was changed.

## Run locally

Use the existing npm package manager:

```powershell
cd client
npm.cmd ci
npm.cmd run dev
```

The frontend serves on `http://localhost:3000`. The default backend origin is `http://localhost:3002`. If needed, copy `.env.example` to `.env.local` and set `API_ORIGIN` to the backend **origin**, without `/api`. The generated operation paths already contain `/api`.

For HTTPS deployment, cookies are Secure automatically in production. For an intentional **local HTTP production preview**, set `SESSION_COOKIE_SECURE=false`; retain the default for deployed HTTPS sites. `APP_ORIGIN` optionally supplies the canonical frontend origin behind a reverse proxy. Serve this as a Next.js application, not a static export: the session gateway needs route handlers.

## Pages and behavior

- `/`: public chronological feed, composer, profile overview, shortcuts, activity, and people discovered from public posts.
- `/explore`: ranked feed and debounced, paginated post/user search. `?q=` supports linked searches; `?tab=people` opens people search.
- `/following` and `/saved`: authenticated feeds.
- `/post/[id]`: post details and paginated comments, nested replies, sorting, editing, deletion, and comment likes.
- `/reels`: black video workspace with a 72px icon rail on desktop and an immersive mobile layout using the shared bottom navigation. Desktop players fit native video metadata (portrait, landscape or square); mobile videos preserve their proportions with `object-fit: contain`. One wheel/trackpad gesture or swipe moves one reel; arrows/PageUp/PageDown/J/K also work. Dark desktop comments resize the stage without remounting or restarting the video, and navigation remains available. Mobile comments open a modal bottom sheet and pause background playback while preserving position. `?start=<postId>` opens a specific reel.
- Feed, quoted posts and post details use the same custom video core as Reels: play/pause, mute, seek, replay, supported fullscreen, loading and source-refresh retry. Open in Reels preserves the exact post and media via `?start=<postId>&media=<mediaId>`; the viewer fetches that post independently and handles unavailable/restricted targets. One shared observer selects a video at 60% visibility, retains it down to 45%, and switches only for a visibility advantage of at least 12 percentage points. Only one video plays globally. Manual pause persists until a complete viewport exit; re-entry permits autoplay at the retained position. At most three feed sources are attached, with metadata preloading for inactive candidates. Save-Data/2G/reduced-data suppress autoplay; a trusted tap still plays. Route changes, hidden tabs and open native/modal dialogs pause background playback.
- Reels uses native looping without source reloads or automatic navigation. Feed, Reels and Settings share `{startMuted: boolean}` at `circle.video-preferences.v1` in localStorage, defaulting to muted. The Settings toggle “Start videos with sound” reverses that value. Unmuted autoplay rejection retries muted once without overwriting the preference; a trusted Unmute/Play action can enable sound. Cross-tab changes synchronize mounted players. No backend preferences field was available, so this setting belongs to the browser.
- Creator avatar links and compact follow badges are separate controls. Existing follow APIs handle public follows/private requests; pending requests disable duplicate actions, and profile/suggestion caches synchronize. The official `public/circlelogo.jpeg` remains unchanged; `node scripts/prepare-circle-logo.mjs` reproduces its transparent crop, Next icon and favicon. All existing brand locations use the crop via Next Image.
- `/profile/[username]`: Instagram-style header, Posts tab (`kinds=POST,QUOTE`) and Reposts tab (`kinds=REPOST`) with `?tab=`, follower/following lists, **Edit Profile** for the owner (`?edit=1`, staged changes with previews, upload progress and unsaved-changes protection), and a ⋯ menu with copy link, block/unblock (confirmed) and report. Private/blocked states follow API visibility flags.
- `/settings`: account privacy (private-account switch), password changes, session revocation, follow request management, and blocked accounts. Public profile details are edited from the profile page.
- `/notifications`: All/Unread filters, date groups, unread indicators, mark-all-read, and **Accept/Reject for pending follow requests** (also in the homepage Activity widget, where pending requests are pinned to the top). Settings, Notifications and the widget share one mutation hook (`src/lib/follow-requests.ts`). Notifications poll every 45 seconds and refetch on window focus.
- `/login` and `/register`: backend authentication with server validation messages.

The layout is a CSS grid in an `.app-container` that is 80vw at ≥1440px, 90vw from 1100–1439px (three columns, 24/52/24), 94vw from 768–1099px (two columns, right sidebar hidden) and full width with 14px gutters below 768px (single column, bottom navigation). The header shares the grid template so it aligns with the columns. On mobile the composer opens a focus-trapped native dialog. Images/videos use signed URLs directly; attachments have previews, removal, size/type validation, upload progress, and retryable errors. User text is rendered as escaped plain text.

## API and session architecture

`../docs/api/SOCIAL_API_CONTRACT.md` and `../docs/api/openapi.json` are the sources of truth. Regenerate the checked-in TypeScript schema and operation registry after approved contract changes:

```powershell
npm.cmd run api:generate
```

`src/lib/api/client.ts` provides typed requests by OpenAPI operation ID, cancellation, JSON/multipart handling, and errors. TanStack Query provides pagination, cache invalidation, focus refetching, and bounded retries for reads. Writes are never automatically retried except after an explicit `INVALID_TOKEN` rejection and successful session refresh. `Retry-After` is preserved by the gateway and enforced in the client. Like/bookmark/repost actions optimistically update detail queries, all timelines, saved/search results, and nested quote/repost references; failures roll back and server counters reconcile successful mutations.

`src/app/api/backend/[...path]/route.ts` is a frontend session gateway. It forwards only documented operation paths/methods, rejects invalid paths and cross-origin writes, and adds the backend Bearer token server-side. Both tokens are stored in scoped HttpOnly/SameSite cookies. Auth responses expose only the current user to JavaScript. The gateway rotates refresh tokens and retries expired access tokens, restores sessions, and clears expired/revoked sessions. BroadcastChannel synchronizes account changes between tabs. No tokens are stored in localStorage or sessionStorage.

**Deployment limitation:** refresh rotation uses a shared in-process mutex and short result cache keyed by a hash of the old token. Run a single persistent Next.js instance for this implementation. Before deploying across multiple instances or serverless workers, replace the map with a shared lock/result store; single-use refresh tokens must not rotate concurrently across workers. The backend also documents its own storage/scaling limitations.

## Contract gaps and design assumptions

- No reference image was attached to the provided text. The UI follows the written composition and visual tokens, with slightly darker small text/actions for legibility.
- Suggested users come from `GET /users/me/suggestions` (API 1.1), which excludes you, accounts you follow or requested, and blocked accounts.
- No user replies/media timeline endpoints exist. Profiles expose the supported Posts and Reposts tabs.
- Messaging is a disabled future feature, as requested. Password reset, email verification/change, and realtime notifications have no v1 endpoints and are not invented.
- Messaging and polls are not supported by the API, so they are not shown.
- The CozMeet reference image was not available; the redesign follows the written specification (tokens, proportions, component structure).
- Poppins 400/500/600/700 is bundled through `next/font/local`, with multilingual system fallbacks; builds do not fetch Google Fonts. Native image elements intentionally load expiring signed URLs and blob previews directly.

## Validation

If a production build ever serves stale CSS, delete `.next/cache` (Turbopack's persistent cache did not invalidate `globals.css` through the custom CSS loader rule during the redesign).

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:video
npm.cmd run test:video-experience
npm.cmd run test:reels-polish
npm.cmd run test:upgrade
npm.cmd run test:profile
```

`npm test` requires an existing successful production build. It starts an isolated temporary HTTP API fixture and production Next.js server on free local ports, then tears both down. It checks twelve page routes, including `/reels` and `/profile/edit`, token privacy, cookie attributes, session restoration, concurrent/expired refresh, outage handling, write origin validation, operation allowlisting, post creation, multipart upload forwarding, pagination, rate-limit headers, logout, generated contract paths, and optimistic cache rollback. It does not seed or modify the real backend database.

The video/upgrade/profile suites use jsdom and mocked native playback/API methods to verify Strict Mode source restoration, stable player selection, gestures, comment panel toggling, crop output ratios, dirty field patches and partial save recovery. They do not prove browser decoding or visual layout. `npm.cmd run check:media` performs read-only checks against the running backend (default `http://localhost:3002`, configurable with `MEDIA_CHECK_ORIGIN`), comparing feed URLs, Range headers, codec sample entries and MP4 metadata placement without logging signed URLs.

See [the logo and Reels polish verification record](../docs/CIRCLE_REELS_POLISH_VERIFICATION.md) for current checks and browser QA limits, and [the video experience record](../docs/VIDEO_EXPERIENCE_VERIFICATION.md) for the original source defect, coordinator policy and earlier live media evidence. The earlier [upgrade record](../docs/SOCIAL_UPGRADE_VERIFICATION.md) describes the superseded light Reels layout.

Live backend anonymous feed/search/error behavior can be checked through the running frontend. Authenticated tests use contract fixtures, not a real user account. Browser visual inspection, live browser hydration checks, and keyboard/device interaction tests could not be run because this session exposed no browser surface; those remain manual QA items. Responsive rules and semantic/focus behavior are implemented but have not been visually verified on devices.
