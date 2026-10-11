# Circle Admin Control Center — Architecture

Status: **implemented** (see §9 for verification and §10 for deliberate gaps). API version 1.3.0.

## 1. Current architecture (inspection findings)

| Area | Finding | Reuse |
|---|---|---|
| Repo layout | `server/` NestJS 12 (ESM, TS 6, Vitest), `client/` Next.js 16.4 App Router (React 19, React Compiler, Cache Components), shared contract in `docs/api/` | — |
| ORM / DB | TypeORM 1.x, hand-written reversible SQL migrations (`server/src/database/migrations`), `synchronize` permanently off, PostgreSQL 18 | New migrations only; no table rewrites |
| Auth | Argon2id, HS256 access JWT bound to a server-side `sessions` row (checked on every request), rotating single-use refresh tokens (hashed), global `JwtAuthGuard` + `RolesGuard` | Admin auth is the same session — no second login system |
| Frontend session | BFF gateway `client/src/app/api/backend/[...path]` with HttpOnly cookies; only operations present in the generated OpenAPI registry are forwarded | Admin endpoints become reachable only once documented in OpenAPI |
| Roles | `users.role` enum `USER | MODERATOR | ADMIN`, `users.status` `ACTIVE | SUSPENDED | DEACTIVATED` | Extended (additive enum values) |
| Moderation | `reports` table (OPEN/RESOLVED/DISMISSED), legacy `/moderation/*` endpoints (queue, resolve, remove/restore post & comment, suspend, role) | Kept working; now share the new permission/rank rules and audit log |
| Content | `posts` (POST/REPOST/QUOTE, permanent deletion, `moderation_status`), `comments` (nested, erased placeholders), `post_media`/`media`; Reels are posts with a READY video (`GET /feed/reels`) | Admin views reuse the same tables; deleted media files are removed from storage |
| Visibility | All public read paths require `moderation_status = 'ACTIVE'` and author `status = 'ACTIVE'` (positive checks) | New states (`HIDDEN`, `BANNED`) are automatically invisible to users |
| Media | `StorageDriver` abstraction with local driver, signed URLs, hourly orphan cleanup cron, no transcoder (video width/height/duration unknown server-side) | Health checks use `StorageDriver.resolve` |
| Notifications | Per-recipient rows with actor (user → user events), dedupe keys, polling | Announcements/warnings use a separate "inbox" model (no actor, no fan-out rows) |
| Settings | Only env-based config (`app.config.ts`); no runtime settings | New typed `platform_settings` store layered over env defaults |
| Analytics | No activity tracking; all content tables have `created_at` | New lightweight activity tracking (forward-only) |
| Logging | Structured request logs, `X-Request-Id`, 5xx logged in exception filter | Request id stored on audit events; recent 5xx kept in a sanitized ring buffer for System Status |
| Tests | Vitest e2e against `<DB>_test` (auto-created, truncated), frontend jsdom/fixture suites | Extended with admin/RBAC suites |

## 2. Missing capabilities → schema changes (migrations 1760190000000, 1760190100000)

Additive enum values: `user_role` + `SUPER_ADMIN`, `SUPPORT`; `user_status` + `BANNED`; `moderation_status` + `HIDDEN`; `report_status` + `IN_REVIEW`.

New tables / columns:

| Object | Purpose |
|---|---|
| `users.last_active_at` | Last authenticated activity (written at most every 5 min per user) |
| `user_daily_activity(user_id, day)` | DAU/WAU history — **forward-only from deployment** (no fabricated history) |
| `account_restrictions` | Suspensions (optional expiry) and bans with reason, actor, lift info |
| `user_warnings` | Policy warnings; delivered to the user's inbox, `read_at` = seen |
| `reports.assigned_to_id`, `report_notes` | Assignment and internal moderator notes (never exposed to users) |
| `admin_audit_logs` | Append-only (DB trigger rejects UPDATE/DELETE) audit + moderation history |
| `platform_settings` | Typed runtime settings / feature flags (validated, cached, audited) |
| `announcements`, `announcement_recipients`, `announcement_reads` | Platform announcements without per-user fan-out for "All users" |

Indexes added for admin filters/aggregations (users by created_at/role/status/last activity, comments/likes/reports by created_at, audit by actor/target/action/time).

## 3. Security model

* **Single identity system.** Admins are normal users with a staff role; every admin request is a normal authenticated request (session revocation, suspension and expiry apply).
* **Roles → permissions** (server-side, `server/src/modules/platform/permissions.ts`):

