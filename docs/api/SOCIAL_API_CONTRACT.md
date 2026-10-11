# Social API Contract

**Version:** 1.3.0 (v1, frozen; 1.1–1.3 are additive, with one tightening noted below) · **Generated:** 2026-10-11 · **Machine-readable spec:** [`openapi.json`](./openapi.json)

This document is the integration contract between the NestJS backend (`server/`) and the Next.js frontend (`client/`).
The OpenAPI document is the source of truth for paths and types; this file explains behaviour the schema cannot express.
**No breaking change will be made to v1 without a version bump.** Additive changes (new endpoints, new optional request
fields, new response fields) may happen — clients must ignore unknown response fields.

**Changelog** — 1.3.0: admin control center API (`/api/admin/*`, tags `Admin ·`); member inbox
(`GET /users/me/inbox`, `GET /users/me/inbox/unread-count`, `POST /users/me/inbox/read`) for announcements and policy warnings;
public `GET /platform/config` (feature flags, limits, read-only mode). New enum values (clients must tolerate unknown values):
`UserRole` `SUPPORT`/`SUPER_ADMIN`, `UserStatus` `BANNED`, `ReportStatus` `IN_REVIEW`. New error codes: `FEATURE_DISABLED` (403),
`READ_ONLY_MODE` (503), `STEP_UP_REQUIRED`, `INSUFFICIENT_RANK` (403), `LAST_SUPER_ADMIN`, `INVALID_STATE` (409).
**Tightened:** the legacy `PATCH /moderation/users/{id}/role` now requires a step-up token (`X-Step-Up-Token`) and follows the same
rank rules as `/admin/users/{id}/role`; moderated (hidden/removed) posts and comments are invisible to members.
1.2.0 (additive): `GET /feed/reels` (video posts feed).
1.1.0 (additive): `NotificationDto.followRequestStatus`, `GET /users/me/suggestions`; accepted follow
requests now stay in the notification list (status `ACCEPTED`); `CreatePostDto.content` is correctly typed as `string | null`.

---

## 1. Base URLs & documentation

| What | URL (local dev, `PORT=3002`) |
|---|---|
| API base | `http://localhost:3002/api` |
| Swagger UI | `http://localhost:3002/api/docs` |
| OpenAPI JSON | `http://localhost:3002/api/docs-json` |
| OpenAPI YAML | `http://localhost:3002/api/docs-yaml` |
| Exported spec (repo) | `docs/api/openapi.json` (regenerate: `cd server && npm run openapi:export`) |

All paths below already include the global prefix `/api` (configurable via `API_PREFIX`; Swagger via `SWAGGER_PATH`).
CORS allows the origins in `CORS_ORIGINS` (default `http://localhost:3000`).

**Generating a typed client** (recommended):

```bash
npx openapi-typescript ../docs/api/openapi.json -o src/lib/api/schema.d.ts   # types (verified to compile under --strict)
# then e.g. openapi-fetch: createClient<paths>({ baseUrl: process.env.NEXT_PUBLIC_API_URL })
```

Every operation has a stable, unique `operationId` (`<resource><Action>`, e.g. `postsCreate`, `feedFollowing`) and every
schema is named (`PostDto`, `PaginatedPost`, `ErrorResponseDto`, enums such as `PostKind`, `ErrorCode`).

---

## 2. Authentication

1. `POST /api/auth/register` or `POST /api/auth/login` → `AuthResponseDto`:
   ```json
   {
     "tokenType": "Bearer",
     "accessToken": "eyJ…",  "accessTokenExpiresAt": "2026-10-11T12:15:00.000Z",
     "refreshToken": "eyJ…", "refreshTokenExpiresAt": "2026-10-18T12:00:00.000Z",
     "user": { "id": "…", "username": "jane_doe", "email": "jane@example.com", "…": "MeDto" }
   }
   ```
2. Send `Authorization: Bearer <accessToken>` on every request that needs a user.
3. Before/at `accessTokenExpiresAt`, or on a `401` with `code: "INVALID_TOKEN"`, call
   `POST /api/auth/refresh { "refreshToken" }` → a **new pair**. Replace both tokens.
4. `POST /api/auth/logout` revokes the current session server-side (the access token stops working immediately).
   `POST /api/auth/logout-all` revokes every session. `POST /api/auth/change-password` revokes all *other* sessions.

**Rules the client must follow**

- **Refresh tokens are single-use.** Replaying a used refresh token is treated as theft and revokes the whole session.
  Serialise refreshes (one in-flight refresh shared by all requests/tabs; e.g. a mutex or `BroadcastChannel`).
- Login errors are deliberately generic: unknown account and wrong password both return `401 INVALID_CREDENTIALS`.
  `403 ACCOUNT_SUSPENDED` is only returned after a correct password.
- Registration conflicts return `409 ACCOUNT_CONFLICT` without saying whether email or username was taken.
- **Public routes with optional auth** (feeds, profiles, posts, comments, search): send the token when you have one to get
  viewer flags (`isLiked`, `isFollowing`…). If you send an **invalid/expired** token you get `401` (not anonymous data) — refresh and retry.
- Token storage recommendation for Next.js: keep the refresh token in an httpOnly cookie set by a Next.js route handler / server action
  (BFF pattern) and the access token in memory. The API itself is cookie-free (Bearer only).
- Rate limits: 300 req/min/IP globally; `register`, `login`, `change-password` 10/min/IP; `refresh` 30/min/IP → `429 RATE_LIMITED`
  (honour `Retry-After`).
