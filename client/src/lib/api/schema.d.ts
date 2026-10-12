export interface paths {
    "/api/platform/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Public runtime configuration
         * @description Feature flags, content limits and maintenance state set by administrators. Clients should hide disabled features; the API enforces every flag regardless (403 `FEATURE_DISABLED`, 503 `READ_ONLY_MODE`). Cached server-side for up to 15 s.
         */
        get: operations["platformConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start a resumable upload (for large files such as phone videos)
         * @description Send the file in pieces with `POST /media/uploads/{id}/chunks?offset=` (raw bytes, ≤16 MB each; halve the size if a proxy answers 413), then `POST /media/uploads/{id}/complete`. If a piece fails, `GET /media/uploads/{id}` tells you where to continue.
         */
        post: operations["mediaUploadsStart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Progress of a resumable upload */
        get: operations["mediaUploadsStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/uploads/{id}/chunks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Append the next piece (raw bytes, application/octet-stream) */
        post: operations["mediaUploadsChunk"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/uploads/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Finish a resumable upload; returns the media like `POST /media` */
        post: operations["mediaUploadsComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload an image or video
         * @description Uploads a file to be attached to a post (`mediaIds`). Unattached uploads are deleted after MEDIA_ORPHAN_TTL_HOURS (default 24h). Images are re-encoded with metadata stripped and bounded to 2048px. Limits: images 10 MB, videos 100 MB (configurable).
         */
        post: operations["mediaUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/files/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a media file (signed URL)
         * @description Target of the signed `url` fields in responses. Clients should use those URLs verbatim.
         */
        get: operations["mediaFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one of your own uploads */
        get: operations["mediaGet"];
        put?: never;
        post?: never;
        /**
         * Delete an unattached upload
         * @description Media attached to a post or profile cannot be deleted (409 MEDIA_IN_USE).
         */
        delete: operations["mediaRemove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the authenticated user (private profile incl. email) */
        get: operations["usersGetMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update own profile */
        patch: operations["usersUpdateMe"];
        trace?: never;
    };
    "/api/users/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload and set avatar (image only) */
        post: operations["usersSetAvatar"];
        /** Remove avatar */
        delete: operations["usersRemoveAvatar"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload and set cover photo (image only) */
        post: operations["usersSetCover"];
        /** Remove cover photo */
        delete: operations["usersRemoveCover"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a public profile by username (case-insensitive)
         * @description Returns 404 for unknown, suspended or blocking accounts. Never exposes email or other private data.
         */
        get: operations["usersGetProfile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an account and start a session */
        post: operations["authRegister"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log in with email or username
         * @description Unknown accounts and wrong passwords both return 401 `INVALID_CREDENTIALS`.
         */
        post: operations["authLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate tokens
         * @description Exchanges a refresh token for a new access + refresh token pair. Refresh tokens are single use: replaying a used token revokes the whole session. Clients must serialise refresh calls.
         */
        post: operations["authRefresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current session (access and refresh tokens) */
        post: operations["authLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/background-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a separate background importer session for the current account
         * @description Independent single-use refresh chain. Logout-all, password changes and account restrictions revoke it normally. Never accepts another user ID.
         */
        post: operations["authBackgroundSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke every session of the current user */
        post: operations["authLogoutAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change password
         * @description Revokes all other sessions; the current session stays valid.
         */
        post: operations["authChangePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List notifications (newest first)
         * @description Polling-compatible; cursor-paginated.
         */
        get: operations["notificationsList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Number of unread notifications */
        get: operations["notificationsUnreadCount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark all notifications as read */
        post: operations["notificationsMarkAllRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark one notification as read (idempotent) */
        post: operations["notificationsMarkRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/follow-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Incoming pending follow requests */
        get: operations["followsListRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/follow-requests/{userId}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a follow request */
        post: operations["followsAccept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/follow-requests/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Decline a follow request (idempotent) */
        delete: operations["followsReject"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/followers/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a user from your followers (idempotent) */
        delete: operations["followsRemoveFollower"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Suggested accounts to follow
         * @description Excludes yourself, accounts you follow or have requested, blocked accounts in either direction and inactive accounts. Ranked by mutual connections. Not paginated (max 20).
         */
        get: operations["followsSuggestions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/blocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Users you have blocked */
        get: operations["followsListBlocks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/follow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Follow a user (idempotent)
         * @description For private accounts a follow request is created and `status` is REQUESTED.
         */
        post: operations["followsFollow"];
        /** Unfollow a user or cancel a pending request (idempotent) */
        delete: operations["followsUnfollow"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Block a user (idempotent)
         * @description Removes follows and follow requests in both directions. Blocked users cannot see or interact with your content.
         */
        post: operations["followsBlock"];
        /** Unblock a user (idempotent) */
        delete: operations["followsUnblock"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/followers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a user's followers (newest first) */
        get: operations["followsFollowers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/following": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users a user follows (newest first) */
        get: operations["followsFollowing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a post (text, images, video or mixed) */
        post: operations["postsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single post */
        get: operations["postsGet"];
        put?: never;
        post?: never;
        /**
         * Permanently delete own post and unused media files
         * @description Also used to undo a simple repost by its own id. Cannot be restored.
         */
        delete: operations["postsRemove"];
        options?: never;
        head?: never;
        /**
         * Edit own post
         * @description Sets `editedAt` when content or attachments change. Simple reposts cannot be edited.
         */
        patch: operations["postsUpdate"];
        trace?: never;
    };
    "/api/posts/{id}/engagement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Engagement counters and viewer flags for a post */
        get: operations["postsEngagement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/posts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A user's posts, quotes and reposts (newest first) */
        get: operations["postsByUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/interaction": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Real results of a post’s poll, quiz or slider
         * @description 404 when the post has no interactive widget.
         */
        get: operations["postInteractionsGet"];
        put?: never;
        /** Vote in a poll, answer a quiz or rate a slider (once per person) */
        post: operations["postInteractionsRespond"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/like": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Like a post (idempotent) */
        post: operations["likesLikePost"];
        /** Unlike a post (idempotent) */
        delete: operations["likesUnlikePost"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/likes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Users who liked a post (most recent first) */
        get: operations["likesLikers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/comments/{id}/like": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Like a comment (idempotent) */
        post: operations["likesLikeComment"];
        /** Unlike a comment (idempotent) */
        delete: operations["likesUnlikeComment"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Top-level comments of a post
         * @description Use `/comments/{id}/replies` to expand threads.
         */
        get: operations["commentsListForPost"];
        put?: never;
        /** Add a top-level comment to a post */
        post: operations["commentsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/comments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single comment */
        get: operations["commentsGet"];
        put?: never;
        post?: never;
        /**
         * Delete a comment (soft delete)
         * @description Allowed for the comment author and the post author. Comments with replies remain as DELETED tombstones.
         */
        delete: operations["commentsRemove"];
        options?: never;
        head?: never;
        /** Edit own comment */
        patch: operations["commentsUpdate"];
        trace?: never;
    };
    "/api/comments/{id}/replies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Direct replies of a comment (oldest first) */
        get: operations["commentsReplies"];
        put?: never;
        /**
         * Reply to a comment
         * @description 422 `MAX_DEPTH_EXCEEDED` when the thread depth limit (COMMENT_MAX_DEPTH) is reached.
         */
        post: operations["commentsReply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/bookmarks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Your saved posts (private, most recently saved first) */
        get: operations["bookmarksList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/bookmark": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bookmark a post (idempotent) */
        post: operations["bookmarksAdd"];
        /** Remove a bookmark (idempotent) */
        delete: operations["bookmarksRemove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/repost": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Simple repost (idempotent)
         * @description Only PUBLIC posts of public accounts can be reposted (422 `POST_NOT_REPOSTABLE`). Reposting a repost targets its original.
         */
        post: operations["repostsRepost"];
        /**
         * Undo a simple repost (idempotent)
         * @description Accepts the original post id or the repost id.
         */
        delete: operations["repostsUndo"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Quote repost: a new post with commentary embedding the original */
        post: operations["repostsQuote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/reposts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Users who reposted a post */
        get: operations["repostsReposters"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/posts/{id}/quotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Quote posts of a post */
        get: operations["repostsQuotes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/global": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Home feed: public text/image posts and quotes
         * @description Server-side attachment classification defaults to home. content=all is available to other clients. Ordered by (createdAt desc, id desc).
         */
        get: operations["feedGlobal"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/following": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Following feed: followed accounts + your own posts, quotes and reposts
         * @description Ordered by (createdAt desc, id desc). Reposts appear as kind=REPOST items.
         */
        get: operations["feedFollowing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/reels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Persistent personalized Reels discovery
         * @description Bounded PostgreSQL ranking, 48-hour sessions, signed stable cursors, creator diversity and persistent meaningful-watch exclusions. Reposts are resolved to their original, not duplicated. Privacy, blocks, reports and moderation are checked on every page. Exhaustion never silently recycles; omit session/cursor to refresh, or explicitly request rewatch=true for a new discovery cycle.
         */
        get: operations["feedReels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/reels/expose": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register an exact direct-linked Reel in the existing recommendation session
         * @description Does not reset the session or persistent history. Only playable, visible originals/quotes are accepted.
         */
        post: operations["feedExpose"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/reels/watch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Batch meaningful Reel playback events
         * @description 1–20 events, monotonic idempotent sequences. Requires exposure and VIDEO_START. Duration/position are validated and credited time is bounded by server elapsed time. Meaningful = 2 seconds or 50% of a short video (minimum 250ms). Guests keep temporary impression history; signed-in users retain aggregates across sessions.
         */
        post: operations["feedWatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/reels/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set or remove Not Interested feedback
         * @description Hides the exact recommendation and reduces creator affinity. Does not change post visibility or count as positive engagement.
         */
        post: operations["feedFeedback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feed/explore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Explore feed: recent public posts ranked by engagement
         * @description score = (likes + 2·comments + 3·(reposts+quotes) + bookmarks + 1) / (ageHours + 2)^1.5 over the last EXPLORE_WINDOW_HOURS (default 72). The cursor pins the ranking instant so pages are stable.
         */
        get: operations["feedExplore"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search users by username or display name
         * @description Fuzzy (trigram) + prefix matching, best matches first. A leading "@" is ignored.
         */
        get: operations["searchUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search/posts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Full-text search over post content
         * @description Whole-word matching with web-search syntax: `"exact phrase"`, `-exclude`, `a or b`. Newest first.
         */
        get: operations["searchPosts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Report a post, comment or account */
        post: operations["reportsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Moderation queue (MODERATOR/ADMIN)
         * @description Defaults to OPEN reports, newest first.
         */
        get: operations["moderationList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Resolve or dismiss a report, optionally acting on the target (MODERATOR/ADMIN) */
        patch: operations["moderationResolve"];
        trace?: never;
    };
    "/api/moderation/posts/{id}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Hide a post from everyone (MODERATOR/ADMIN) */
        post: operations["moderationRemovePost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/posts/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore a removed post (MODERATOR/ADMIN) */
        post: operations["moderationRestorePost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/comments/{id}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Hide a comment (shown as REMOVED tombstone) (MODERATOR/ADMIN) */
        post: operations["moderationRemoveComment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/comments/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore a removed comment (MODERATOR/ADMIN) */
        post: operations["moderationRestoreComment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/users/{id}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Suspend an account and revoke its sessions (ADMIN) */
        post: operations["moderationSuspend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/users/{id}/unsuspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reactivate a suspended account (ADMIN) */
        post: operations["moderationUnsuspend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/moderation/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change a user's role (ADMIN) */
        patch: operations["moderationSetRole"];
        trace?: never;
    };
    "/api/users/me/inbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Announcements and account messages (policy warnings), newest first
         * @description In-app only: email delivery is not configured. Reading the inbox does not mark items read.
         */
        get: operations["inboxList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/inbox/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Unread announcements and warnings */
        get: operations["inboxUnread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/inbox/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark inbox items read (all when `items` is omitted) */
        post: operations["inboxRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current staff member: role, permissions and grantable roles
         * @description Any staff role. Ordinary users get 403.
         */
        get: operations["adminCoreMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/step-up": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm password for sensitive operations
         * @description Returns a 10-minute token bound to this session. Send it as `X-Step-Up-Token` for: ban/unban, role changes, settings updates, publishing announcements and media cleanup (otherwise 403 `STEP_UP_REQUIRED`). A wrong password returns 403 `INVALID_CREDENTIALS` (not 401, so clients keep the session).
         */
        post: operations["adminCoreStepUpToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dashboard: counters, recent activity and alerts
         * @description Sections the viewer lacks permission for (reports, audit, system alerts) are returned empty.
         */
        get: operations["adminCoreDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/analytics/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Platform counters (exact counts, cached ≤30 s) */
        get: operations["adminAnalyticsOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/analytics/timeseries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Time series for one or more metrics (UTC buckets)
         * @description Max 400 daily, 260 weekly or 120 monthly buckets. `active_users` only exists since activity tracking began.
         */
        get: operations["adminAnalyticsTimeseries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/analytics/top-content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Most engaged posts or Reels created in a range */
        get: operations["adminAnalyticsTop"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/content/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Permanently delete an account’s content and media (step-up + typed username) */
        post: operations["adminUsersDeleteContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search and filter accounts
         * @description Emails are included only with `users.email.read`.
         */
        get: operations["adminUsersList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Account detail: profile, activity, relationships, restrictions, warnings, reports and history */
        get: operations["adminUsersDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Suspend an account (optionally until a date); revokes its sessions
         * @description The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account.
         */
        post: operations["adminUsersSuspend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/reinstate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Lift a suspension
         * @description The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account.
         */
        post: operations["adminUsersReinstate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/ban": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ban an account indefinitely (step-up + typed username confirmation)
         * @description The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account.
         */
        post: operations["adminUsersBan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/unban": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Lift a ban (step-up)
         * @description The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account.
         */
        post: operations["adminUsersUnban"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/warnings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue a policy warning (delivered to the user’s in-app inbox)
         * @description The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account.
         */
        post: operations["adminUsersWarn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change an account’s role (step-up)
         * @description Only roles below your own can be granted (SUPER_ADMIN may grant any); ADMIN/SUPER_ADMIN changes need `admins.manage`; the last active SUPER_ADMIN cannot be demoted (409 `LAST_SUPER_ADMIN`).
         */
        patch: operations["adminUsersRole"];
        trace?: never;
    };
    "/api/admin/users/{id}/content/moderation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hide, remove or restore all of an account’s content at once (step-up + typed username)
         * @description The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account. Needs `posts.moderate` + `reels.moderate` for posts and `comments.moderate` for comments. Reversible: `ACTIVE` restores everything currently hidden or removed in the scope. Nothing is deleted; each item is audited.
         */
        post: operations["adminUsersModerateContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/posts/{id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Permanently delete a post or Reel and its unused media files */
        post: operations["adminContentDeletePost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/comments/{id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Permanently erase a comment; empty reply placeholders preserve other users’ threads */
        post: operations["adminContentDeleteComment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/posts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search and filter posts (all statuses, including deleted) */
        get: operations["adminContentPosts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/posts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Post detail with exact content, media, reports and moderation history */
        get: operations["adminContentPost"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/posts/{id}/moderation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hide, remove or restore a post (or Reel)
         * @description HIDDEN and REMOVED are reversible and invisible to users; nothing is deleted. Posts with video require `reels.moderate`. Moderators cannot moderate their own content.
         */
        post: operations["adminContentModeratePost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/reels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Reels: posts with video
         * @description Width, height and duration are null when unknown (no server-side transcoder/probe).
         */
        get: operations["adminContentReels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search and filter comments (exact content, all statuses) */
        get: operations["adminContentComments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/comments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Comment with thread context, replies, parent post, reports and history */
        get: operations["adminContentComment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/comments/{id}/moderation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hide, remove or restore a comment
         * @description HIDDEN and REMOVED are reversible and invisible to users; nothing is deleted. Posts with video require `reels.moderate`. Moderators cannot moderate their own content. Removed comments with replies remain as placeholders so threads stay intact.
         */
        post: operations["adminContentModerateComment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Media library: images and videos with owner and usage (post, avatar, cover, unattached) */
        get: operations["adminMediaList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Scan a page of media records against storage (read-only)
         * @description Reports missing objects, size mismatches and FAILED processing. Bounded per request; continue with `afterId`.
         */
        get: operations["adminMediaScan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media/cleanup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dry run: orphaned uploads eligible for cleanup (nothing is deleted) */
        get: operations["adminMediaCleanupPreview"];
        put?: never;
        /**
         * Delete reviewed orphaned uploads (step-up)
         * @description Each id is re-verified as unattached and past the TTL; referenced media is never deleted.
         */
        post: operations["adminMediaCleanup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Media detail */
        get: operations["adminMediaDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media/{id}/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check one stored object (3 s timeout) */
        get: operations["adminMediaHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Report queue (pending = OPEN + IN_REVIEW, oldest first by default) */
        get: operations["adminReportsList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Report with full target, related reports, internal notes and history */
        get: operations["adminReportsDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/reports/{id}/assignee": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Assign (moves OPEN → IN_REVIEW) or unassign a moderator */
        patch: operations["adminReportsAssign"];
        trace?: never;
    };
    "/api/admin/reports/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change status: OPEN ↔ IN_REVIEW → RESOLVED | DISMISSED (closed reports can be reopened) */
        patch: operations["adminReportsStatus"];
        trace?: never;
    };
    "/api/admin/reports/{id}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add an internal moderator note (never visible to users) */
        post: operations["adminReportsNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/reports/{id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Act on the reported target, then resolve
         * @description Hide/remove/restore content, warn, suspend or ban the owner. Each action applies the same permission, rank and step-up rules as the dedicated endpoints (BAN_USER needs step-up and `confirmUsername`).
         */
        post: operations["adminReportsAct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Announcement history with recipient and read counts */
        get: operations["adminAnnouncementsList"];
        put?: never;
        /** Create a draft (nothing is sent until published) */
        post: operations["adminAnnouncementsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/announcements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Announcement detail */
        get: operations["adminAnnouncementsGet"];
        /** Edit a draft */
        put: operations["adminAnnouncementsUpdate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/announcements/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish a draft to the audience’s inbox (step-up, once)
         * @description Publishing an announcement that is not a draft returns 409 `INVALID_STATE` (never a duplicate send).
         */
        post: operations["adminAnnouncementsPublish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/announcements/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Archive (removes it from users’ inboxes) */
        post: operations["adminAnnouncementsArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Platform settings, feature flags and server hard limits */
        get: operations["adminSettingsGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update settings sections (step-up)
         * @description Each provided section is replaced as a whole and validated; every changed value is audited. Takes effect within 15 s.
         */
        patch: operations["adminSettingsUpdate"];
        trace?: never;
    };
    "/api/admin/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Roles, permission matrix, staff accounts and recent role changes */
        get: operations["adminSystemRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/audit-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Append-only audit log (read-only; entries cannot be edited or deleted) */
        get: operations["adminSystemAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/audit-logs/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Distinct recorded action names (for filters) */
        get: operations["adminSystemActions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/system": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * System status: API, database, storage, jobs and recent errors
         * @description No environment variables or secrets are exposed; CPU/RAM metrics are not collected and not shown.
         */
        get: operations["adminSystemSystem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        FeatureFlagsDto: {
            /** @description New account registration */
            registration: boolean;
            /** @description Creating posts and quote posts */
            postCreation: boolean;
            /** @description Image uploads (post attachments, avatars, covers) */
            imageUploads: boolean;
            /** @description Video uploads */
            videoUploads: boolean;
            /** @description Reels feed and page */
            reels: boolean;
            /** @description Writing comments and replies */
            comments: boolean;
            /** @description Simple reposts and quote posts */
            reposts: boolean;
            /** @description User and post search */
            search: boolean;
            /** @description Submitting reports */
            reporting: boolean;
        };
        /** @enum {string} */
        PostVisibility: "PUBLIC" | "FOLLOWERS";
        /** @enum {string} */
        ReportReason: "SPAM" | "HARASSMENT" | "HATE_SPEECH" | "VIOLENCE" | "NUDITY" | "SELF_HARM" | "MISINFORMATION" | "IMPERSONATION" | "INTELLECTUAL_PROPERTY" | "OTHER";
        PublicPlatformConfigDto: {
            /** @example Circle */
            platformName: string;
            description: string;
            /** @example  */
            supportEmail: string;
            /**
             * @description Show as a banner when not empty
             * @example
             */
            maintenanceMessage: string;
            /** @example false */
            readOnlyMode: boolean;
            features: components["schemas"]["FeatureFlagsDto"];
            /** @example 5000 */
            postMaxLength: number;
            /** @example 4 */
            postMaxMedia: number;
            defaultVisibility: components["schemas"]["PostVisibility"];
            /** @example 2000 */
            commentMaxLength: number;
            /** @example 6 */
            commentMaxDepth: number;
            /** @example 10485760 */
            maxImageBytes: number;
            /** @example 104857600 */
            maxVideoBytes: number;
            /**
             * @example [
             *       "image/jpeg",
             *       "image/png",
             *       "image/webp",
             *       "image/gif"
             *     ]
             */
            allowedImageTypes: string[];
            /**
             * @example [
             *       "video/mp4",
             *       "video/webm",
             *       "video/quicktime"
             *     ]
             */
            allowedVideoTypes: string[];
            allowedReportReasons: components["schemas"]["ReportReason"][];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_ERROR" | "BAD_REQUEST" | "INVALID_CURSOR" | "UNAUTHORIZED" | "INVALID_CREDENTIALS" | "INVALID_TOKEN" | "INVALID_REFRESH_TOKEN" | "WRONG_PASSWORD" | "FORBIDDEN" | "ACCOUNT_SUSPENDED" | "PRIVATE_ACCOUNT" | "BLOCKED" | "NOT_FOUND" | "USER_NOT_FOUND" | "POST_NOT_FOUND" | "COMMENT_NOT_FOUND" | "MEDIA_NOT_FOUND" | "NOTIFICATION_NOT_FOUND" | "REPORT_NOT_FOUND" | "CONFLICT" | "ACCOUNT_CONFLICT" | "USERNAME_TAKEN" | "ALREADY_REPORTED" | "CANNOT_FOLLOW_SELF" | "CANNOT_BLOCK_SELF" | "CANNOT_REPORT_SELF" | "MAX_DEPTH_EXCEEDED" | "POST_NOT_REPOSTABLE" | "POST_NOT_EDITABLE" | "INVALID_MEDIA" | "MEDIA_IN_USE" | "UNSUPPORTED_MEDIA_TYPE" | "FILE_TOO_LARGE" | "RATE_LIMITED" | "STEP_UP_REQUIRED" | "INSUFFICIENT_RANK" | "LAST_SUPER_ADMIN" | "INVALID_STATE" | "FEATURE_DISABLED" | "READ_ONLY_MODE" | "INTERNAL_ERROR";
        ErrorDetailDto: {
            /**
             * @description Offending field (dot-notation for nested fields)
             * @example email
             */
            field?: string;
            /** @example email must be an email */
            message: string;
        };
        ErrorResponseDto: {
            /** @example 400 */
            statusCode: number;
            /** @example VALIDATION_ERROR */
            code: components["schemas"]["ErrorCode"];
            /** @example Validation failed */
            message: string;
            details: components["schemas"]["ErrorDetailDto"][];
        };
        StartUploadDto: {
            /**
             * @description Total file size in bytes
             * @example 734003200
             */
            size: number;
            /** @example IMG_2041.MOV */
            fileName: string;
        };
        UploadSessionDto: {
            /** Format: uuid */
            id: string;
            /** @description Bytes received so far — send the next piece from this offset */
            received: number;
            size: number;
            /**
             * @description Suggested piece size in bytes (max 16 MB)
             * @example 8388608
             */
            chunkSize: number;
        };
        /** @enum {string} */
        MediaType: "IMAGE" | "VIDEO";
        /** @enum {string} */
        MediaStatus: "PROCESSING" | "READY" | "FAILED";
        MediaDto: {
            /**
             * Format: uuid
             * @example 0b6f3c9e-2c1f-4f43-9d0e-6f1d5b2f8a11
             */
            id: string;
            /** @example IMAGE */
            type: components["schemas"]["MediaType"];
            /** @example READY */
            status: components["schemas"]["MediaStatus"];
            /**
             * @description Signed, expiring URL. Do not persist; refetch the parent resource for a fresh URL.
             * @example http://localhost:3002/api/media/files/9f2c4e0d1a7b4c3e8f6a5b2d1c0e9f8a.webp?exp=1760227200&sig=Qk3…
             */
            url: string;
            /** @example image/webp */
            mimeType: string;
            /** @example 245760 */
            sizeBytes: number;
            /** @example 1080 */
            width: number | null;
            /** @example 1350 */
            height: number | null;
            /**
             * @description Video duration (null when unknown)
             * @example null
             */
            durationMs: number | null;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * @description Videos only: compression progress 0–100 while `status` is PROCESSING (null otherwise or when unknown)
             * @example null
             */
            processingProgress: number | null;
        };
        UploadMediaDto: {
            /**
             * Format: binary
             * @description Image (jpeg, png, webp, gif) or a video in any common format (mp4, mov, webm, mkv, avi, 3gp, …). Type is verified from file contents. Videos are compressed to MP4 in the background.
             */
            file: string;
        };
        /** @enum {string} */
        UserRole: "USER" | "SUPPORT" | "MODERATOR" | "ADMIN" | "SUPER_ADMIN";
        /** @enum {string} */
        UserStatus: "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED";
        MeDto: {
            /**
             * Format: uuid
             * @example 3fa85f64-5717-4562-b3fc-2c963f66afa6
             */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example jane@example.com */
            email: string;
            /** @example Jane Doe */
            displayName: string;
            /** @example null */
            avatarUrl: string | null;
            /** @example null */
            coverUrl: string | null;
            /** @example null */
            bio: string | null;
            /** @example null */
            location: string | null;
            /** @example null */
            website: string | null;
            /** @example false */
            isPrivate: boolean;
            /** @example USER */
            role: components["schemas"]["UserRole"];
            /** @example ACTIVE */
            status: components["schemas"]["UserStatus"];
            /** @example 0 */
            followerCount: number;
            /** @example 0 */
            followingCount: number;
            /** @example 0 */
            postCount: number;
            /**
             * @description Pending incoming follow requests
             * @example 0
             */
            pendingFollowRequestCount: number;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            updatedAt: string;
        };
        UpdateProfileDto: {
            /**
             * @description 3–30 chars: letters, digits, underscore. Case-insensitively unique.
             * @example jane_doe
             */
            username?: string;
            /** @example Jane Doe */
            displayName?: string;
            /**
             * @description Send null or "" to clear
             * @example Coffee, code and cats.
             */
            bio?: string | null;
            /** @example Berlin */
            location?: string | null;
            /**
             * @description http(s) URL
             * @example https://jane.dev
             */
            website?: string | null;
            /**
             * @description Private accounts require follow approval. Switching to public auto-approves pending requests.
             * @example false
             */
            isPrivate?: boolean;
        };
        UserProfileDto: {
            /**
             * Format: uuid
             * @example 3fa85f64-5717-4562-b3fc-2c963f66afa6
             */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example Jane Doe */
            displayName: string;
            /**
             * @description Signed URL
             * @example null
             */
            avatarUrl: string | null;
            /** @example false */
            isPrivate: boolean;
            /** @example Coffee, code and cats. */
            bio: string | null;
            /** @example Berlin */
            location: string | null;
            /** @example https://jane.dev */
            website: string | null;
            /**
             * @description Signed URL
             * @example null
             */
            coverUrl: string | null;
            /** @example 120 */
            followerCount: number;
            /** @example 87 */
            followingCount: number;
            /** @example 42 */
            postCount: number;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * @description The viewer is this user
             * @example false
             */
            isSelf: boolean;
            /** @example false */
            isFollowing: boolean;
            /** @example false */
            followsYou: boolean;
            /**
             * @description Viewer has a pending follow request to this (private) user
             * @example false
             */
            isFollowRequested: boolean;
            /**
             * @description Viewer has blocked this user
             * @example false
             */
            isBlocking: boolean;
            /**
             * @description Viewer may see posts/followers/following (false for private accounts the viewer does not follow, or when blocking)
             * @example true
             */
            canViewContent: boolean;
        };
        RegisterDto: {
            /** @example jane@example.com */
            email: string;
            /**
             * @description 3–30 chars: letters, digits, underscore. Case-insensitively unique.
             * @example jane_doe
             */
            username: string;
            /**
             * @description password must be 8-128 characters and contain at least one letter and one digit
             * @example correct-horse-42
             */
            password: string;
            /**
             * @description Defaults to the username
             * @example Jane Doe
             */
            displayName?: string;
        };
        AuthResponseDto: {
            /**
             * @example Bearer
             * @enum {string}
             */
            tokenType: "Bearer";
            /** @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9… */
            accessToken: string;
            /**
             * Format: date-time
             * @example 2026-10-12T12:00:00.000Z
             */
            accessTokenExpiresAt: string;
            /**
             * @description Single-use; rotated on every refresh
             * @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…
             */
            refreshToken: string;
            /**
             * Format: date-time
             * @example 2026-10-18T12:00:00.000Z
             */
            refreshTokenExpiresAt: string;
            user: components["schemas"]["MeDto"];
        };
        LoginDto: {
            /**
             * @description Email address or username
             * @example jane@example.com
             */
            identifier: string;
            /** @example correct-horse-42 */
            password: string;
        };
        RefreshTokenDto: {
            /**
             * @description Refresh token from the last auth response (single use)
             * @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…
             */
            refreshToken: string;
        };
        ChangePasswordDto: {
            /** @example correct-horse-42 */
            currentPassword: string;
            /**
             * @description password must be 8-128 characters and contain at least one letter and one digit
             * @example even-better-horse-43
             */
            newPassword: string;
        };
        /** @enum {string} */
        NotificationType: "NEW_FOLLOWER" | "FOLLOW_REQUEST" | "FOLLOW_ACCEPTED" | "POST_LIKE" | "COMMENT" | "COMMENT_REPLY" | "COMMENT_LIKE" | "REPOST" | "QUOTE_REPOST";
        UserSummaryDto: {
            /**
             * Format: uuid
             * @example 3fa85f64-5717-4562-b3fc-2c963f66afa6
             */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example Jane Doe */
            displayName: string;
            /**
             * @description Signed URL
             * @example null
             */
            avatarUrl: string | null;
            /** @example false */
            isPrivate: boolean;
        };
        /**
         * @description Only for FOLLOW_REQUEST notifications (null otherwise). PENDING: approve/decline with `POST /users/me/follow-requests/{actor.id}/accept` or `DELETE /users/me/follow-requests/{actor.id}` — the request is identified by the requester (`actor.id`). ACCEPTED: the requester now follows you. UNAVAILABLE: no longer actionable (e.g. the follower was later removed). Declined or cancelled requests remove the notification.
         * @enum {string}
         */
        FollowRequestStatus: "PENDING" | "ACCEPTED" | "UNAVAILABLE";
        NotificationDto: {
            /**
             * Format: uuid
             * @example 6b1f0f1e-8d2a-4b8f-9d3c-1a2b3c4d5e6f
             */
            id: string;
            /** @example POST_LIKE */
            type: components["schemas"]["NotificationType"];
            actor: components["schemas"]["UserSummaryDto"];
            /**
             * Format: uuid
             * @description Related post (the liked/commented/reposted post; for QUOTE_REPOST the quote post). null when not applicable or no longer available.
             */
            postId: string | null;
            /**
             * Format: uuid
             * @description Related comment (COMMENT, COMMENT_REPLY, COMMENT_LIKE)
             */
            commentId: string | null;
            /**
             * @description First 140 chars of the related post or comment
             * @example Hello world
             */
            preview: string | null;
            /**
             * @description Only for FOLLOW_REQUEST notifications (null otherwise). PENDING: approve/decline with `POST /users/me/follow-requests/{actor.id}/accept` or `DELETE /users/me/follow-requests/{actor.id}` — the request is identified by the requester (`actor.id`). ACCEPTED: the requester now follows you. UNAVAILABLE: no longer actionable (e.g. the follower was later removed). Declined or cancelled requests remove the notification.
             * @example null
             */
            followRequestStatus: components["schemas"]["FollowRequestStatus"] | null;
            /** @example false */
            isRead: boolean;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
        };
        PaginatedNotification: {
            items: components["schemas"]["NotificationDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        CountDto: {
            /** @example 3 */
            count: number;
        };
        MarkAllReadResultDto: {
            /**
             * @description Number of notifications marked as read
             * @example 5
             */
            updated: number;
        };
        FollowRequestDto: {
            user: components["schemas"]["UserSummaryDto"];
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            requestedAt: string;
        };
        PaginatedFollowRequest: {
            items: components["schemas"]["FollowRequestDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        SuggestedUserDto: {
            /**
             * Format: uuid
             * @example 3fa85f64-5717-4562-b3fc-2c963f66afa6
             */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example Jane Doe */
            displayName: string;
            /**
             * @description Signed URL
             * @example null
             */
            avatarUrl: string | null;
            /** @example false */
            isPrivate: boolean;
            /** @example Coffee, code and cats. */
            bio: string | null;
            /** @example 120 */
            followerCount: number;
            /**
             * @description Viewer follows this user (false for anonymous viewers)
             * @example false
             */
            isFollowing: boolean;
            /**
             * @description This user follows the viewer
             * @example false
             */
            followsYou: boolean;
            /**
             * @description People you follow who follow this user
             * @example 2
             */
            mutualFollowerCount: number;
        };
        SuggestedUsersDto: {
            items: components["schemas"]["SuggestedUserDto"][];
        };
        BlockedUserDto: {
            user: components["schemas"]["UserSummaryDto"];
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            blockedAt: string;
        };
        PaginatedBlockedUser: {
            items: components["schemas"]["BlockedUserDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        /**
         * @description REQUESTED when the target is private and approval is pending
         * @enum {string}
         */
        FollowStatus: "NONE" | "REQUESTED" | "FOLLOWING";
        FollowResultDto: {
            /**
             * @description REQUESTED when the target is private and approval is pending
             * @example FOLLOWING
             */
            status: components["schemas"]["FollowStatus"];
            /**
             * @description Target's follower count after the operation
             * @example 121
             */
            followerCount: number;
        };
        BlockResultDto: {
            /** @example true */
            isBlocking: boolean;
        };
        UserListItemDto: {
            /**
             * Format: uuid
             * @example 3fa85f64-5717-4562-b3fc-2c963f66afa6
             */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example Jane Doe */
            displayName: string;
            /**
             * @description Signed URL
             * @example null
             */
            avatarUrl: string | null;
            /** @example false */
            isPrivate: boolean;
            /** @example Coffee, code and cats. */
            bio: string | null;
            /** @example 120 */
            followerCount: number;
            /**
             * @description Viewer follows this user (false for anonymous viewers)
             * @example false
             */
            isFollowing: boolean;
            /**
             * @description This user follows the viewer
             * @example false
             */
            followsYou: boolean;
        };
        PaginatedUserListItem: {
            items: components["schemas"]["UserListItemDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        CreatePostDto: {
            /**
             * @description Plain text (render as text, never HTML). Required unless mediaIds is non-empty. Max POST_MAX_LENGTH (default 5000).
             * @example Hello world 👋
             */
            content?: string | null;
            /**
             * @description Uploaded media ids (POST /media) in display order. Max POST_MAX_MEDIA (default 4).
             * @example [
             *       "0b6f3c9e-2c1f-4f43-9d0e-6f1d5b2f8a11"
             *     ]
             */
            mediaIds?: string[];
            /** @default PUBLIC */
            visibility: components["schemas"]["PostVisibility"];
        };
        /**
         * @description POST = original, REPOST = simple repost (no content), QUOTE = quote repost
         * @enum {string}
         */
        PostKind: "POST" | "REPOST" | "QUOTE";
        ReferencedPostDto: {
            /**
             * Format: uuid
             * @example 9b2f3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d
             */
            id: string;
            /**
             * @description POST = original, REPOST = simple repost (no content), QUOTE = quote repost
             * @example POST
             */
            kind: components["schemas"]["PostKind"];
            author: components["schemas"]["UserSummaryDto"];
            /** @example Hello world 👋 */
            content: string | null;
            /** @description Ordered attachments */
            media: components["schemas"]["MediaDto"][];
            /** @example PUBLIC */
            visibility: components["schemas"]["PostVisibility"];
            /**
             * Format: uuid
             * @description Id of the reposted/quoted post
             * @example null
             */
            referencedPostId: string | null;
            /** @example 10 */
            likeCount: number;
            /** @example 2 */
            commentCount: number;
            /**
             * @description Simple reposts
             * @example 1
             */
            repostCount: number;
            /**
             * @description Quote reposts
             * @example 0
             */
            quoteCount: number;
            /** @example 3 */
            bookmarkCount: number;
            /**
             * @description Viewer liked this post (false when anonymous)
             * @example false
             */
            isLiked: boolean;
            /**
             * @description Viewer bookmarked this post
             * @example false
             */
            isBookmarked: boolean;
            /**
             * @description Viewer has a simple repost of this post
             * @example false
             */
            isReposted: boolean;
            /**
             * @description Viewer follows the author (false for own posts)
             * @example false
             */
            isFollowingAuthor: boolean;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            updatedAt: string;
            /**
             * Format: date-time
             * @example null
             */
            editedAt: string | null;
        };
        PostDto: {
            /**
             * Format: uuid
             * @example 9b2f3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d
             */
            id: string;
            /**
             * @description POST = original, REPOST = simple repost (no content), QUOTE = quote repost
             * @example POST
             */
            kind: components["schemas"]["PostKind"];
            author: components["schemas"]["UserSummaryDto"];
            /** @example Hello world 👋 */
            content: string | null;
            /** @description Ordered attachments */
            media: components["schemas"]["MediaDto"][];
            /** @example PUBLIC */
            visibility: components["schemas"]["PostVisibility"];
            /**
             * Format: uuid
             * @description Id of the reposted/quoted post
             * @example null
             */
            referencedPostId: string | null;
            /** @example 10 */
            likeCount: number;
            /** @example 2 */
            commentCount: number;
            /**
             * @description Simple reposts
             * @example 1
             */
            repostCount: number;
            /**
             * @description Quote reposts
             * @example 0
             */
            quoteCount: number;
            /** @example 3 */
            bookmarkCount: number;
            /**
             * @description Viewer liked this post (false when anonymous)
             * @example false
             */
            isLiked: boolean;
            /**
             * @description Viewer bookmarked this post
             * @example false
             */
            isBookmarked: boolean;
            /**
             * @description Viewer has a simple repost of this post
             * @example false
             */
            isReposted: boolean;
            /**
             * @description Viewer follows the author (false for own posts)
             * @example false
             */
            isFollowingAuthor: boolean;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            updatedAt: string;
            /**
             * Format: date-time
             * @example null
             */
            editedAt: string | null;
            /** @description Embedded original for REPOST/QUOTE (one level deep). null for POST or when unavailable. */
            referencedPost: components["schemas"]["ReferencedPostDto"] | null;
            /**
             * @description true when this is a REPOST/QUOTE whose original was deleted, removed or is not visible to the viewer
             * @example false
             */
            referencedPostUnavailable: boolean;
        };
        UpdatePostDto: {
            /**
             * @description Omit to keep; null/"" to clear (only if media remains)
             * @example Edited text
             */
            content?: string | null;
            /** @description Full replacement of attachments, in order. Omit to keep. */
            mediaIds?: string[];
            visibility?: components["schemas"]["PostVisibility"];
        };
        EngagementSummaryDto: {
            /** Format: uuid */
            postId: string;
            /** @example 10 */
            likeCount: number;
            /** @example 2 */
            commentCount: number;
            /** @example 1 */
            repostCount: number;
            /** @example 0 */
            quoteCount: number;
            /** @example 3 */
            bookmarkCount: number;
            /** @example false */
            isLiked: boolean;
            /** @example false */
            isBookmarked: boolean;
            /** @example false */
            isReposted: boolean;
        };
        PaginatedPost: {
            items: components["schemas"]["PostDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        InteractionSummaryDto: {
            /** @enum {string} */
            kind: "POLL" | "QUIZ" | "SLIDER";
            /**
             * @description Responses per option (poll/quiz; empty for sliders)
             * @example [
             *       3,
             *       1
             *     ]
             */
            counts: number[];
            /**
             * @description Number of people who responded
             * @example 4
             */
            total: number;
            /** @description Your option index (poll/quiz) or value 0–100 (slider); null if you have not responded or are signed out */
            myResponse: number | null;
            /** @description Sliders: average of all responses (0–100); null when nobody responded */
            average: number | null;
            /** @description Quizzes: how many answered correctly */
            correctCount: number | null;
        };
        RespondInteractionDto: {
            /**
             * @description Option index for polls/quizzes, or 0–100 for sliders
             * @example 1
             */
            value?: number;
        };
        LikeResultDto: {
            /**
             * Format: uuid
             * @description Id of the liked post/comment (a simple repost resolves to its original)
             */
            id: string;
            /** @example true */
            liked: boolean;
            /** @example 11 */
            likeCount: number;
        };
        /** @enum {string} */
        CommentSort: "NEWEST" | "OLDEST" | "TOP";
        /**
         * @description DELETED/REMOVED comments are tombstones kept only to preserve thread structure; author and content are null.
         * @enum {string}
         */
        CommentStatus: "ACTIVE" | "DELETED" | "REMOVED";
        CommentDto: {
            /**
             * Format: uuid
             * @example c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f
             */
            id: string;
            /** Format: uuid */
            postId: string;
            /**
             * Format: uuid
             * @example null
             */
            parentId: string | null;
            /**
             * @description 0 for top-level comments
             * @example 0
             */
            depth: number;
            /**
             * @description DELETED/REMOVED comments are tombstones kept only to preserve thread structure; author and content are null.
             * @example ACTIVE
             */
            status: components["schemas"]["CommentStatus"];
            author: components["schemas"]["UserSummaryDto"] | null;
            /** @example Great point! */
            content: string | null;
            /** @example 4 */
            likeCount: number;
            /**
             * @description Live direct replies
             * @example 2
             */
            replyCount: number;
            /**
             * @description Has any direct replies (incl. tombstones) — fetch /comments/{id}/replies
             * @example true
             */
            hasReplies: boolean;
            /** @example false */
            isLiked: boolean;
            /**
             * @description Replies are allowed (depth limit not reached and comment is active)
             * @example true
             */
            canReply: boolean;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            updatedAt: string;
            /**
             * Format: date-time
             * @example null
             */
            editedAt: string | null;
        };
        PaginatedComment: {
            items: components["schemas"]["CommentDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        CreateCommentDto: {
            /**
             * @description Plain text. Max COMMENT_MAX_LENGTH (default 2000).
             * @example Great point!
             */
            content: string;
        };
        UpdateCommentDto: {
            /**
             * @description Plain text. Max COMMENT_MAX_LENGTH (default 2000).
             * @example Great point!
             */
            content: string;
        };
        BookmarkResultDto: {
            /**
             * Format: uuid
             * @description Bookmarked post id (a simple repost resolves to its original)
             */
            postId: string;
            /** @example true */
            bookmarked: boolean;
            /** @example 4 */
            bookmarkCount: number;
        };
        RepostResultDto: {
            /**
             * Format: uuid
             * @description Original post id (reposting a repost targets its original)
             */
            postId: string;
            /** @example true */
            reposted: boolean;
            /** @example 5 */
            repostCount: number;
            /**
             * Format: uuid
             * @description Id of the viewer's repost row (null after undo)
             */
            repostId: string | null;
        };
        ReelsPageDto: {
            items: components["schemas"]["PostDto"][];
            nextCursor: string | null;
            hasMore: boolean;
            /** Format: uuid */
            sessionId: string;
        };
        ReelExposeDto: {
            /** Format: uuid */
            sessionId: string;
            /**
             * Format: uuid
             * @description Exact playable post from a direct link; does not reset recommendation history.
             */
            postId: string;
        };
        ReelExposureDto: {
            nextSequence: number;
        };
        ReelWatchEventDto: {
            /** Format: uuid */
            postId: string;
            /**
             * Format: uuid
             * @description Exact video attachment, including legacy multi-video posts. Must belong to this post.
             */
            mediaId?: string;
            /** @description Monotonic sequence per post/session; retry duplicates are ignored. */
            sequence: number;
            /** @enum {string} */
            type: "VIDEO_START" | "WATCH_MILESTONE" | "VIDEO_COMPLETE" | "VIDEO_REPLAY" | "VIDEO_SKIP";
            /** @description Played wall-clock milliseconds since previous event, bounded again by server elapsed time. */
            watchedMs: number;
            positionMs: number;
            durationMs: number;
        };
        ReelWatchBatchDto: {
            /** Format: uuid */
            sessionId: string;
            events: components["schemas"]["ReelWatchEventDto"][];
        };
        ReelFeedbackDto: {
            /** Format: uuid */
            postId: string;
            /** @description true hides this recommendation; false removes this explicit feedback. */
            notInterested: boolean;
        };
        /** @enum {string} */
        ReportTargetType: "POST" | "COMMENT" | "USER";
        CreateReportDto: {
            /** @example POST */
            targetType: components["schemas"]["ReportTargetType"];
            /**
             * Format: uuid
             * @description Id of the post, comment or user being reported
             */
            targetId: string;
            /** @example SPAM */
            reason: components["schemas"]["ReportReason"];
            /** @example Posting the same link repeatedly. */
            details?: string;
        };
        /** @enum {string} */
        ReportStatus: "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
        ReportDto: {
            /** Format: uuid */
            id: string;
            targetType: components["schemas"]["ReportTargetType"];
            /** Format: uuid */
            targetId: string;
            reason: components["schemas"]["ReportReason"];
            details: string | null;
            /** @example OPEN */
            status: components["schemas"]["ReportStatus"];
            /** Format: date-time */
            createdAt: string;
        };
        ModerationReportDto: {
            /** Format: uuid */
            id: string;
            targetType: components["schemas"]["ReportTargetType"];
            /** Format: uuid */
            targetId: string;
            reason: components["schemas"]["ReportReason"];
            details: string | null;
            /** @example OPEN */
            status: components["schemas"]["ReportStatus"];
            /** Format: date-time */
            createdAt: string;
            reporter: components["schemas"]["UserSummaryDto"];
            /**
             * @description Open reports for the same target (from all reporters)
             * @example 3
             */
            openReportsForTarget: number;
            resolutionNote: string | null;
            /** Format: uuid */
            resolvedById: string | null;
            /** Format: date-time */
            resolvedAt: string | null;
        };
        PaginatedModerationReport: {
            items: components["schemas"]["ModerationReportDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        /**
         * @description Action applied to the target. SUSPEND_USER requires ADMIN. Any action also resolves other open reports for the same target.
         * @enum {string}
         */
        ModerationAction: "NONE" | "REMOVE_CONTENT" | "SUSPEND_USER";
        ResolveReportDto: {
            /**
             * @example RESOLVED
             * @enum {string}
             */
            status: "RESOLVED" | "DISMISSED";
            /**
             * @description Action applied to the target. SUSPEND_USER requires ADMIN. Any action also resolves other open reports for the same target.
             * @default NONE
             */
            action: components["schemas"]["ModerationAction"];
            note?: string;
        };
        ModerationResultDto: {
            /** Format: uuid */
            id: string;
            /**
             * @description New moderation status (ACTIVE | REMOVED) or account status (ACTIVE | SUSPENDED) or role
             * @example REMOVED
             */
            status: string;
        };
        SetRoleDto: {
            role: components["schemas"]["UserRole"];
        };
        /** @enum {string} */
        InboxKind: "ANNOUNCEMENT" | "WARNING";
        InboxItemDto: {
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["InboxKind"];
            /** @example Scheduled maintenance on Sunday */
            title: string;
            /** @example Circle will be read-only for about 30 minutes… */
            body: string;
            /** @description Policy area for warnings */
            reason: components["schemas"]["ReportReason"] | null;
            /** @example false */
            isRead: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        PaginatedInboxItem: {
            items: components["schemas"]["InboxItemDto"][];
            /**
             * @description Pass as `cursor` to fetch the next page. `null` when there are no more items.
             * @example null
             */
            nextCursor: string | null;
            /** @example false */
            hasMore: boolean;
        };
        InboxItemRefDto: {
            kind: components["schemas"]["InboxKind"];
            /** Format: uuid */
            id: string;
        };
        MarkInboxReadDto: {
            /** @description Items to mark read; omit to mark everything read */
            items?: components["schemas"]["InboxItemRefDto"][];
        };
        MarkInboxReadResultDto: {
            /** @example 2 */
            updated: number;
        };
        AdminUserRefDto: {
            /** Format: uuid */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example Jane Doe */
            displayName: string;
            avatarUrl: string | null;
            role: components["schemas"]["UserRole"];
            status: components["schemas"]["UserStatus"];
        };
        AdminMeDto: {
            user: components["schemas"]["AdminUserRefDto"];
            role: components["schemas"]["UserRole"];
            /** @example 3 */
            rank: number;
            /**
             * @example [
             *       "users.read",
             *       "posts.moderate"
             *     ]
             */
            permissions: string[];
            /** @description Roles this admin may grant */
            assignableRoles: components["schemas"]["UserRole"][];
        };
        StepUpRequestDto: {
            /** @description Current account password */
            password: string;
        };
        StepUpResponseDto: {
            /** @description Send as `X-Step-Up-Token` on sensitive requests */
            token: string;
            /** Format: date-time */
            expiresAt: string;
        };
        OverviewDto: {
            totalUsers: number;
            /** @description null until activity has been tracked for 24h */
            activeUsers24h: number | null;
            /** @description null until activity has been tracked for 7 days */
            activeUsers7d: number | null;
            newUsersToday: number;
            newUsers7d: number;
            /** @description Original posts and quotes (excludes simple reposts and author-deleted posts) */
            totalPosts: number;
            postsToday: number;
            /** @description Posts with a ready video */
            totalReels: number;
            totalComments: number;
            totalLikes: number;
            totalReposts: number;
            totalBookmarks: number;
            /** @description OPEN + IN_REVIEW */
            pendingReports: number;
            suspendedAccounts: number;
            bannedAccounts: number;
            /**
             * Format: date-time
             * @description Start of activity tracking
             */
            activityTrackedSince: string | null;
            /** Format: date-time */
            generatedAt: string;
        };
        AdminUserRowDto: {
            /** Format: uuid */
            id: string;
            /** @example jane_doe */
            username: string;
            /** @example Jane Doe */
            displayName: string;
            avatarUrl: string | null;
            role: components["schemas"]["UserRole"];
            status: components["schemas"]["UserStatus"];
            /** @description null unless the viewer has users.email.read */
            email: string | null;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: date-time
             * @description Tracked since the admin release
             */
            lastActiveAt: string | null;
            postCount: number;
            followerCount: number;
            followingCount: number;
            /** @description Reports against the account or its content (all time) */
            reportCount: number;
            /** @description Of which still open or in review */
            openReportCount: number;
        };
        MediaSummaryDto: {
            images: number;
            videos: number;
        };
        /** @enum {string} */
        ContentModerationStatus: "ACTIVE" | "HIDDEN" | "REMOVED";
        AdminPostRowDto: {
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["PostKind"];
            /** @description First 200 characters */
            contentPreview: string | null;
            author: components["schemas"]["AdminUserRefDto"];
            media: components["schemas"]["MediaSummaryDto"];
            /** @description Signed URL of the first image */
            thumbnailUrl: string | null;
            visibility: components["schemas"]["PostVisibility"];
            moderationStatus: components["schemas"]["ContentModerationStatus"];
            /**
             * Format: date-time
             * @description Deleted by the author
             */
            deletedAt: string | null;
            likeCount: number;
            commentCount: number;
            repostCount: number;
            quoteCount: number;
            reportCount: number;
            openReportCount: number;
            /** Format: date-time */
            createdAt: string;
        };
        AdminVideoInfoDto: {
            /** Format: uuid */
            mediaId: string;
            url: string;
            /** @example video/mp4 */
            mimeType: string;
            sizeBytes: number;
            /** @description null: no server-side probing (no transcoder) */
            width: number | null;
            height: number | null;
            durationMs: number | null;
            status: components["schemas"]["MediaStatus"];
        };
        AdminReelRowDto: {
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["PostKind"];
            /** @description First 200 characters */
            contentPreview: string | null;
            author: components["schemas"]["AdminUserRefDto"];
            media: components["schemas"]["MediaSummaryDto"];
            /** @description Signed URL of the first image */
            thumbnailUrl: string | null;
            visibility: components["schemas"]["PostVisibility"];
            moderationStatus: components["schemas"]["ContentModerationStatus"];
            /**
             * Format: date-time
             * @description Deleted by the author
             */
            deletedAt: string | null;
            likeCount: number;
            commentCount: number;
            repostCount: number;
            quoteCount: number;
            reportCount: number;
            openReportCount: number;
            /** Format: date-time */
            createdAt: string;
            video: components["schemas"]["AdminVideoInfoDto"];
        };
        ReportTargetSummaryDto: {
            /** @description Whether the target still exists */
            exists: boolean;
            preview: string | null;
            /** @description Owner of the content (or the reported user) */
            owner: components["schemas"]["AdminUserRefDto"] | null;
            /** @description Content moderation status, or account status for USER */
            status: string | null;
            /** Format: date-time */
            deletedAt: string | null;
        };
        AdminReportRowDto: {
            /** Format: uuid */
            id: string;
            targetType: components["schemas"]["ReportTargetType"];
            /** @description POST target that contains a video (Reel) */
            isReel: boolean;
            /** Format: uuid */
            targetId: string;
            reason: components["schemas"]["ReportReason"];
            details: string | null;
            status: components["schemas"]["ReportStatus"];
            reporter: components["schemas"]["AdminUserRefDto"];
            assignee: components["schemas"]["AdminUserRefDto"] | null;
            target: components["schemas"]["ReportTargetSummaryDto"];
            /** @description Pending reports about the same target (all reporters) */
            samePendingCount: number;
            resolutionNote: string | null;
            /** Format: date-time */
            resolvedAt: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        AuditLogDto: {
            /** Format: uuid */
            id: string;
            /** @example post.hidden */
            action: string;
            /** @description null for system actions */
            actor: components["schemas"]["AdminUserRefDto"] | null;
            /** @example MODERATOR */
            actorRole: string | null;
            /** @example POST */
            targetType: string | null;
            /** Format: uuid */
            targetId: string | null;
            /** @description Human label for the target when resolvable */
            targetLabel: string | null;
            /**
             * @example {
             *       "reason": "Spam",
             *       "previousStatus": "ACTIVE",
             *       "newStatus": "HIDDEN"
             *     }
             */
            metadata: {
                [key: string]: unknown;
            };
            requestId: string | null;
            ipAddress: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        AlertDto: {
            /** @enum {string} */
            level: "info" | "warning" | "critical";
            title: string;
            detail: string;
            /** @description Admin route to act on it */
            href: string | null;
        };
        DashboardDto: {
            overview: components["schemas"]["OverviewDto"];
            recentUsers: components["schemas"]["AdminUserRowDto"][];
            latestPosts: components["schemas"]["AdminPostRowDto"][];
            latestReels: components["schemas"]["AdminReelRowDto"][];
            recentReports: components["schemas"]["AdminReportRowDto"][];
            recentActions: components["schemas"]["AuditLogDto"][];
            alerts: components["schemas"]["AlertDto"][];
        };
        TimePointDto: {
            /**
             * Format: date-time
             * @description Bucket start (UTC)
             */
            t: string;
            value: number;
        };
        TimeSeriesDto: {
            /** @enum {string} */
            metric: "registrations" | "active_users" | "posts" | "reels" | "comments" | "likes" | "reposts" | "bookmarks" | "reports_created" | "reports_resolved";
            total: number;
            points: components["schemas"]["TimePointDto"][];
            /** @description Caveat, e.g. tracking start for active users */
            note: string | null;
        };
        TimeseriesResponseDto: {
            /** @enum {string} */
            interval: "day" | "week" | "month";
            /** Format: date-time */
            from: string;
            /** Format: date-time */
            to: string;
            series: components["schemas"]["TimeSeriesDto"][];
        };
        TopContentItemDto: {
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["PostKind"];
            /** @description First 200 characters */
            contentPreview: string | null;
            author: components["schemas"]["AdminUserRefDto"];
            media: components["schemas"]["MediaSummaryDto"];
            /** @description Signed URL of the first image */
            thumbnailUrl: string | null;
            visibility: components["schemas"]["PostVisibility"];
            moderationStatus: components["schemas"]["ContentModerationStatus"];
            /**
             * Format: date-time
             * @description Deleted by the author
             */
            deletedAt: string | null;
            likeCount: number;
            commentCount: number;
            repostCount: number;
            quoteCount: number;
            reportCount: number;
            openReportCount: number;
            /** Format: date-time */
            createdAt: string;
            /** @description likes + 2·comments + 3·(reposts + quotes) when by=engagement, else the chosen counter */
            score: number;
        };
        TopContentResponseDto: {
            items: components["schemas"]["TopContentItemDto"][];
            /** @description Reel view counts and watch time are not tracked (see ADMIN_ARCHITECTURE.md §8) */
            viewsTracked: boolean;
        };
        DeleteUserContentDto: {
            /** @example Repeated spam after warnings */
            reason: string;
            /** @enum {string} */
            scope: "posts" | "comments" | "all";
            /** @description Must equal the target username */
            confirmUsername: string;
        };
        DeletionResultDto: {
            posts: number;
            comments: number;
            /** @description Storage files scheduled for immediate deletion; failures retry automatically */
            files: number;
            freedBytes: number;
            resolvedReports: number;
        };
        /** @enum {string} */
        SortOrder: "asc" | "desc";
        AdminPageAdminUserRow: {
            items: components["schemas"]["AdminUserRowDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        AdminUserContentCountsDto: {
            posts: number;
            reels: number;
            comments: number;
            reposts: number;
            /** @description Posts currently hidden or removed by moderators */
            moderatedPosts: number;
            /** @description Comments currently hidden or removed by moderators */
            moderatedComments: number;
        };
        AdminUserRelationshipsDto: {
            followers: number;
            following: number;
            /** @description Accounts this user blocks */
            blocking: number;
            /** @description Accounts blocking this user */
            blockedBy: number;
            pendingFollowRequests: number;
        };
        AdminRestrictionDto: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "SUSPENSION" | "BAN";
            reason: string;
            /** Format: date-time */
            startsAt: string;
            /** Format: date-time */
            expiresAt: string | null;
            createdBy: components["schemas"]["AdminUserRefDto"] | null;
            /** Format: date-time */
            liftedAt: string | null;
            liftReason: string | null;
            active: boolean;
        };
        AdminWarningDto: {
            /** Format: uuid */
            id: string;
            reason: components["schemas"]["ReportReason"];
            message: string;
            createdBy: components["schemas"]["AdminUserRefDto"] | null;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: date-time
             * @description When the user opened it in their inbox
             */
            readAt: string | null;
        };
        AdminUserDetailDto: {
            user: components["schemas"]["AdminUserRowDto"];
            bio: string | null;
            location: string | null;
            website: string | null;
            coverUrl: string | null;
            isPrivate: boolean;
            /** @description Unrevoked, unexpired sessions */
            activeSessions: number;
            content: components["schemas"]["AdminUserContentCountsDto"];
            relationships: components["schemas"]["AdminUserRelationshipsDto"];
            restrictions: components["schemas"]["AdminRestrictionDto"][];
            warnings: components["schemas"]["AdminWarningDto"][];
            /** @description Most recent 20 reports about the user or their content */
            reports: components["schemas"]["AdminReportRowDto"][];
            /** @description Most recent 30 administrative events for this account */
            history: components["schemas"]["AuditLogDto"][];
        };
        SuspendUserDto: {
            /** @example Repeated spam after warnings */
            reason: string;
            /**
             * Format: date-time
             * @description Omit for an indefinite suspension
             */
            expiresAt?: string;
        };
        AccountStatusResultDto: {
            /** Format: uuid */
            id: string;
            status: components["schemas"]["UserStatus"];
        };
        ReasonDto: {
            /** @example Repeated spam after warnings */
            reason: string;
        };
        BanUserDto: {
            /** @example Repeated spam after warnings */
            reason: string;
            /** @description Type the exact username to confirm */
            confirmUsername: string;
        };
        WarnUserDto: {
            reason: components["schemas"]["ReportReason"];
            /** @description Shown to the user in their inbox */
            message: string;
        };
        WarningCreatedDto: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            createdAt: string;
            /**
             * @description Only in-app delivery exists (no email provider configured)
             * @enum {string}
             */
            delivery: "IN_APP_INBOX";
        };
        ChangeRoleDto: {
            role: components["schemas"]["UserRole"];
        };
        RoleResultDto: {
            /** Format: uuid */
            id: string;
            role: components["schemas"]["UserRole"];
        };
        BulkModerateUserContentDto: {
            /** @example Repeated spam after warnings */
            reason: string;
            status: components["schemas"]["ContentModerationStatus"];
            /**
             * @description Also resolve open reports about this content (hide/remove only)
             * @default false
             */
            resolveReports: boolean;
            /**
             * @description `posts` = posts, quotes, reposts and Reels; `comments`; or `all`
             * @enum {string}
             */
            scope: "posts" | "comments" | "all";
            /** @description Must equal the account’s username (typed confirmation) */
            confirmUsername: string;
        };
        BulkModerationResultDto: {
            /**
             * Format: uuid
             * @description Shared by the audit entries of every affected item
             */
            batchId: string;
            /** @description Posts/Reels whose status changed */
            posts: number;
            /** @description Comments whose status changed */
            comments: number;
            resolvedReports: number;
        };
        /** @enum {string} */
        ContentFilterStatus: "ACTIVE" | "HIDDEN" | "REMOVED" | "DELETED";
        AdminPageAdminPostRow: {
            items: components["schemas"]["AdminPostRowDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        AdminPostDetailDto: {
            post: components["schemas"]["AdminPostRowDto"];
            /** @description Full text (moderators always see the exact content) */
            content: string | null;
            media: components["schemas"]["MediaDto"][];
            /** Format: uuid */
            referencedPostId: string | null;
            /** Format: date-time */
            editedAt: string | null;
            bookmarkCount: number;
            reports: components["schemas"]["AdminReportRowDto"][];
            history: components["schemas"]["AuditLogDto"][];
        };
        ModerateContentDto: {
            /** @example Repeated spam after warnings */
            reason: string;
            status: components["schemas"]["ContentModerationStatus"];
            /**
             * @description Also resolve open reports about this content (hide/remove only)
             * @default false
             */
            resolveReports: boolean;
        };
        ModerationOutcomeDto: {
            /** Format: uuid */
            id: string;
            status: components["schemas"]["ContentModerationStatus"];
            previousStatus: components["schemas"]["ContentModerationStatus"];
            resolvedReports: number;
        };
        AdminPageAdminReelRow: {
            items: components["schemas"]["AdminReelRowDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        AdminCommentRowDto: {
            /** Format: uuid */
            id: string;
            /** @description Exact content (also for removed/deleted comments) */
            content: string;
            author: components["schemas"]["AdminUserRefDto"];
            /** Format: uuid */
            postId: string;
            postPreview: string | null;
            /** Format: uuid */
            parentId: string | null;
            depth: number;
            likeCount: number;
            replyCount: number;
            moderationStatus: components["schemas"]["ContentModerationStatus"];
            /** Format: date-time */
            deletedAt: string | null;
            reportCount: number;
            openReportCount: number;
            /** Format: date-time */
            createdAt: string;
        };
        AdminPageAdminCommentRow: {
            items: components["schemas"]["AdminCommentRowDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        AdminCommentDetailDto: {
            comment: components["schemas"]["AdminCommentRowDto"];
            /** @description Ancestors from the top-level comment down to the parent */
            thread: components["schemas"]["AdminCommentRowDto"][];
            /** @description First 20 direct replies */
            replies: components["schemas"]["AdminCommentRowDto"][];
            post: components["schemas"]["AdminPostRowDto"];
            reports: components["schemas"]["AdminReportRowDto"][];
            history: components["schemas"]["AuditLogDto"][];
        };
        /** @enum {string} */
        MediaUsage: "POST" | "AVATAR" | "COVER" | "UNATTACHED";
        MediaUsageDto: {
            kind: components["schemas"]["MediaUsage"];
            /** Format: uuid */
            postId: string | null;
        };
        AdminMediaRowDto: {
            /**
             * Format: uuid
             * @example 0b6f3c9e-2c1f-4f43-9d0e-6f1d5b2f8a11
             */
            id: string;
            /** @example IMAGE */
            type: components["schemas"]["MediaType"];
            /** @example READY */
            status: components["schemas"]["MediaStatus"];
            /**
             * @description Signed, expiring URL. Do not persist; refetch the parent resource for a fresh URL.
             * @example http://localhost:3002/api/media/files/9f2c4e0d1a7b4c3e8f6a5b2d1c0e9f8a.webp?exp=1760227200&sig=Qk3…
             */
            url: string;
            /** @example image/webp */
            mimeType: string;
            /** @example 245760 */
            sizeBytes: number;
            /** @example 1080 */
            width: number | null;
            /** @example 1350 */
            height: number | null;
            /**
             * @description Video duration (null when unknown)
             * @example null
             */
            durationMs: number | null;
            /**
             * Format: date-time
             * @example 2026-10-11T12:00:00.000Z
             */
            createdAt: string;
            /**
             * @description Videos only: compression progress 0–100 while `status` is PROCESSING (null otherwise or when unknown)
             * @example null
             */
            processingProgress: number | null;
            /** @description Object identifier in the storage driver (not a credential) */
            storageKey: string;
            owner: components["schemas"]["AdminUserRefDto"];
            usage: components["schemas"]["MediaUsageDto"];
        };
        AdminPageAdminMediaRow: {
            items: components["schemas"]["AdminMediaRowDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        MediaHealthDto: {
            /** Format: uuid */
            id: string;
            storageKey: string;
            /** @enum {string} */
            state: "OK" | "MISSING" | "SIZE_MISMATCH" | "ERROR";
            storedBytes: number | null;
            recordedBytes: number;
            detail: string | null;
            /** Format: date-time */
            checkedAt: string;
        };
        MediaScanResultDto: {
            checked: number;
            /** @description Only problems are listed */
            problems: components["schemas"]["MediaHealthDto"][];
            /** Format: uuid */
            nextAfterId: string | null;
        };
        CleanupPreviewDto: {
            /** @description Unattached uploads older than this are eligible */
            ttlHours: number;
            count: number;
            totalBytes: number;
            /** @description Up to 100 oldest candidates */
            items: components["schemas"]["AdminMediaRowDto"][];
        };
        CleanupExecuteDto: {
            /** @description Ids from the preview; re-checked server-side */
            mediaIds: string[];
        };
        CleanupResultDto: {
            deleted: number;
            /** @description Ids that were no longer orphaned or already gone */
            skipped: number;
            freedBytes: number;
        };
        /** @enum {string} */
        AdminReportTargetFilter: "POST" | "REEL" | "COMMENT" | "USER";
        AdminPageAdminReportRow: {
            items: components["schemas"]["AdminReportRowDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        ReportNoteDto: {
            /** Format: uuid */
            id: string;
            author: components["schemas"]["AdminUserRefDto"] | null;
            body: string;
            /** Format: date-time */
            createdAt: string;
        };
        AdminReportDetailDto: {
            report: components["schemas"]["AdminReportRowDto"];
            post: components["schemas"]["AdminPostDetailDto"] | null;
            comment: components["schemas"]["AdminCommentDetailDto"] | null;
            user: components["schemas"]["AdminUserRowDto"] | null;
            /** @description Other reports about the same target */
            related: components["schemas"]["AdminReportRowDto"][];
            /** @description Internal notes — never shown to users */
            notes: components["schemas"]["ReportNoteDto"][];
            history: components["schemas"]["AuditLogDto"][];
        };
        AssignReportDto: {
            /**
             * Format: uuid
             * @description Staff member with reports.resolve, or null to unassign
             */
            assigneeId: string | null;
        };
        ReportStatusChangeDto: {
            status: components["schemas"]["ReportStatus"];
            /** @description Resolution note (stored with the report) */
            note?: string;
        };
        CreateReportNoteDto: {
            body: string;
        };
        /** @enum {string} */
        ReportAction: "HIDE_CONTENT" | "REMOVE_CONTENT" | "RESTORE_CONTENT" | "WARN_USER" | "SUSPEND_USER" | "BAN_USER";
        ReportActionDto: {
            /** @example Repeated spam after warnings */
            reason: string;
            action: components["schemas"]["ReportAction"];
            /**
             * @description Resolve this report (and other pending reports on the target) afterwards
             * @default true
             */
            resolve: boolean;
            /**
             * Format: date-time
             * @description SUSPEND_USER: optional end of the suspension
             */
            expiresAt?: string;
            /** @description WARN_USER: message shown to the user (defaults to the reason) */
            warningMessage?: string;
            /** @description BAN_USER: exact username of the content owner */
            confirmUsername?: string;
        };
        /** @enum {string} */
        AnnouncementStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED";
        /** @enum {string} */
        AnnouncementAudience: "ALL" | "SELECTED";
        AnnouncementDto: {
            /** Format: uuid */
            id: string;
            title: string;
            body: string;
            audience: components["schemas"]["AnnouncementAudience"];
            status: components["schemas"]["AnnouncementStatus"];
            /** @description Audience size at publish time */
            recipientCount: number | null;
            /** @description Recipients who opened it (in-app read receipts) */
            readCount: number;
            /** @description Usernames for SELECTED audiences (max 50 listed) */
            selectedUsernames: string[];
            /** @description Total selected recipients */
            selectedCount: number;
            createdBy: components["schemas"]["AdminUserRefDto"] | null;
            publishedBy: components["schemas"]["AdminUserRefDto"] | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: date-time */
            archivedAt: string | null;
        };
        AdminPageAnnouncement: {
            items: components["schemas"]["AnnouncementDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        SaveAnnouncementDto: {
            title: string;
            body: string;
            audience: components["schemas"]["AnnouncementAudience"];
            /** @description SELECTED audience: up to 1000 usernames */
            recipientUsernames?: string[];
        };
        GeneralSettingsDto: {
            /** @example Circle */
            platformName: string;
            /** @example A little more connection. */
            description: string;
            /**
             * @description Public contact address ("" for none)
             * @example support@example.com
             */
            supportEmail: string;
            /**
             * @description Banner shown to everyone while not empty
             * @example
             */
            maintenanceMessage: string;
            /**
             * @description Read-only mode: ordinary users cannot create or change content. Staff and sign-in are never blocked.
             * @example false
             */
            readOnlyMode: boolean;
        };
        PostSettingsDto: {
            /** @example 5000 */
            maxLength: number;
            /** @example 4 */
            maxMedia: number;
            /** @description Used when a client omits visibility */
            defaultVisibility: components["schemas"]["PostVisibility"];
        };
        MediaSettingsDto: {
            /**
             * @description MB; cannot exceed the server hard limit (MEDIA_MAX_IMAGE_BYTES)
             * @example 10
             */
            maxImageMb: number;
            /**
             * @description MB; cannot exceed the server hard limit (MEDIA_MAX_VIDEO_BYTES)
             * @example 100
             */
            maxVideoMb: number;
            /**
             * @example [
             *       "image/jpeg",
             *       "image/png",
             *       "image/webp",
             *       "image/gif"
             *     ]
             */
            allowedImageTypes: ("image/jpeg" | "image/png" | "image/webp" | "image/gif")[];
            /**
             * @example [
             *       "video/mp4",
             *       "video/webm",
             *       "video/quicktime"
             *     ]
             */
            allowedVideoTypes: ("video/mp4" | "video/webm" | "video/quicktime")[];
        };
        CommentSettingsDto: {
            /** @example 2000 */
            maxLength: number;
            /**
             * @description Maximum thread depth (1 = no replies)
             * @example 6
             */
            maxDepth: number;
        };
        ModerationSettingsDto: {
            /** @description Reasons users may choose */
            allowedReportReasons: components["schemas"]["ReportReason"][];
        };
        PlatformSettingsDto: {
            general: components["schemas"]["GeneralSettingsDto"];
            features: components["schemas"]["FeatureFlagsDto"];
            posts: components["schemas"]["PostSettingsDto"];
            media: components["schemas"]["MediaSettingsDto"];
            comments: components["schemas"]["CommentSettingsDto"];
            moderation: components["schemas"]["ModerationSettingsDto"];
        };
        SettingsLimitsDto: {
            /**
             * @description Server hard limit for images (MB), from environment
             * @example 10
             */
            maxImageMb: number;
            /**
             * @description Server hard limit for videos (MB), from environment
             * @example 100
             */
            maxVideoMb: number;
        };
        AdminSettingsResponseDto: {
            settings: components["schemas"]["PlatformSettingsDto"];
            limits: components["schemas"]["SettingsLimitsDto"];
            /** Format: date-time */
            updatedAt: string | null;
            /** @example jane_admin */
            updatedBy: string | null;
        };
        UpdatePlatformSettingsDto: {
            general?: components["schemas"]["GeneralSettingsDto"];
            features?: components["schemas"]["FeatureFlagsDto"];
            posts?: components["schemas"]["PostSettingsDto"];
            media?: components["schemas"]["MediaSettingsDto"];
            comments?: components["schemas"]["CommentSettingsDto"];
            moderation?: components["schemas"]["ModerationSettingsDto"];
        };
        RoleInfoDto: {
            role: components["schemas"]["UserRole"];
            rank: number;
            permissions: string[];
            memberCount: number;
            /** @description Whether the current admin may grant this role */
            assignable: boolean;
        };
        RolesOverviewDto: {
            roles: components["schemas"]["RoleInfoDto"][];
            /** @description Every permission known to the server */
            allPermissions: string[];
            /** @description All staff accounts (max 500) */
            staff: components["schemas"]["AdminUserRowDto"][];
            /** @description Latest 20 role changes */
            recentChanges: components["schemas"]["AuditLogDto"][];
        };
        AdminPageAuditLog: {
            items: components["schemas"]["AuditLogDto"][];
            /** @example 1 */
            page: number;
            /** @example 25 */
            pageSize: number;
            /** @example 120 */
            total: number;
        };
        ApiInfoDto: {
            /** @example 0.0.1 */
            appVersion: string;
            /** @example 1.3.0 */
            apiVersion: string;
            /**
             * @description NODE_ENV classification only
             * @example development
             */
            environment: string;
            /** @example v24.20.0 */
            nodeVersion: string;
            uptimeSeconds: number;
            /** Format: date-time */
            startedAt: string;
        };
        DatabaseHealthDto: {
            /** @enum {string} */
            status: "OK" | "DEGRADED" | "DOWN";
            latencyMs: number | null;
            detail: string | null;
            /** @example PostgreSQL 18.6 */
            version: string | null;
            appliedMigrations: number;
            pendingMigrations: string[];
        };
        StorageHealthDto: {
            /** @enum {string} */
            status: "OK" | "DEGRADED" | "DOWN";
            latencyMs: number | null;
            detail: string | null;
            /** @example local */
            driver: string;
            /** @description Free bytes on the media volume (local driver) */
            freeBytes: number | null;
            totalBytes: number | null;
        };
        JobStatusDto: {
            name: string;
            schedule: string;
            description: string;
            /** Format: date-time */
            lastRunAt: string | null;
            /** @enum {string|null} */
            lastStatus: "OK" | "FAILED" | null;
            lastDetail: string | null;
        };
        RecentErrorDto: {
            /** Format: date-time */
            at: string;
            requestId: string | null;
            method: string;
            path: string;
            statusCode: number;
            /** @description Error class and truncated message (no request data) */
            error: string;
        };
        SystemStatusDto: {
            /** Format: date-time */
            checkedAt: string;
            api: components["schemas"]["ApiInfoDto"];
            database: components["schemas"]["DatabaseHealthDto"];
            storage: components["schemas"]["StorageHealthDto"];
            jobs: components["schemas"]["JobStatusDto"][];
            /** @description Last 50 server errors since this process started */
            recentErrors: components["schemas"]["RecentErrorDto"][];
            /** Format: date-time */
            settingsUpdatedAt: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    platformConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicPlatformConfigDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaUploadsStart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StartUploadDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadSessionDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Uploaded file is too large (`FILE_TOO_LARGE`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaUploadsStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadSessionDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaUploadsChunk: {
        parameters: {
            query: {
                /** @description Byte offset of this piece (must equal `received`) */
                offset: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadSessionDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Uploaded file is too large (`FILE_TOO_LARGE`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaUploadsComplete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Uploaded file is too large (`FILE_TOO_LARGE`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Unsupported media type (`UNSUPPORTED_MEDIA_TYPE`) */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadMediaDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Uploaded file is too large (`FILE_TOO_LARGE`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Unsupported media type (`UNSUPPORTED_MEDIA_TYPE`) */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaFile: {
        parameters: {
            query: {
                exp: number;
                sig: string;
            };
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File contents (supports HTTP Range requests) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": components["schemas"]["ErrorResponseDto"];
                    "image/png": components["schemas"]["ErrorResponseDto"];
                    "image/webp": components["schemas"]["ErrorResponseDto"];
                    "image/gif": components["schemas"]["ErrorResponseDto"];
                    "video/mp4": components["schemas"]["ErrorResponseDto"];
                    "video/webm": components["schemas"]["ErrorResponseDto"];
                    "video/quicktime": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": components["schemas"]["ErrorResponseDto"];
                    "image/png": components["schemas"]["ErrorResponseDto"];
                    "image/webp": components["schemas"]["ErrorResponseDto"];
                    "image/gif": components["schemas"]["ErrorResponseDto"];
                    "video/mp4": components["schemas"]["ErrorResponseDto"];
                    "video/webm": components["schemas"]["ErrorResponseDto"];
                    "video/quicktime": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": components["schemas"]["ErrorResponseDto"];
                    "image/png": components["schemas"]["ErrorResponseDto"];
                    "image/webp": components["schemas"]["ErrorResponseDto"];
                    "image/gif": components["schemas"]["ErrorResponseDto"];
                    "video/mp4": components["schemas"]["ErrorResponseDto"];
                    "video/webm": components["schemas"]["ErrorResponseDto"];
                    "video/quicktime": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    mediaRemove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersGetMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersUpdateMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProfileDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersSetAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadMediaDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Uploaded file is too large (`FILE_TOO_LARGE`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Unsupported media type (`UNSUPPORTED_MEDIA_TYPE`) */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersRemoveAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersSetCover: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadMediaDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Uploaded file is too large (`FILE_TOO_LARGE`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Unsupported media type (`UNSUPPORTED_MEDIA_TYPE`) */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersRemoveCover: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    usersGetProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserProfileDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authRegister: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authRefresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshTokenDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authBackgroundSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponseDto"];
                };
            };
            /**
             * @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`)
             *
             *     Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`)
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authLogoutAll: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All sessions revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    authChangePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePasswordDto"];
            };
        };
        responses: {
            /** @description Password changed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    notificationsList: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Only unread notifications */
                unreadOnly?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedNotification"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    notificationsUnreadCount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CountDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    notificationsMarkAllRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarkAllReadResultDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    notificationsMarkRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Marked as read */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsListRequests: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedFollowRequest"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsAccept: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Requester id */
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Request approved */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Requester id */
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Request declined */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsRemoveFollower: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Follower removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsSuggestions: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuggestedUsersDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsListBlocks: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedBlockedUser"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsFollow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsUnfollow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsBlock: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlockResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsUnblock: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlockResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsFollowers: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUserListItem"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    followsFollowing: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUserListItem"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postsCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePostDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PostDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postsGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PostDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postsRemove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postsUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePostDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PostDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Request is valid but cannot be processed in the current state */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postsEngagement: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EngagementSummaryDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postsByUser: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Server-side attachment classification; reposts/quotes resolve their original. home excludes every VIDEO attachment, including processing videos. */
                content?: "home" | "reels" | "all";
                /** @description Comma-separated kinds to include (default: all) */
                kinds?: components["schemas"]["PostKind"][];
            };
            header?: never;
            path: {
                /** @description User id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postInteractionsGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InteractionSummaryDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    postInteractionsRespond: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RespondInteractionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InteractionSummaryDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    likesLikePost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LikeResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    likesUnlikePost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LikeResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    likesLikers: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUserListItem"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    likesLikeComment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LikeResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    likesUnlikeComment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LikeResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsListForPost: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                sort?: components["schemas"]["CommentSort"];
            };
            header?: never;
            path: {
                /** @description Post id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedComment"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsCreate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Post id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCommentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommentDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommentDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsRemove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCommentDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommentDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsReplies: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedComment"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    commentsReply: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Parent comment id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCommentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommentDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Request is valid but cannot be processed in the current state */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    bookmarksList: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    bookmarksAdd: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookmarkResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    bookmarksRemove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookmarkResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    repostsRepost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepostResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Request is valid but cannot be processed in the current state */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    repostsUndo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepostResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    repostsQuote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Post being quoted */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePostDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PostDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Request is valid but cannot be processed in the current state */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    repostsReposters: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUserListItem"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    repostsQuotes: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedGlobal: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Server-side attachment classification; reposts/quotes resolve their original. home excludes every VIDEO attachment, including processing videos. */
                content?: "home" | "reels" | "all";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedFollowing: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Server-side attachment classification; reposts/quotes resolve their original. home excludes every VIDEO attachment, including processing videos. */
                content?: "home" | "reels" | "all";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedReels: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Existing session for idempotent page refresh. Cursors already identify the session. */
                session?: string;
                /** @description Explicit Watch again: new cycle, retaining previous watch history. */
                rewatch?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReelsPageDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedExpose: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReelExposeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReelExposureDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedWatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReelWatchBatchDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedFeedback: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReelFeedbackDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`)
             *
             *     Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`)
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /**
             * @description Rate limit exceeded (`RATE_LIMITED`)
             *
             *     Rate limit exceeded (`RATE_LIMITED`)
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    feedExplore: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Server-side attachment classification; reposts/quotes resolve their original. home excludes every VIDEO attachment, including processing videos. */
                content?: "home" | "reels" | "all";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    searchUsers: {
        parameters: {
            query: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Search text */
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUserListItem"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    searchPosts: {
        parameters: {
            query: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                /** @description Search text */
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedPost"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description A bearer token was supplied but is invalid or expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    reportsCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateReportDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationList: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
                status?: components["schemas"]["ReportStatus"];
                targetType?: components["schemas"]["ReportTargetType"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedModerationReport"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationResolve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveReportDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationReportDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationRemovePost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationRestorePost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationRemoveComment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationRestoreComment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationSuspend: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationUnsuspend: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    moderationSetRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetRoleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    inboxList: {
        parameters: {
            query?: {
                /** @description Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedInboxItem"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    inboxUnread: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CountDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    inboxRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkInboxReadDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarkInboxReadResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminCoreMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMeDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminCoreStepUpToken: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepUpRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepUpResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminCoreDashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnalyticsOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OverviewDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnalyticsTimeseries: {
        parameters: {
            query: {
                /** @description Comma-separated: registrations, active_users, posts, reels, comments, likes, reposts, bookmarks, reports_created, reports_resolved */
                metrics: string[];
                from: string;
                to: string;
                interval?: "day" | "week" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeseriesResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnalyticsTop: {
        parameters: {
            query: {
                by?: "likes" | "comments" | "reposts" | "engagement";
                kind?: "posts" | "reels";
                /** @description Posts created from */
                from: string;
                /** @description Posts created before */
                to: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopContentResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersDeleteContent: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteUserContentDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletionResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersList: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Username / display name (and email for roles allowed to see emails) */
                q?: string;
                status?: components["schemas"]["UserStatus"];
                role?: components["schemas"]["UserRole"];
                /** @description Only staff accounts (any role above USER) */
                staff?: boolean;
                createdFrom?: string;
                createdTo?: string;
                sort?: "created" | "lastActive" | "followers" | "posts" | "reports";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAdminUserRow"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersDetail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDetailDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersSuspend: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SuspendUserDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountStatusResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersReinstate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountStatusResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersBan: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BanUserDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountStatusResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersUnban: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountStatusResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersWarn: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WarnUserDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WarningCreatedDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersRole: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeRoleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminUsersModerateContent: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkModerateUserContentDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkModerationResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentDeletePost: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletionResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentDeleteComment: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletionResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentPosts: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Inclusive lower bound (created at) */
                from?: string;
                /** @description Exclusive upper bound (created at) */
                to?: string;
                /** @description Text contained in the content */
                q?: string;
                status?: components["schemas"]["ContentFilterStatus"];
                /** @description Only content with reports (any status) */
                reported?: boolean;
                authorId?: string;
                sort?: "created" | "likes" | "comments" | "reposts" | "reports";
                /** @description TEXT = no attachments */
                type?: "TEXT" | "IMAGE" | "VIDEO";
                kind?: components["schemas"]["PostKind"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAdminPostRow"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentPost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPostDetailDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentModeratePost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerateContentDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationOutcomeDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentReels: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Inclusive lower bound (created at) */
                from?: string;
                /** @description Exclusive upper bound (created at) */
                to?: string;
                /** @description Text contained in the content */
                q?: string;
                status?: components["schemas"]["ContentFilterStatus"];
                /** @description Only content with reports (any status) */
                reported?: boolean;
                authorId?: string;
                sort?: "created" | "likes" | "comments" | "reposts" | "reports";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAdminReelRow"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentComments: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Inclusive lower bound (created at) */
                from?: string;
                /** @description Exclusive upper bound (created at) */
                to?: string;
                /** @description Text contained in the content */
                q?: string;
                status?: components["schemas"]["ContentFilterStatus"];
                /** @description Only content with reports (any status) */
                reported?: boolean;
                authorId?: string;
                sort?: "created" | "likes" | "comments" | "reposts" | "reports";
                postId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAdminCommentRow"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentComment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCommentDetailDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminContentModerateComment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerateContentDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationOutcomeDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminMediaList: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Inclusive lower bound (created at) */
                from?: string;
                /** @description Exclusive upper bound (created at) */
                to?: string;
                type?: components["schemas"]["MediaType"];
                usage?: components["schemas"]["MediaUsage"];
                status?: components["schemas"]["MediaStatus"];
                ownerId?: string;
                /** @description Minimum size in bytes */
                minSize?: number;
                /** @description Maximum size in bytes */
                maxSize?: number;
                sort?: "created" | "size";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAdminMediaRow"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminMediaScan: {
        parameters: {
            query?: {
                limit?: number;
                /** @description Continue after this media id (from `nextAfterId`) */
                afterId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaScanResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminMediaCleanupPreview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CleanupPreviewDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminMediaCleanup: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CleanupExecuteDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CleanupResultDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminMediaDetail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMediaRowDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminMediaHealth: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaHealthDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminReportsList: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Inclusive lower bound (created at) */
                from?: string;
                /** @description Exclusive upper bound (created at) */
                to?: string;
                /** @description PENDING = OPEN or IN_REVIEW */
                status?: "PENDING" | "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
                targetType?: components["schemas"]["AdminReportTargetFilter"];
                reason?: components["schemas"]["ReportReason"];
                assigned?: "any" | "me" | "unassigned";
                /** @description Reports about this target only */
                targetId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAdminReportRow"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminReportsDetail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminReportDetailDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminReportsAssign: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignReportDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminReportRowDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminReportsStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportStatusChangeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminReportRowDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminReportsNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateReportNoteDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportNoteDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminReportsAct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportActionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminReportRowDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnnouncementsList: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                status?: components["schemas"]["AnnouncementStatus"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAnnouncement"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnnouncementsCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveAnnouncementDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnnouncementsGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnnouncementsUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveAnnouncementDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnnouncementsPublish: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Conflict with existing state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminAnnouncementsArchive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Resource not found or not visible to the viewer */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminSettingsGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminSettingsResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminSettingsUpdate: {
        parameters: {
            query?: never;
            header: {
                /** @description Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`. */
                "X-Step-Up-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePlatformSettingsDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminSettingsResponseDto"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminSystemRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RolesOverviewDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminSystemAudit: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                order?: components["schemas"]["SortOrder"];
                /** @description Inclusive lower bound (created at) */
                from?: string;
                /** @description Exclusive upper bound (created at) */
                to?: string;
                actorId?: string;
                /** @description Exact action or prefix ending in "." (e.g. "user.") */
                action?: string;
                targetType?: "USER" | "POST" | "COMMENT" | "REPORT" | "MEDIA" | "ANNOUNCEMENT" | "SETTINGS" | "SYSTEM";
                targetId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPageAuditLog"];
                };
            };
            /** @description Validation failed (`VALIDATION_ERROR`) or malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded (`RATE_LIMITED`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminSystemActions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string[];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
    adminSystemSystem: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemStatusDto"];
                };
            };
            /** @description Missing or invalid session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseDto"];
                };
            };
        };
    };
}