| Permission | SUPPORT | MODERATOR | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|
| users.read, posts.read, reports.read | ✓ | ✓ | ✓ | ✓ |
| users.email.read | ✓ |  | ✓ | ✓ |
| users.warn, users.suspend, posts.moderate, comments.moderate, reels.moderate, reports.resolve, analytics.read |  | ✓ | ✓ | ✓ |
| users.ban, users.roles.manage, media.manage, notifications.broadcast, settings.read, settings.update, audit.read, system.read |  |  | ✓ | ✓ |
| admins.manage (grant/revoke ADMIN and SUPER_ADMIN) |  |  |  | ✓ |

* **Rank rules** (USER 0 < SUPPORT 1 < MODERATOR 2 < ADMIN 3 < SUPER_ADMIN 4): an actor may only act on users of strictly lower rank, may only assign roles strictly below their own rank (SUPER_ADMIN may grant SUPER_ADMIN), can never change their own role/status, and the last active SUPER_ADMIN can never be demoted, suspended or banned. Request bodies cannot carry roles/permissions for the actor — permissions are derived from the DB role on every request.
* **Step-up re-authentication** for high-impact operations (ban, role changes, settings updates, publishing announcements, media cleanup): `POST /admin/step-up` with the password returns a 10-minute token bound to the current session, sent as `X-Step-Up-Token`. A wrong password returns 403 `INVALID_CREDENTIALS` (never 401, so the gateway does not end the session) and is audited as `admin.step_up_failed`; the endpoint is limited to 5 attempts/minute. The client keeps the token in memory only.
* **Bootstrap:** the first SUPER_ADMIN is created explicitly on the server: `cd server && npm run build && npm run user:set-role -- <username> SUPER_ADMIN`. Nothing is granted automatically; no credentials are hardcoded.
* **Read-only maintenance mode** blocks writes for ordinary users only; staff and auth endpoints are exempt, so admins cannot lock themselves out.
* Secrets (DB, JWT, storage, SMTP) are never readable or editable from the admin UI; System Status shows only classifications (environment, versions, health).

## 4. Backend API (`/api/admin/*`, all documented in OpenAPI, tag prefix `Admin ·`)

`AdminModule` (server/src/modules/admin): `me`, `step-up`, `dashboard`, `analytics/*`, `users/*` (list, detail, suspend, reinstate, ban, unban, warn, role), `posts/*`, `comments/*`, `reels`, `media/*` (list, detail, health, cleanup preview/execute), `reports/*` (queue, detail, assign, status, notes, action), `announcements/*`, `settings`, `roles`, `audit-logs`, `system`. Public: `GET /platform/config`; user inbox: `GET /users/me/inbox`, `GET /users/me/inbox/unread-count`, `POST /users/me/inbox/read`.

## 5. Frontend routes (`client/src/app/admin`)

Permanent deletion uses `POST /admin/posts/:id/delete`, `/admin/comments/:id/delete`, and `/admin/users/:id/content/delete`. These require existing moderation permissions, a lower-ranked target and step-up authentication; bulk deletion also requires the target username. The admin UI's **Delete permanently** and **Delete all content permanently** buttons use these endpoints. Hide/restore and older moderation APIs remain available for reversible review. Permanently deleted content cannot be restored.

Media row deletion transactionally queues only its storage key in `media_file_deletions`. Files are unlinked immediately after commit; failures survive restarts and retry every minute. Old signed URLs stop resolving as soon as the media row disappears. Editing away attachments and deleting/replacing profile images use the same process. Previously soft-deleted posts are purged at startup and hourly. Profile/session APIs count remaining active posts directly; deletion also repairs stored counters. Deployments must run `npm run migration:run` before starting the updated backend.

Navigation groups: **Overview** (`/admin` dashboard, `/admin/analytics`) · **Moderation** (`/admin/reports`, `/admin/content` with Posts / Reels / Comments tabs and All / Reported / Hidden / Removed views) · **People** (`/admin/users` with Everyone / Team / Suspended / Banned tabs, `/admin/roles` "Team & roles" with search-and-assign) · **Platform** (`/admin/notifications`, `/admin/media`, `/admin/settings` in tabs) · **System** (`/admin/audit-logs`, `/admin/system`). Detail pages: `/admin/users/[id]`, `/admin/posts/[id]`, `/admin/comments/[id]`, `/admin/reports/[id]`. The old `/admin/posts`, `/admin/reels`, `/admin/comments` and `/admin/moderation` lists redirect to the matching Content tab. List rows carry inline actions (Hide/Restore, ⋯ menu with warn/suspend/ban/change role) with one-tap reason presets. The shell calls `GET /admin/me`; navigation shows only permitted sections; every page also relies on backend 403s (frontend hiding is cosmetic).