- Password policy: 8–128 chars, at least one letter and one digit. Usernames: `^[A-Za-z0-9_]{3,30}$`, case-insensitively unique,
  original casing preserved; some names are reserved (`me`, `admin`, `settings`, …).

---

## 3. Conventions

### IDs, timestamps, text
- All ids are UUID strings. All timestamps are ISO 8601 UTC with milliseconds (`2026-10-11T12:00:00.000Z`).
- User-generated text (`content`, `bio`, …) is **plain text**: render as text (React escapes by default), never as HTML.
  The server trims, NFC-normalises and strips control characters; newlines are preserved in post/comment content and bio.
- Nullable fields are always present with `null` (never omitted).

### Pagination (all list endpoints)
```json
{ "items": [ … ], "nextCursor": "eyJ2Ijpb…", "hasMore": true }
```
- Query: `?limit=1..50` (default 20) and `?cursor=<nextCursor>`. Stop when `hasMore` is false / `nextCursor` is `null`.
- Cursors are opaque; never build or modify them. A malformed cursor → `400 INVALID_CURSOR`.
- Ordering is deterministic (ties broken by id). Newest-first unless stated (replies: oldest-first).

### Errors (every non-2xx response)
```json
{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "Validation failed",
  "details": [ { "field": "email", "message": "email must be a valid email address" } ] }
```
Branch on `code`, show `message`; for `VALIDATION_ERROR` map `details[].field` to form fields. Unknown body properties are rejected.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body/query/path validation failed (`details` lists fields) |
| `BAD_REQUEST` | 400 | Malformed request / invalid operation |
| `INVALID_CURSOR` | 400 | Bad pagination cursor |
| `WRONG_PASSWORD` | 400 | `change-password` current password incorrect |
| `CANNOT_FOLLOW_SELF`, `CANNOT_BLOCK_SELF`, `CANNOT_REPORT_SELF` | 400 | Self-targeted action |
| `INVALID_MEDIA` | 400 | Media not usable (not ready, duplicate, video where image required, corrupt image) |
| `UNAUTHORIZED` | 401 | No token on a protected route |
| `INVALID_TOKEN` | 401 | Access token invalid/expired/revoked → refresh |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token invalid/expired/reused → log in again |
| `INVALID_CREDENTIALS` | 401 / 403 | Login failed (401) · wrong password on `POST /admin/step-up` (403, the session stays valid) |
| `FORBIDDEN` | 403 | Not owner / insufficient role / bad signed URL |
| `ACCOUNT_SUSPENDED` | 403 | Account suspended, banned or deactivated (message says which) |
| `FEATURE_DISABLED` | 403 | An administrator turned this feature off (see `GET /platform/config`) |
| `STEP_UP_REQUIRED` | 403 | Sensitive admin action without a valid `X-Step-Up-Token` |
| `INSUFFICIENT_RANK` | 403 | Target account has an equal or higher role |
| `PRIVATE_ACCOUNT` | 403 | Content of a private account you don't follow |
| `BLOCKED` | 403 | You blocked this user (unblock first) |
| `NOT_FOUND`, `USER_NOT_FOUND`, `POST_NOT_FOUND`, `COMMENT_NOT_FOUND`, `MEDIA_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `REPORT_NOT_FOUND` | 404 | Missing **or not visible to you** (the API never reveals hidden resources) |
| `INVALID_STATE`, `LAST_SUPER_ADMIN` | 409 | Admin action not allowed in the current state |
| `CONFLICT`, `ACCOUNT_CONFLICT`, `USERNAME_TAKEN`, `ALREADY_REPORTED`, `MEDIA_IN_USE` | 409 | State conflict |
| `FILE_TOO_LARGE` | 413 | Upload over the limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | File content is not an allowed image/video |
| `MAX_DEPTH_EXCEEDED`, `POST_NOT_REPOSTABLE`, `POST_NOT_EDITABLE` | 422 | Valid request not allowed in current state |
| `RATE_LIMITED` | 429 | Too many requests |
| `READ_ONLY_MODE` | 503 | Platform is read-only for members; `message` is the admin-provided notice |
| `INTERNAL_ERROR` | 500 | Unexpected; include the `X-Request-Id` response header in bug reports |

### Idempotent toggles
Like, bookmark, repost, follow, block and their inverses are idempotent: repeating them returns `200` with the current state
(`{ liked, likeCount }`, `{ bookmarked, bookmarkCount }`, `{ reposted, repostCount, repostId }`, `{ status, followerCount }`,
`{ isBlocking }`). Use the returned counters to reconcile optimistic UI.

---

## 4. Core models (abridged — see `openapi.json` for full schemas)

```ts
type UserSummary = { id; username; displayName; avatarUrl: string|null; isPrivate: boolean };
type UserListItem = UserSummary & { bio: string|null; followerCount; isFollowing; followsYou };
type UserProfile = UserSummary & { bio; location; website; coverUrl; followerCount; followingCount; postCount; createdAt;
                                   isSelf; isFollowing; followsYou; isFollowRequested; isBlocking; canViewContent };
type Me = { id; username; email; displayName; avatarUrl; coverUrl; bio; location; website; isPrivate;
            role: 'USER'|'MODERATOR'|'ADMIN'; status; followerCount; followingCount; postCount; pendingFollowRequestCount; createdAt; updatedAt };

type Media = { id; type: 'IMAGE'|'VIDEO'; status: 'PROCESSING'|'READY'|'FAILED'; url; mimeType; sizeBytes;
               width: number|null; height: number|null; durationMs: number|null; createdAt };

