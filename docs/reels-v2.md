# Reels V2: diagnosis and incremental repair

Inspected on 2026-10-12, before implementation. Scope is recommendation state,
ranking, queue integration and navigation; existing visual layouts stay intact.

## Root causes in the current implementation

- `ReelsService.page` writes `exposed_at` for every returned item. Infinite-query
  prefetch therefore counts as an impression, including later cycles never shown.
- `rank` excludes meaningful history only in cycle 1. Later cycles immediately
  include liked/saved videos without exact-item cooldowns or last-seen priority.
- Additive shuffle raises the nominal normalized score above 1 and can overpower
  real affinity. No content features other than creator relationships are used.
- `watch` chooses the highest exposed cycle per post; `expose` uses the allocation
  cycle. Both can credit a prefetched occurrence instead of the visible one.
- Every player cleanup records a skip even after a full completion. Meaningful
  viewing is capped at two seconds regardless of long-video duration.
- Session ref lives in memory only, expired-session errors have no recovery, and
  cursor loop detection compares only the immediately preceding cursor.
- Wheel/touch listeners attach to `.reels-stage`, which excludes the action rail
  and surrounding workspace. Modal, text selection, pinch, deltaMode and generic
  scroll ownership are not consistently checked.
- Cycle allocation is locked and bounded, but every page counts its entire
  remaining assigned queue; look-ahead should use a bounded EXISTS/window query.

## Repair order

1. Add regression tests that reproduce prefetch-impression and exact liked-item
   prioritization bugs against the current code.
2. Add an additive migration to existing history/impression/session tables for
   durable exposure timestamps, explicit starts and delivery/ranking metadata.
3. Separate hard SQL eligibility, discovery/cooldown tiers and normalized weighted
   ranking. Keep creator and real hashtag affinity separate from exact-item repeat
   eligibility. Relax soft cooldowns only after better tiers are exhausted.
4. Bind events to exact session positions. Require sustained foreground exposure;
   prefetch, native loops and backward navigation never invent new impressions.
5. Keep immutable positions/cursors, independently locked sessions and automatic
   cycles. Use bounded ranking windows and development-only aggregate diagnostics.
6. Use session/cycle/position queue identities, safe expired-session recovery,
   refresh restoration, bounded cursor retries and queued access revalidation.
7. Bind gestures to the existing workspace, respecting comments, controls,
   interactive scroll areas, text selection, open dialogs and pinch gestures.
8. Run PostgreSQL integration tests, frontend integration, actual browser gesture
   checks, query plans and production builds. Record measured results below.

Reference behavior: [wheel events](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event),
[intersection visibility](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API).

Baseline reproduced in an isolated local PostgreSQL 18 cluster: fetching two pages created 6 false exposures; a newly liked Reel ranked ahead of three unseen alternatives. Both regression tests failed as expected before repair. The configured remote PostgreSQL port refused connections, so testing uses a separate `circle_reels_v2_test` database, never production.

## Implemented behavior and operations

Hard eligibility uses existing SQL visibility/moderation, bidirectional blocks,
READY video attachments, reports and reversible Not Interested feedback. These
exclusions never relax. Discovery cycle 1 excludes consumed/liked/saved exact
items; later cycles use tiers: new, previously exposed outside cooldown,
consumed outside cooldown, engaged outside cooldown, then controlled relaxation
of ordinary exposure/watch/engagement cooldowns. Within rediscovery tiers the
least recently shown content wins; creator diversity and deterministic relevance
bands break ties. Positive creator/hashtag affinity applies to other candidates.
Hashtags come only from actual recent likes/saves/reposts/meaningful watches;
missing signals are zero, not invented categories.

Default normalized weights: recency .15, engagement .15, quality .20, creator
.25, content .15, exploration .10. Global completion quality uses a documented
3/10 Bayesian prior. Scores remain 0..1; shuffle is an ordering tie-break, never
an additive score. Candidate windows are bounded at 320 final rows from recent,
oldest, indexed UUID pivot, least-exposed persistent history and alternative-creator windows; allocations contain
at most 80 entries, pagination uses immutable positions and HMAC cursors.
There is no ORDER BY RANDOM or full per-user library ordering in memory.

Server environment tuning (no UI changes):

- REELS_COOLDOWN_EXPOSURE_SECONDS=1800
- REELS_COOLDOWN_WATCH_SECONDS=21600
- REELS_COOLDOWN_ENGAGEMENT_SECONDS=86400
- REELS_WEIGHT_RECENCY / ENGAGEMENT / QUALITY / CREATOR / CONTENT / EXPLORATION
  (nonnegative weights are normalized together; all-zero weights are rejected)