## 6. Implementation phases

1. Migrations + RBAC/permission guard + step-up + audit service
2. Activity tracking, restrictions, warnings, inbox
3. Content moderation (posts, comments, reels), media library and health
4. Reports workflow (assign, notes, actions)
5. Announcements, platform settings + enforcement, public config
6. Analytics, roles, audit logs, system status
7. Admin UI shell and pages, user-facing inbox and feature-flag gating
8. Tests, OpenAPI export, documentation

## 7. Risks and compatibility

* Enum additions are non-breaking for existing clients; `CommentStatus` still reports hidden comments as `REMOVED` to users.
* `GET /moderation/*` legacy endpoints remain, now with rank checks and audit logging.
* Settings are cached in-process for ≤15 s; multi-instance deployments see changes within that window.
* Rate limiting and settings caches are per-instance (as documented for the rest of the API).

## 8. Analytics instrumentation design (Reels views)

Reel view/watch-time metrics are **not tracked** and are therefore not displayed. Recommended design: client batches `{postId, startedAt, watchedMs, completed}` events every 15 s or on page hide via `navigator.sendBeacon`; server accepts ≤50 events/request, ignores events < 2 s, dedupes per (viewer|anonymous session, post, 30-minute window) and upserts into a daily aggregate table `reel_daily_stats(post_id, day, starts, completions, watched_ms)` — no per-tick writes.

## 9. Verification (run on 2026-10-11)

| Check | Result |
|---|---|
| Server `npx tsc --noEmit` | passes |
| Server lint (`oxlint --type-aware`) | 0 errors; 12 `no-misused-spread` warnings (same pattern as existing code) |
| Server unit tests (`npm test`) | 7/7 passed |
| Server e2e (`npm run test:e2e`, isolated `*_test` DB) | 71/71 passed across 9 files, including 17 in `test/admin.e2e-spec.ts` (RBAC matrix, privilege escalation, step-up, suspend/expiry/ban/unban, warnings → inbox, hide/restore/tombstone, report workflow, settings validation + enforcement + audit, read-only mode, announcements publish-once/audience/archive, analytics, media cleanup, append-only audit trigger, system status) |
| Migrations | `1760190000000`, `1760190100000`: run → revert → run on the test DB; then applied to the dev DB |
| CLI bootstrap (`user:set-role`) | promotes, writes an audit row, refuses to demote the last active SUPER_ADMIN, rejects unknown users/roles |
| Client `tsc --noEmit`, `eslint`, `next build` | pass |
| Client suites (`test`, `test:video`, `test:video-experience`, `test:reels-polish`, `test:upgrade`, `test:profile`) | all pass (two harnesses got a `@/lib/platform-config` shim) |
| Browser QA (puppeteer, isolated API :3012 on the test DB + web :3010) | 14 admin pages + 4 detail pages at 1440 px and 5 at 390 px: no console errors, no 5xx, no horizontal overflow; per-role navigation (Support/Moderator/Admin/Super admin) and "Not authorized" for members; UI flows: report assign → note → hide → resolve, warn → member inbox, ban with step-up (wrong password rejected, session kept) → login blocked → unban without a second prompt, settings read-only + comments off → member banner/composer notice and 503 on post while staff can post, announcement draft → publish → member inbox + badge, audit log lists every action |

Not verified: real email/push delivery (not implemented), multi-instance deployments (settings cache and step-up are per instance but stateless/DB-backed), very large datasets beyond the indexed queries' design.

## 10. Deliberate gaps

* **Appeals:** suspended/banned users cannot authenticate and removed content is invisible to its author, so a user-facing appeal path would require an unauthenticated appeal channel or email. Not implemented (no fake UI); restrictions can be lifted by staff with an audited reason.
* **Email delivery** is not configured; warnings and announcements are delivered in-app only and the UI states this.
* **Video duration/resolution/thumbnails** are not extracted server-side (no transcoder/probe). The admin UI shows the stored values and says "Size unknown" / "—" when they are null; Reel rows use a video icon instead of a thumbnail.
* **Infrastructure metrics** (CPU/RAM) are not collected and are not shown.