type ReferencedPost = {
  id; kind: 'POST'|'REPOST'|'QUOTE'; author: UserSummary; content: string|null; media: Media[];   // media in display order
  visibility: 'PUBLIC'|'FOLLOWERS'; referencedPostId: string|null;
  likeCount; commentCount; repostCount; quoteCount; bookmarkCount;
  isLiked; isBookmarked; isReposted; isFollowingAuthor;                                           // false when anonymous
  createdAt; updatedAt; editedAt: string|null };
type Post = ReferencedPost & { referencedPost: ReferencedPost|null; referencedPostUnavailable: boolean };

type Comment = { id; postId; parentId: string|null; depth; status: 'ACTIVE'|'DELETED'|'REMOVED';
                 author: UserSummary|null; content: string|null; likeCount; replyCount; hasReplies; isLiked; canReply;
                 createdAt; updatedAt; editedAt };

type Notification = { id; type: NotificationType; actor: UserSummary; postId: string|null; commentId: string|null;
                      preview: string|null; followRequestStatus: 'PENDING'|'ACCEPTED'|'UNAVAILABLE'|null;
                      isRead: boolean; createdAt };
type SuggestedUser = UserListItem & { mutualFollowerCount: number };
```

**Every feed, profile timeline, bookmark list, quote list and post search returns the same `Post` shape** (`PaginatedPost`).

---

## 5. Behavioural rules

### Rendering posts (`kind`)
| `kind` | Render |
|---|---|
| `POST` | `author`, `content`, `media` |
| `REPOST` | "↻ `author.displayName` reposted" + the **`referencedPost`** card. Counters/flags/actions (like, bookmark, reply) use `referencedPost`. The wrapper's own counters are always 0. |
| `QUOTE` | `author`, `content`, `media` + embedded `referencedPost` card (one level deep; a quoted quote shows only its own content). |

If `referencedPostUnavailable` is `true`, show "This post is unavailable" instead of the embed. Simple reposts of
unavailable posts are filtered out of timelines. Actions sent to a REPOST id are applied to its original, and the response
contains the original's id. Undo a repost with `DELETE /posts/{originalId}/repost` (or `DELETE /posts/{repostId}`).

Only `PUBLIC` posts of public accounts can be reposted or quoted (`422 POST_NOT_REPOSTABLE`), so reposts never widen an audience.

### Visibility
- `PUBLIC` post of a public account: everyone. `FOLLOWERS` post, or any post of a **private** account: author + approved followers.
- Blocks are bidirectional: neither party sees the other's posts, comments, profile (the blocked user gets `404`) or interactions.
- Moderator-removed posts and content of suspended accounts behave as non-existent (`404`). Author-deleted posts are permanently removed with their unused media files; old signed media URLs return `404`. Permanent admin deletion uses the documented `/api/admin/*/delete` endpoints and cannot be restored.
- `UserProfile.canViewContent=false` → show a locked profile; `/users/{id}/posts|followers|following` return `403 PRIVATE_ACCOUNT`.

### Follows
- `POST /users/{id}/follow` → `status: FOLLOWING` (public account) or `REQUESTED` (private). `DELETE` unfollows **or cancels a pending request**.
- Owners manage requests via `/users/me/follow-requests` (accept/decline). Switching to public auto-approves pending requests.
- **Approving from notifications:** a `FOLLOW_REQUEST` notification with `followRequestStatus: "PENDING"` can be
  accepted/declined directly with `POST /users/me/follow-requests/{actor.id}/accept` / `DELETE /users/me/follow-requests/{actor.id}`
  (the request is identified by the requester id = `actor.id`; this is the same endpoint Settings uses). After accepting, the
  notification stays with status `ACCEPTED`; declined or sender-cancelled requests remove it. A `404 NOT_FOUND` from accept means
  the request was already handled elsewhere or cancelled — refetch notifications and the request list.
- **Suggestions:** `GET /users/me/suggestions?limit=1..20` (default 5) → `{ items: SuggestedUser[] }`, excluding you, accounts
  you follow or already requested, blocked accounts and inactive accounts; ranked by `mutualFollowerCount`.
- Profile lookup is by **username** (`/users/{username}`, case-insensitive); all other user operations use the **id** from that response.

### Comments
- `GET /posts/{id}/comments?sort=NEWEST|OLDEST|TOP` returns top-level comments; expand with `GET /comments/{id}/replies` when
  `hasReplies` is true (replies are oldest-first). `replyCount` counts live direct replies.
- Max depth is `COMMENT_MAX_DEPTH` (default 6 → depths 0–5). Use `canReply` to hide the reply button.
- Deleted/removed comments that have replies are returned as tombstones (`status: DELETED|REMOVED`, `author` and `content` null)
  so threads stay intact; childless deleted comments disappear. Comment authors and the **post author** may delete comments.

### Media upload flow
1. `POST /api/media` (multipart, field `file`) → `Media` (`status: READY`). Allowed: JPEG, PNG, WebP, GIF (≤10 MB) and MP4, WebM, MOV (≤100 MB).
   Type is detected from file bytes. Images are re-encoded: metadata (EXIF/GPS) stripped, orientation applied, max 2048 px.
2. `POST /api/posts { content?, mediaIds: [id, …] }` — max 4 attachments; array order is display order. Media can be attached once.
3. Unattached uploads are deleted after 24 h. Avatars/covers: `POST /api/users/me/avatar|cover` (multipart, images only).
- `url` fields are **signed and expire** (24–48 h). Use them directly in `<img>/<video>`; don't persist them — refetch the
  resource. For `next/image`, add the API host to `images.remotePatterns` (or use `unoptimized`). Videos support HTTP Range.

### Feeds
| Feed | Contents | Order |
|---|---|---|
| `GET /feed/global` (public) | Public posts + quotes from public accounts (no simple reposts) | newest first |
| `GET /feed/following` (auth) | Own + followed accounts' posts, quotes **and reposts** | newest first |
| `GET /feed/explore` (public) | Public posts/quotes from the last 72 h, ranked | score desc |
| `GET /feed/reels` (public) | Posts/quotes with at least one READY video (no simple reposts); same visibility/block rules | newest first |

**Reels** reuse regular video posts — there is no separate reel entity. Play the first `media` item with
`type: "VIDEO"`. Video `width`/`height` are currently `null` (no transcoder), so players must fit the video inside a
fixed 9:16 frame (`object-fit: contain`) rather than rely on dimensions.

**Profile tabs** use `GET /users/{id}/posts?kinds=…`: *Posts* = `kinds=POST,QUOTE` (content the user authored; a quote
repost is the user's own post), *Reposts* = `kinds=REPOST` (simple reposts, rendered with "Reposted by …" and the
embedded original; reposts of unavailable originals are omitted).

Explore score = `(likes + 2·comments + 3·(reposts+quotes) + bookmarks + 1) / (ageHours + 2)^1.5`. The first page pins the
ranking instant into the cursor, so subsequent pages are consistent.

### Notifications
Polling-compatible: poll `GET /notifications/unread-count` (e.g. every 30–60 s and on focus) and fetch `GET /notifications` when it changes.
Types: `NEW_FOLLOWER`, `FOLLOW_REQUEST`, `FOLLOW_ACCEPTED`, `POST_LIKE`, `COMMENT` (on your post), `COMMENT_REPLY`, `COMMENT_LIKE`,
`REPOST`, `QUOTE_REPOST` (`postId` = the quote). Each event notifies once (like→unlike→like does not re-notify); you are never notified
about your own actions or by users you blocked. `postId` is `null` when the post is no longer available. Realtime delivery may be
added later without changing these shapes.

### Search
`GET /search/users?q=` (fuzzy + prefix on username/display name; leading `@` ignored) and `GET /search/posts?q=` (whole-word full-text,
web-search syntax: `"exact phrase"`, `-exclude`, `a or b`; newest first). `q` is 1–100 chars.

### Reports & moderation
Any user: `POST /reports { targetType: POST|COMMENT|USER, targetId, reason, details? }` (one open report per target per user).
Roles: `USER` < `SUPPORT` < `MODERATOR` < `ADMIN` < `SUPER_ADMIN`, each with a fixed permission set (see `GET /admin/roles`).
Staff may only act on accounts of a strictly lower role and never on themselves. `/moderation/*` (legacy) and `/admin/*` apply the same rules.
The first super administrator is created from the CLI (audited): `cd server && npm run build && npm run user:set-role -- <username> SUPER_ADMIN`.

### Admin control center, inbox and platform config
- Every `/admin/*` endpoint requires a staff role plus the permission named in its description; ordinary users get `403`.
- Sensitive actions (ban/unban, role changes, settings updates, publishing announcements, media cleanup) need
  `X-Step-Up-Token` from `POST /admin/step-up { password }` (valid 10 minutes, bound to the current session).
- Admin lists use page pagination: `?page=&pageSize=` → `{ items, page, pageSize, total }` (not cursors).
- `GET /platform/config` is public: feature flags, post/comment/media limits and `readOnlyMode`. The API enforces every flag;
  clients should hide controls for disabled features. In read-only mode member writes return `503 READ_ONLY_MODE` (staff are exempt).
- Announcements and warnings are delivered to `GET /users/me/inbox` (separate from social notifications); there is no email or push.
- Every admin action is written to an append-only audit log (`GET /admin/audit-logs`).

---

## 6. Endpoints

Auth column: **Bearer** = token required · **Optional** = public, personalised when a token is sent · **Public** = no auth.
"Errors" lists documented error statuses besides `429`.

### Platform

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/platform/config` | `platformConfig` | Public | — | — | 200 PublicPlatformConfigDto | — |

### Media

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| POST | `/api/media` | `mediaUpload` | Bearer | — | multipart `file` | 201 MediaDto | 400, 401, 413, 415 |
| GET | `/api/media/files/{key}` | `mediaFile` | Public | exp, sig | — | 200 binary | 403, 404 |
| GET | `/api/media/{id}` | `mediaGet` | Bearer | — | — | 200 MediaDto | 400, 401, 404 |
| DELETE | `/api/media/{id}` | `mediaRemove` | Bearer | — | — | 204 — | 400, 401, 404, 409 |

### Users

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/users/me` | `usersGetMe` | Bearer | — | — | 200 MeDto | 401 |
| PATCH | `/api/users/me` | `usersUpdateMe` | Bearer | — | UpdateProfileDto | 200 MeDto | 400, 401, 409 |
| POST | `/api/users/me/avatar` | `usersSetAvatar` | Bearer | — | multipart `file` | 200 MeDto | 400, 401, 413, 415 |
| DELETE | `/api/users/me/avatar` | `usersRemoveAvatar` | Bearer | — | — | 200 MeDto | 401 |
| POST | `/api/users/me/cover` | `usersSetCover` | Bearer | — | multipart `file` | 200 MeDto | 400, 401, 413, 415 |
| DELETE | `/api/users/me/cover` | `usersRemoveCover` | Bearer | — | — | 200 MeDto | 401 |
| GET | `/api/users/{username}` | `usersGetProfile` | Optional | — | — | 200 UserProfileDto | 401, 404 |

### Auth

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/register` | `authRegister` | Public | — | RegisterDto | 201 AuthResponseDto | 400, 409 |
| POST | `/api/auth/login` | `authLogin` | Public | — | LoginDto | 200 AuthResponseDto | 400, 401, 403 |
| POST | `/api/auth/refresh` | `authRefresh` | Public | — | RefreshTokenDto | 200 AuthResponseDto | 400, 401, 403 |
| POST | `/api/auth/logout` | `authLogout` | Bearer | — | — | 204 — | 401 |
| POST | `/api/auth/logout-all` | `authLogoutAll` | Bearer | — | — | 204 — | 401 |
| POST | `/api/auth/change-password` | `authChangePassword` | Bearer | — | ChangePasswordDto | 204 — | 400, 401 |

### Notifications

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/notifications` | `notificationsList` | Bearer | cursor, limit, unreadOnly | — | 200 PaginatedNotification | 400, 401 |
| GET | `/api/notifications/unread-count` | `notificationsUnreadCount` | Bearer | — | — | 200 CountDto | 401 |
| POST | `/api/notifications/read-all` | `notificationsMarkAllRead` | Bearer | — | — | 200 MarkAllReadResultDto | 401 |
| POST | `/api/notifications/{id}/read` | `notificationsMarkRead` | Bearer | — | — | 204 — | 400, 401, 404 |

### Follows

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/users/me/follow-requests` | `followsListRequests` | Bearer | cursor, limit | — | 200 PaginatedFollowRequest | 400, 401 |
| POST | `/api/users/me/follow-requests/{userId}/accept` | `followsAccept` | Bearer | — | — | 204 — | 400, 401, 404 |
| DELETE | `/api/users/me/follow-requests/{userId}` | `followsReject` | Bearer | — | — | 204 — | 400, 401 |
| DELETE | `/api/users/me/followers/{userId}` | `followsRemoveFollower` | Bearer | — | — | 204 — | 400, 401 |
| GET | `/api/users/me/suggestions` | `followsSuggestions` | Bearer | limit | — | 200 SuggestedUsersDto | 400, 401 |
| GET | `/api/users/me/blocks` | `followsListBlocks` | Bearer | cursor, limit | — | 200 PaginatedBlockedUser | 400, 401 |
| POST | `/api/users/{id}/follow` | `followsFollow` | Bearer | — | — | 200 FollowResultDto | 400, 401, 403, 404 |
| DELETE | `/api/users/{id}/follow` | `followsUnfollow` | Bearer | — | — | 200 FollowResultDto | 400, 401, 404 |
| POST | `/api/users/{id}/block` | `followsBlock` | Bearer | — | — | 200 BlockResultDto | 400, 401, 404 |
| DELETE | `/api/users/{id}/block` | `followsUnblock` | Bearer | — | — | 200 BlockResultDto | 400, 401 |
| GET | `/api/users/{id}/followers` | `followsFollowers` | Optional | cursor, limit | — | 200 PaginatedUserListItem | 400, 401, 403, 404 |
| GET | `/api/users/{id}/following` | `followsFollowing` | Optional | cursor, limit | — | 200 PaginatedUserListItem | 400, 401, 403, 404 |

### Posts

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| POST | `/api/posts` | `postsCreate` | Bearer | — | CreatePostDto | 201 PostDto | 400, 401, 404, 409 |
| GET | `/api/posts/{id}` | `postsGet` | Optional | — | — | 200 PostDto | 400, 401, 404 |
| PATCH | `/api/posts/{id}` | `postsUpdate` | Bearer | — | UpdatePostDto | 200 PostDto | 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/posts/{id}` | `postsRemove` | Bearer | — | — | 204 — | 400, 401, 403, 404 |
| GET | `/api/posts/{id}/engagement` | `postsEngagement` | Optional | — | — | 200 EngagementSummaryDto | 400, 401, 404 |
| GET | `/api/users/{id}/posts` | `postsByUser` | Optional | cursor, limit, kinds | — | 200 PaginatedPost | 400, 401, 403, 404 |

### Likes

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| POST | `/api/posts/{id}/like` | `likesLikePost` | Bearer | — | — | 200 LikeResultDto | 400, 401, 404 |
| DELETE | `/api/posts/{id}/like` | `likesUnlikePost` | Bearer | — | — | 200 LikeResultDto | 400, 401, 404 |
| GET | `/api/posts/{id}/likes` | `likesLikers` | Optional | cursor, limit | — | 200 PaginatedUserListItem | 400, 401, 404 |
| POST | `/api/comments/{id}/like` | `likesLikeComment` | Bearer | — | — | 200 LikeResultDto | 400, 401, 404 |
| DELETE | `/api/comments/{id}/like` | `likesUnlikeComment` | Bearer | — | — | 200 LikeResultDto | 400, 401, 404 |

### Comments

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/posts/{id}/comments` | `commentsListForPost` | Optional | cursor, limit, sort | — | 200 PaginatedComment | 400, 401, 404 |
| POST | `/api/posts/{id}/comments` | `commentsCreate` | Bearer | — | CreateCommentDto | 201 CommentDto | 400, 401, 404 |
| GET | `/api/comments/{id}` | `commentsGet` | Optional | — | — | 200 CommentDto | 400, 401, 404 |
| PATCH | `/api/comments/{id}` | `commentsUpdate` | Bearer | — | UpdateCommentDto | 200 CommentDto | 400, 401, 403, 404 |
| DELETE | `/api/comments/{id}` | `commentsRemove` | Bearer | — | — | 204 — | 400, 401, 403, 404 |
| GET | `/api/comments/{id}/replies` | `commentsReplies` | Optional | cursor, limit | — | 200 PaginatedComment | 400, 401, 404 |
| POST | `/api/comments/{id}/replies` | `commentsReply` | Bearer | — | CreateCommentDto | 201 CommentDto | 400, 401, 404, 422 |

### Bookmarks

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/users/me/bookmarks` | `bookmarksList` | Bearer | cursor, limit | — | 200 PaginatedPost | 400, 401 |
| POST | `/api/posts/{id}/bookmark` | `bookmarksAdd` | Bearer | — | — | 200 BookmarkResultDto | 400, 401, 404 |
| DELETE | `/api/posts/{id}/bookmark` | `bookmarksRemove` | Bearer | — | — | 200 BookmarkResultDto | 400, 401, 404 |

### Reposts

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| POST | `/api/posts/{id}/repost` | `repostsRepost` | Bearer | — | — | 200 RepostResultDto | 400, 401, 404, 422 |
| DELETE | `/api/posts/{id}/repost` | `repostsUndo` | Bearer | — | — | 200 RepostResultDto | 400, 401, 404 |
| POST | `/api/posts/{id}/quote` | `repostsQuote` | Bearer | — | CreatePostDto | 201 PostDto | 400, 401, 404, 409, 422 |
| GET | `/api/posts/{id}/reposts` | `repostsReposters` | Optional | cursor, limit | — | 200 PaginatedUserListItem | 400, 401, 404 |
| GET | `/api/posts/{id}/quotes` | `repostsQuotes` | Optional | cursor, limit | — | 200 PaginatedPost | 400, 401, 404 |

### Feed

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/feed/global` | `feedGlobal` | Optional | cursor, limit | — | 200 PaginatedPost | 400, 401 |
| GET | `/api/feed/following` | `feedFollowing` | Bearer | cursor, limit | — | 200 PaginatedPost | 400, 401 |
| GET | `/api/feed/reels` | `feedReels` | Optional | cursor, limit | — | 200 PaginatedPost | 400, 401 |
| GET | `/api/feed/explore` | `feedExplore` | Optional | cursor, limit | — | 200 PaginatedPost | 400, 401 |

### Search

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/search/users` | `searchUsers` | Optional | cursor, limit, q | — | 200 PaginatedUserListItem | 400, 401 |
| GET | `/api/search/posts` | `searchPosts` | Optional | cursor, limit, q | — | 200 PaginatedPost | 400, 401 |

### Reports

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| POST | `/api/reports` | `reportsCreate` | Bearer | — | CreateReportDto | 201 ReportDto | 400, 401, 404, 409 |

### Moderation

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/moderation/reports` | `moderationList` | Bearer | cursor, limit, status, targetType | — | 200 PaginatedModerationReport | 400, 401, 403 |
| PATCH | `/api/moderation/reports/{id}` | `moderationResolve` | Bearer | — | ResolveReportDto | 200 ModerationReportDto | 400, 401, 403, 404 |
| POST | `/api/moderation/posts/{id}/remove` | `moderationRemovePost` | Bearer | — | — | 200 ModerationResultDto | 400, 401, 403, 404 |
| POST | `/api/moderation/posts/{id}/restore` | `moderationRestorePost` | Bearer | — | — | 200 ModerationResultDto | 400, 401, 403, 404 |
| POST | `/api/moderation/comments/{id}/remove` | `moderationRemoveComment` | Bearer | — | — | 200 ModerationResultDto | 400, 401, 403, 404 |
| POST | `/api/moderation/comments/{id}/restore` | `moderationRestoreComment` | Bearer | — | — | 200 ModerationResultDto | 400, 401, 403, 404 |
| POST | `/api/moderation/users/{id}/suspend` | `moderationSuspend` | Bearer | — | — | 200 ModerationResultDto | 400, 401, 403, 404 |
| POST | `/api/moderation/users/{id}/unsuspend` | `moderationUnsuspend` | Bearer | — | — | 200 ModerationResultDto | 400, 401, 403, 404 |
| PATCH | `/api/moderation/users/{id}/role` | `moderationSetRole` | Bearer | — | SetRoleDto | 200 ModerationResultDto | 400, 401, 403, 404 |

### Inbox

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/users/me/inbox` | `inboxList` | Bearer | cursor, limit | — | 200 PaginatedInboxItem | 400, 401 |
| GET | `/api/users/me/inbox/unread-count` | `inboxUnread` | Bearer | — | — | 200 CountDto | 401 |
| POST | `/api/users/me/inbox/read` | `inboxRead` | Bearer | — | MarkInboxReadDto | 200 MarkInboxReadResultDto | 400, 401 |

### Admin · Core

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/me` | `adminCoreMe` | Bearer | — | — | 200 AdminMeDto | 401, 403 |
| POST | `/api/admin/step-up` | `adminCoreStepUpToken` | Bearer | — | StepUpRequestDto | 200 StepUpResponseDto | 400, 401, 403 |
| GET | `/api/admin/dashboard` | `adminCoreDashboard` | Bearer | — | — | 200 DashboardDto | 401, 403 |

### Admin · Analytics

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/analytics/overview` | `adminAnalyticsOverview` | Bearer | — | — | 200 OverviewDto | 401, 403 |
| GET | `/api/admin/analytics/timeseries` | `adminAnalyticsTimeseries` | Bearer | metrics, from, to, interval | — | 200 TimeseriesResponseDto | 400, 401, 403 |
| GET | `/api/admin/analytics/top-content` | `adminAnalyticsTop` | Bearer | by, kind, from, to, limit | — | 200 TopContentResponseDto | 400, 401, 403 |

### Admin · Users

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/users` | `adminUsersList` | Bearer | page, pageSize, order, q, status, role, staff, createdFrom, createdTo, sort | — | 200 AdminPageAdminUserRow | 400, 401, 403 |
| GET | `/api/admin/users/{id}` | `adminUsersDetail` | Bearer | — | — | 200 AdminUserDetailDto | 400, 401, 403, 404 |
| POST | `/api/admin/users/{id}/suspend` | `adminUsersSuspend` | Bearer | — | SuspendUserDto | 200 AccountStatusResultDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/users/{id}/reinstate` | `adminUsersReinstate` | Bearer | — | ReasonDto | 200 AccountStatusResultDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/users/{id}/ban` | `adminUsersBan` | Bearer + `X-Step-Up-Token` | — | BanUserDto | 200 AccountStatusResultDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/users/{id}/unban` | `adminUsersUnban` | Bearer + `X-Step-Up-Token` | — | ReasonDto | 200 AccountStatusResultDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/users/{id}/warnings` | `adminUsersWarn` | Bearer | — | WarnUserDto | 201 WarningCreatedDto | 400, 401, 403, 404 |
| PATCH | `/api/admin/users/{id}/role` | `adminUsersRole` | Bearer + `X-Step-Up-Token` | — | ChangeRoleDto | 200 RoleResultDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/users/{id}/content/moderation` | `adminUsersModerateContent` | Bearer + `X-Step-Up-Token` | — | BulkModerateUserContentDto | 200 BulkModerationResultDto | 400, 401, 403, 404 |

### Admin · Content

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/posts` | `adminContentPosts` | Bearer | page, pageSize, order, from, to, q, status, reported, authorId, sort, type, kind | — | 200 AdminPageAdminPostRow | 400, 401, 403 |
| GET | `/api/admin/posts/{id}` | `adminContentPost` | Bearer | — | — | 200 AdminPostDetailDto | 400, 401, 403, 404 |
| POST | `/api/admin/posts/{id}/moderation` | `adminContentModeratePost` | Bearer | — | ModerateContentDto | 200 ModerationOutcomeDto | 400, 401, 403, 404 |
| GET | `/api/admin/reels` | `adminContentReels` | Bearer | page, pageSize, order, from, to, q, status, reported, authorId, sort | — | 200 AdminPageAdminReelRow | 400, 401, 403 |
| GET | `/api/admin/comments` | `adminContentComments` | Bearer | page, pageSize, order, from, to, q, status, reported, authorId, sort, postId | — | 200 AdminPageAdminCommentRow | 400, 401, 403 |
| GET | `/api/admin/comments/{id}` | `adminContentComment` | Bearer | — | — | 200 AdminCommentDetailDto | 400, 401, 403, 404 |
| POST | `/api/admin/comments/{id}/moderation` | `adminContentModerateComment` | Bearer | — | ModerateContentDto | 200 ModerationOutcomeDto | 400, 401, 403, 404 |

### Admin · Media

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/media` | `adminMediaList` | Bearer | page, pageSize, order, from, to, type, usage, status, ownerId, minSize, maxSize, sort | — | 200 AdminPageAdminMediaRow | 400, 401, 403 |
| GET | `/api/admin/media/scan` | `adminMediaScan` | Bearer | limit, afterId | — | 200 MediaScanResultDto | 400, 401, 403 |
| GET | `/api/admin/media/cleanup` | `adminMediaCleanupPreview` | Bearer | — | — | 200 CleanupPreviewDto | 401, 403 |
| POST | `/api/admin/media/cleanup` | `adminMediaCleanup` | Bearer + `X-Step-Up-Token` | — | CleanupExecuteDto | 200 CleanupResultDto | 400, 401, 403 |
| GET | `/api/admin/media/{id}` | `adminMediaDetail` | Bearer | — | — | 200 AdminMediaRowDto | 400, 401, 403, 404 |
| GET | `/api/admin/media/{id}/health` | `adminMediaHealth` | Bearer | — | — | 200 MediaHealthDto | 400, 401, 403, 404 |

### Admin · Reports

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/reports` | `adminReportsList` | Bearer | page, pageSize, order, from, to, status, targetType, reason, assigned, targetId | — | 200 AdminPageAdminReportRow | 400, 401, 403 |
| GET | `/api/admin/reports/{id}` | `adminReportsDetail` | Bearer | — | — | 200 AdminReportDetailDto | 400, 401, 403, 404 |
| PATCH | `/api/admin/reports/{id}/assignee` | `adminReportsAssign` | Bearer | — | AssignReportDto | 200 AdminReportRowDto | 400, 401, 403, 404 |
| PATCH | `/api/admin/reports/{id}/status` | `adminReportsStatus` | Bearer | — | ReportStatusChangeDto | 200 AdminReportRowDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/reports/{id}/notes` | `adminReportsNote` | Bearer | — | CreateReportNoteDto | 201 ReportNoteDto | 400, 401, 403, 404 |
| POST | `/api/admin/reports/{id}/actions` | `adminReportsAct` | Bearer | — | ReportActionDto | 200 AdminReportRowDto | 400, 401, 403, 404, 409 |

### Admin · Announcements

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/announcements` | `adminAnnouncementsList` | Bearer | page, pageSize, order, status | — | 200 AdminPageAnnouncement | 400, 401, 403 |
| POST | `/api/admin/announcements` | `adminAnnouncementsCreate` | Bearer | — | SaveAnnouncementDto | 201 AnnouncementDto | 400, 401, 403 |
| GET | `/api/admin/announcements/{id}` | `adminAnnouncementsGet` | Bearer | — | — | 200 AnnouncementDto | 400, 401, 403, 404 |
| PUT | `/api/admin/announcements/{id}` | `adminAnnouncementsUpdate` | Bearer | — | SaveAnnouncementDto | 200 AnnouncementDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/announcements/{id}/publish` | `adminAnnouncementsPublish` | Bearer + `X-Step-Up-Token` | — | — | 200 AnnouncementDto | 400, 401, 403, 404, 409 |
| POST | `/api/admin/announcements/{id}/archive` | `adminAnnouncementsArchive` | Bearer | — | — | 200 AnnouncementDto | 400, 401, 403, 404 |

### Admin · Settings

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/settings` | `adminSettingsGet` | Bearer | — | — | 200 AdminSettingsResponseDto | 401, 403 |
| PATCH | `/api/admin/settings` | `adminSettingsUpdate` | Bearer + `X-Step-Up-Token` | — | UpdatePlatformSettingsDto | 200 AdminSettingsResponseDto | 400, 401, 403 |

### Admin · System

| Method | Path | operationId | Auth | Query | Request | Success | Errors |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/roles` | `adminSystemRoles` | Bearer | — | — | 200 RolesOverviewDto | 401, 403 |
| GET | `/api/admin/audit-logs` | `adminSystemAudit` | Bearer | page, pageSize, order, from, to, actorId, action, targetType, targetId | — | 200 AdminPageAuditLog | 400, 401, 403 |
| GET | `/api/admin/audit-logs/actions` | `adminSystemActions` | Bearer | — | — | 200 string[] | 401, 403 |
| GET | `/api/admin/system` | `adminSystemSystem` | Bearer | — | — | 200 SystemStatusDto | 401, 403 |

---

---

## 7. Backend operations

### Environment variables
Existing `.env` values are used as-is (`PORT`, `DB_*`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`).
All new variables are optional with safe defaults — see `server/.env.example`. Notable ones:

| Variable | Default | Notes |
|---|---|---|
| `API_PREFIX` / `SWAGGER_PATH` / `SWAGGER_ENABLED` | `api` / `docs` / `true` | Final URLs in §1 |
| `PUBLIC_BASE_URL` | `http://localhost:$PORT` | Origin used in signed media URLs |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated |
| `MEDIA_URL_SECRET` | derived from `JWT_SECRET` | **Set explicitly in production** |
| `MEDIA_LOCAL_DIR` | `./storage/media` | Development storage driver |
| `POST_MAX_LENGTH` / `POST_MAX_MEDIA` / `COMMENT_MAX_LENGTH` / `COMMENT_MAX_DEPTH` | 5000 / 4 / 2000 / 6 | Content limits |
| `THROTTLE_*`, `AUTH_THROTTLE_*` | see §2 | Rate limiting |
| `TRUST_PROXY` | `0` | Set when behind a proxy so rate limits use the client IP |

`DB_SYNCHRONIZE` is **ignored** (a warning is logged): the schema is owned by migrations. `JWT_EXPIRES_IN=1d` in the current `.env`
works, but `15m` is recommended now that refresh rotation exists.

### Commands (in `server/`)
| Command | Purpose |
|---|---|
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply / roll back one / inspect migrations |
| `npm run start:dev` | Dev server |
| `npm test` / `npm run test:e2e` | Unit tests / integration tests (against `<DB_NAME>_test`, created automatically; refuses any DB not ending in `_test`) |
| `npm run openapi:export` | Regenerate `docs/api/openapi.json` (no DB needed) |
| `npm run user:set-role -- <username> <ROLE>` | Grant MODERATOR/ADMIN (after `npm run build`) |

### Known incomplete infrastructure
| Area | Status |
|---|---|
| **Password reset / email verification** | Not implemented — no email provider is configured. Needs an SMTP/transactional provider (e.g. SES, Postmark, Resend) + `MAIL_*` config. Will be added as new endpoints (`POST /auth/forgot-password`, `POST /auth/reset-password`) without changing existing ones. Email change is likewise not exposed. |
| **Production object storage** | Only the local filesystem driver exists (`StorageDriver` interface ready). Multi-instance/serverless deployments need an S3/R2/GCS driver. |
| **Video processing** | Videos are signature-validated and stored as uploaded; no transcoding, thumbnails or duration probing (`width/height/durationMs` are `null`). `VideoProcessor` abstraction ready for ffmpeg/cloud transcoding; `status` already models `PROCESSING`/`FAILED`. |
| **Rate-limit storage** | In-memory per instance; use a shared store (Redis) when scaling horizontally. |
| **Realtime notifications** | Polling only (by design for v1). |
| **Observability** | The pre-existing `@nestjs/observe` module still has placeholder `YOUR_APP_KEY` credentials. |