- REELS_SESSION_MAX_ENTRIES=20000 (bounded 1000..100000); the client renews a full
  session without resetting the active queue. Guest exposure state is bounded by
  this limit and the existing 48-hour expiry, authenticated history persists.
- REELS_DIAGNOSTICS=true only emits aggregate candidate/tier/cursor/duration data
  when NODE_ENV=development. No behavioral histories or access tokens are logged.

GET /feed/reels marks delivery only. POST /feed/reels/expose with prepare=true
prepares explicitly active playback, without an impression. Actual impressions
require 60% foreground player visibility continuously for 750ms, confirmed by
visibleMs and delivery elapsed time. Watch events bind to exact session positions,
retain independent sequences across occurrences and are throttled at milestones,
not every second. A backward navigation/exposure retry coalesces the existing
impression, and a native video loop never creates a new recommendation entry.
Meaningful watching is 50% under four seconds, otherwise max(2s,10% of duration),
capped at 8s. Completion is 95% under 2s, 90% over 60s, otherwise 85%. Early skips
are counted once per occurrence and do not include completed/meaningful exits.

Queue identities include session, cycle, immutable position and post ID. Restore
state stores only the active page cursor/entry in account-scoped sessionStorage.
Reload restores that page; older pages remain available in the mounted in-memory
queue. Expired sessions recover without replacing the active playback queue.
Empty/repeated cursor responses stop further requests. New uploads can enter
future allocations without resetting the current entry. A fresh access request
validates each active occurrence before presenting it; 403/404 entries are skipped.

Migration ReelSmartState1760191100000 is additive. It retains existing content,
users and persistent watch aggregates, adds explicit exposure/start metadata and
removes only unstarted legacy temporary exposure marks that previously came from
prefetch. Apply it with the normal deployment migration command before running
new API code. Existing expose clients remain accepted during a rolling update,
but only V2 clients enforce the sustained-visibility protocol.

Deploy using the existing Docker Compose workflow (no importer/admin changes):
`docker compose up -d --build api web`. API startup applies pending migrations.
For native Nest deployments: `npm run migration:run`, then restart the API.
No real/remote database was changed during implementation or testing.

## Browser verification

`tools/test_reels_v2_browser.py` ran against the production Next build in installed
Chrome with real H.264 decoding and fixture APIs restricted to its own QA context.
It verified selected-only impressions, native loop, wheel over stage/workspace/
action rail, comment-scroll exclusion, keyboard backwards and reload restoration.
Mobile Chrome rendering used a 390x844 touch viewport with a dispatched swipe on
the workspace outside the video. Physical iOS Safari and hardware touch gestures
were not tested. Screenshots: docs/qa/reels-v2-desktop.png and reels-v2-mobile.png.
Scale validation uses actual PostgreSQL EXPLAIN ANALYZE on fixture libraries;
a million-item deployed database has not been benchmarked.

Profile-origin Reels keep their existing chronological queue but prepare an independent recommendation session for actual playback history; fetching that session alone does not record an impression. This keeps profile watching from silently disappearing from subsequent discovery signals.

## Final validation

- Backend: 36 PostgreSQL integration checks across V2, existing discovery/cycles
  and Reels suites; all passed on the isolated PostgreSQL 18 test cluster.
- Backend build and 12 existing unit tests passed.
- Frontend typecheck and production build passed after the final source changes.
- 12 V2 gesture/queue/watch checks, 13 existing upgrade integration checks,
  23 production gateway/contract checks and 6 existing media/discovery groups
  passed (DOM/API simulations are explicitly marked in their output).
- Native Chrome production browser checks passed, including profile-origin
  playback history. Desktop/mobile screenshots were rendered and inspected.
- PostgreSQL query-plan tests bounded ranked output at 320 candidates on 480 and
  1,500-video fixtures, with execution below the 2,000ms test ceiling. This is a
  local fixture benchmark, not a production million-video throughput claim.

Primary files: server/src/modules/feed/reels.service.ts, reels-policy.ts,
reels.dto.ts and feed.controller.ts; additive migration 1760191100000;
client/src/components/reels.tsx and reel-player.tsx; client/src/lib/reel-watch.ts,
reel-watch-transport.ts, reel-queue.ts and reel-gestures.ts. Generated Swagger/types
and focused tests accompany these changes. No stylesheet, homepage, profile,
sidebar, video control or admin implementation was modified.
