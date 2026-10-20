// Generated from docs/api/openapi.json. Do not edit.
export const endpoints = {
  "platformConfig": {
    "path": "/api/platform/config",
    "method": "GET",
    "authenticated": false
  },
  "mediaUploadsStart": {
    "path": "/api/media/uploads",
    "method": "POST",
    "authenticated": true
  },
  "mediaUploadsStatus": {
    "path": "/api/media/uploads/{id}",
    "method": "GET",
    "authenticated": true
  },
  "mediaUploadsChunk": {
    "path": "/api/media/uploads/{id}/chunks",
    "method": "POST",
    "authenticated": true
  },
  "mediaUploadsCompleteAudio": {
    "path": "/api/media/uploads/{id}/audio",
    "method": "POST",
    "authenticated": true
  },
  "mediaUploadsComplete": {
    "path": "/api/media/uploads/{id}/complete",
    "method": "POST",
    "authenticated": true
  },
  "mediaSoundtrack": {
    "path": "/api/media/{id}/soundtrack",
    "method": "POST",
    "authenticated": true
  },
  "mediaUpload": {
    "path": "/api/media",
    "method": "POST",
    "authenticated": true
  },
  "mediaFile": {
    "path": "/api/media/files/{key}",
    "method": "GET",
    "authenticated": false
  },
  "mediaGet": {
    "path": "/api/media/{id}",
    "method": "GET",
    "authenticated": true
  },
  "mediaRemove": {
    "path": "/api/media/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "usersGetMe": {
    "path": "/api/users/me",
    "method": "GET",
    "authenticated": true
  },
  "usersUpdateMe": {
    "path": "/api/users/me",
    "method": "PATCH",
    "authenticated": true
  },
  "usersSetAvatar": {
    "path": "/api/users/me/avatar",
    "method": "POST",
    "authenticated": true
  },
  "usersRemoveAvatar": {
    "path": "/api/users/me/avatar",
    "method": "DELETE",
    "authenticated": true
  },
  "usersSetAvatarMedia": {
    "path": "/api/users/me/avatar/media",
    "method": "POST",
    "authenticated": true
  },
  "usersSetCover": {
    "path": "/api/users/me/cover",
    "method": "POST",
    "authenticated": true
  },
  "usersRemoveCover": {
    "path": "/api/users/me/cover",
    "method": "DELETE",
    "authenticated": true
  },
  "usersSetCoverMedia": {
    "path": "/api/users/me/cover/media",
    "method": "POST",
    "authenticated": true
  },
  "usersGetProfile": {
    "path": "/api/users/{username}",
    "method": "GET",
    "authenticated": true
  },
  "authRegister": {
    "path": "/api/auth/register",
    "method": "POST",
    "authenticated": false
  },
  "authLogin": {
    "path": "/api/auth/login",
    "method": "POST",
    "authenticated": false
  },
  "authRefresh": {
    "path": "/api/auth/refresh",
    "method": "POST",
    "authenticated": false
  },
  "authLogout": {
    "path": "/api/auth/logout",
    "method": "POST",
    "authenticated": true
  },
  "authBackgroundSession": {
    "path": "/api/auth/background-session",
    "method": "POST",
    "authenticated": true
  },
  "authLogoutAll": {
    "path": "/api/auth/logout-all",
    "method": "POST",
    "authenticated": true
  },
  "authChangePassword": {
    "path": "/api/auth/change-password",
    "method": "POST",
    "authenticated": true
  },
  "notificationsList": {
    "path": "/api/notifications",
    "method": "GET",
    "authenticated": true
  },
  "notificationsUnreadCount": {
    "path": "/api/notifications/unread-count",
    "method": "GET",
    "authenticated": true
  },
  "notificationsMarkAllRead": {
    "path": "/api/notifications/read-all",
    "method": "POST",
    "authenticated": true
  },
  "notificationsMarkRead": {
    "path": "/api/notifications/{id}/read",
    "method": "POST",
    "authenticated": true
  },
  "followsListRequests": {
    "path": "/api/users/me/follow-requests",
    "method": "GET",
    "authenticated": true
  },
  "followsAccept": {
    "path": "/api/users/me/follow-requests/{userId}/accept",
    "method": "POST",
    "authenticated": true
  },
  "followsReject": {
    "path": "/api/users/me/follow-requests/{userId}",
    "method": "DELETE",
    "authenticated": true
  },
  "followsRemoveFollower": {
    "path": "/api/users/me/followers/{userId}",
    "method": "DELETE",
    "authenticated": true
  },
  "followsSuggestions": {
    "path": "/api/users/me/suggestions",
    "method": "GET",
    "authenticated": true
  },
  "followsListBlocks": {
    "path": "/api/users/me/blocks",
    "method": "GET",
    "authenticated": true
  },
  "followsFollow": {
    "path": "/api/users/{id}/follow",
    "method": "POST",
    "authenticated": true
  },
  "followsUnfollow": {
    "path": "/api/users/{id}/follow",
    "method": "DELETE",
    "authenticated": true
  },
  "followsBlock": {
    "path": "/api/users/{id}/block",
    "method": "POST",
    "authenticated": true
  },
  "followsUnblock": {
    "path": "/api/users/{id}/block",
    "method": "DELETE",
    "authenticated": true
  },
  "followsFollowers": {
    "path": "/api/users/{id}/followers",
    "method": "GET",
    "authenticated": true
  },
  "followsFollowing": {
    "path": "/api/users/{id}/following",
    "method": "GET",
    "authenticated": true
  },
  "postsCreate": {
    "path": "/api/posts",
    "method": "POST",
    "authenticated": true
  },
  "postsGet": {
    "path": "/api/posts/{id}",
    "method": "GET",
    "authenticated": true
  },
  "postsUpdate": {
    "path": "/api/posts/{id}",
    "method": "PATCH",
    "authenticated": true
  },
  "postsRemove": {
    "path": "/api/posts/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "postsEngagement": {
    "path": "/api/posts/{id}/engagement",
    "method": "GET",
    "authenticated": true
  },
  "postsByUser": {
    "path": "/api/users/{id}/posts",
    "method": "GET",
    "authenticated": true
  },
  "postInteractionsGet": {
    "path": "/api/posts/{id}/interaction",
    "method": "GET",
    "authenticated": true
  },
  "postInteractionsRespond": {
    "path": "/api/posts/{id}/interaction",
    "method": "POST",
    "authenticated": true
  },
  "likesLikePost": {
    "path": "/api/posts/{id}/like",
    "method": "POST",
    "authenticated": true
  },
  "likesUnlikePost": {
    "path": "/api/posts/{id}/like",
    "method": "DELETE",
    "authenticated": true
  },
  "likesLikers": {
    "path": "/api/posts/{id}/likes",
    "method": "GET",
    "authenticated": true
  },
  "likesLikeComment": {
    "path": "/api/comments/{id}/like",
    "method": "POST",
    "authenticated": true
  },
  "likesUnlikeComment": {
    "path": "/api/comments/{id}/like",
    "method": "DELETE",
    "authenticated": true
  },
  "commentsListForPost": {
    "path": "/api/posts/{id}/comments",
    "method": "GET",
    "authenticated": true
  },
  "commentsCreate": {
    "path": "/api/posts/{id}/comments",
    "method": "POST",
    "authenticated": true
  },
  "commentsGet": {
    "path": "/api/comments/{id}",
    "method": "GET",
    "authenticated": true
  },
  "commentsUpdate": {
    "path": "/api/comments/{id}",
    "method": "PATCH",
    "authenticated": true
  },
  "commentsRemove": {
    "path": "/api/comments/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "commentsReplies": {
    "path": "/api/comments/{id}/replies",
    "method": "GET",
    "authenticated": true
  },
  "commentsReply": {
    "path": "/api/comments/{id}/replies",
    "method": "POST",
    "authenticated": true
  },
  "gifsList": {
    "path": "/api/gifs",
    "method": "GET",
    "authenticated": true
  },
  "bookmarksList": {
    "path": "/api/users/me/bookmarks",
    "method": "GET",
    "authenticated": true
  },
  "bookmarksAdd": {
    "path": "/api/posts/{id}/bookmark",
    "method": "POST",
    "authenticated": true
  },
  "bookmarksRemove": {
    "path": "/api/posts/{id}/bookmark",
    "method": "DELETE",
    "authenticated": true
  },
  "repostsRepost": {
    "path": "/api/posts/{id}/repost",
    "method": "POST",
    "authenticated": true
  },
  "repostsUndo": {
    "path": "/api/posts/{id}/repost",
    "method": "DELETE",
    "authenticated": true
  },
  "repostsQuote": {
    "path": "/api/posts/{id}/quote",
    "method": "POST",
    "authenticated": true
  },
  "repostsReposters": {
    "path": "/api/posts/{id}/reposts",
    "method": "GET",
    "authenticated": true
  },
  "repostsQuotes": {
    "path": "/api/posts/{id}/quotes",
    "method": "GET",
    "authenticated": true
  },
  "feedGlobal": {
    "path": "/api/feed/global",
    "method": "GET",
    "authenticated": true
  },
  "feedFollowing": {
    "path": "/api/feed/following",
    "method": "GET",
    "authenticated": true
  },
  "feedReels": {
    "path": "/api/feed/reels",
    "method": "GET",
    "authenticated": true
  },
  "feedExpose": {
    "path": "/api/feed/reels/expose",
    "method": "POST",
    "authenticated": true
  },
  "feedWatch": {
    "path": "/api/feed/reels/watch",
    "method": "POST",
    "authenticated": true
  },
  "feedFeedback": {
    "path": "/api/feed/reels/feedback",
    "method": "POST",
    "authenticated": true
  },
  "feedExplore": {
    "path": "/api/feed/explore",
    "method": "GET",
    "authenticated": true
  },
  "searchUsers": {
    "path": "/api/search/users",
    "method": "GET",
    "authenticated": true
  },
  "searchPosts": {
    "path": "/api/search/posts",
    "method": "GET",
    "authenticated": true
  },
  "reportsCreate": {
    "path": "/api/reports",
    "method": "POST",
    "authenticated": true
  },
  "moderationList": {
    "path": "/api/moderation/reports",
    "method": "GET",
    "authenticated": true
  },
  "moderationResolve": {
    "path": "/api/moderation/reports/{id}",
    "method": "PATCH",
    "authenticated": true
  },
  "moderationRemovePost": {
    "path": "/api/moderation/posts/{id}/remove",
    "method": "POST",
    "authenticated": true
  },
  "moderationRestorePost": {
    "path": "/api/moderation/posts/{id}/restore",
    "method": "POST",
    "authenticated": true
  },
  "moderationRemoveComment": {
    "path": "/api/moderation/comments/{id}/remove",
    "method": "POST",
    "authenticated": true
  },
  "moderationRestoreComment": {
    "path": "/api/moderation/comments/{id}/restore",
    "method": "POST",
    "authenticated": true
  },
  "moderationSuspend": {
    "path": "/api/moderation/users/{id}/suspend",
    "method": "POST",
    "authenticated": true
  },
  "moderationUnsuspend": {
    "path": "/api/moderation/users/{id}/unsuspend",
    "method": "POST",
    "authenticated": true
  },
  "moderationSetRole": {
    "path": "/api/moderation/users/{id}/role",
    "method": "PATCH",
    "authenticated": true
  },
  "inboxList": {
    "path": "/api/users/me/inbox",
    "method": "GET",
    "authenticated": true
  },
  "inboxUnread": {
    "path": "/api/users/me/inbox/unread-count",
    "method": "GET",
    "authenticated": true
  },
  "inboxRead": {
    "path": "/api/users/me/inbox/read",
    "method": "POST",
    "authenticated": true
  },
  "messagesEdit": {
    "path": "/api/messages/{id}",
    "method": "PATCH",
    "authenticated": true
  },
  "messagesList": {
    "path": "/api/messages/{id}",
    "method": "GET",
    "authenticated": true
  },
  "messagesSend": {
    "path": "/api/messages/{id}",
    "method": "POST",
    "authenticated": true
  },
  "messagesDelete": {
    "path": "/api/messages/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "messagesPendingDelivery": {
    "path": "/api/messages/delivery",
    "method": "GET",
    "authenticated": true
  },
  "messagesDelivered": {
    "path": "/api/messages/delivery",
    "method": "POST",
    "authenticated": true
  },
  "messagesUploadAudio": {
    "path": "/api/messages/audio",
    "method": "POST",
    "authenticated": true
  },
  "messagesDeleteAudio": {
    "path": "/api/messages/audio/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "messagesPeer": {
    "path": "/api/messages/peer/{username}",
    "method": "GET",
    "authenticated": true
  },
  "messagesConversations": {
    "path": "/api/messages",
    "method": "GET",
    "authenticated": true
  },
  "messagesUnread": {
    "path": "/api/messages/unread-count",
    "method": "GET",
    "authenticated": true
  },
  "messagesStatus": {
    "path": "/api/messages/{id}/status",
    "method": "GET",
    "authenticated": true
  },
  "messagesTyping": {
    "path": "/api/messages/{id}/typing",
    "method": "POST",
    "authenticated": true
  },
  "messagesStopTyping": {
    "path": "/api/messages/{id}/typing",
    "method": "DELETE",
    "authenticated": true
  },
  "messagesOpen": {
    "path": "/api/messages/{id}/open",
    "method": "POST",
    "authenticated": true
  },
  "messagesAccept": {
    "path": "/api/messages/{id}/accept",
    "method": "POST",
    "authenticated": true
  },
  "messagesDeleteConversation": {
    "path": "/api/messages/{id}/conversation",
    "method": "DELETE",
    "authenticated": true
  },
  "messagesDecline": {
    "path": "/api/messages/{id}/request",
    "method": "DELETE",
    "authenticated": true
  },
  "messagesRead": {
    "path": "/api/messages/{id}/read",
    "method": "POST",
    "authenticated": true
  },
  "groupsCreate": {
    "path": "/api/group-chats",
    "method": "POST",
    "authenticated": true
  },
  "groupsList": {
    "path": "/api/group-chats",
    "method": "GET",
    "authenticated": true
  },
  "groupsGet": {
    "path": "/api/group-chats/{id}",
    "method": "GET",
    "authenticated": true
  },
  "groupsRename": {
    "path": "/api/group-chats/{id}",
    "method": "PATCH",
    "authenticated": true
  },
  "groupsSetAvatar": {
    "path": "/api/group-chats/{id}/avatar",
    "method": "POST",
    "authenticated": true
  },
  "groupsRemoveAvatar": {
    "path": "/api/group-chats/{id}/avatar",
    "method": "DELETE",
    "authenticated": true
  },
  "groupsAddMembers": {
    "path": "/api/group-chats/{id}/members",
    "method": "POST",
    "authenticated": true
  },
  "groupsRemoveMember": {
    "path": "/api/group-chats/{id}/members/{userId}",
    "method": "DELETE",
    "authenticated": true
  },
  "groupsLeave": {
    "path": "/api/group-chats/{id}/membership",
    "method": "DELETE",
    "authenticated": true
  },
  "groupsMessages": {
    "path": "/api/group-chats/{id}/messages",
    "method": "GET",
    "authenticated": true
  },
  "groupsSend": {
    "path": "/api/group-chats/{id}/messages",
    "method": "POST",
    "authenticated": true
  },
  "groupsEdit": {
    "path": "/api/group-chats/{id}/messages/{messageId}",
    "method": "PATCH",
    "authenticated": true
  },
  "groupsUnsend": {
    "path": "/api/group-chats/{id}/messages/{messageId}",
    "method": "DELETE",
    "authenticated": true
  },
  "groupsAcknowledge": {
    "path": "/api/group-chats/{id}/receipts",
    "method": "POST",
    "authenticated": true
  },
  "storiesList": {
    "path": "/api/stories",
    "method": "GET",
    "authenticated": true
  },
  "storiesCreate": {
    "path": "/api/stories",
    "method": "POST",
    "authenticated": true
  },
  "storiesView": {
    "path": "/api/stories/{id}/view",
    "method": "POST",
    "authenticated": true
  },
  "storiesLike": {
    "path": "/api/stories/{id}/like",
    "method": "POST",
    "authenticated": true
  },
  "storiesUnlike": {
    "path": "/api/stories/{id}/like",
    "method": "DELETE",
    "authenticated": true
  },
  "storiesReply": {
    "path": "/api/stories/{id}/reply",
    "method": "POST",
    "authenticated": true
  },
  "storiesViewers": {
    "path": "/api/stories/{id}/viewers",
    "method": "GET",
    "authenticated": true
  },
  "storiesDelete": {
    "path": "/api/stories/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "stickersFavorite": {
    "path": "/api/stickers/{id}/favorite",
    "method": "POST",
    "authenticated": true
  },
  "stickersUnfavorite": {
    "path": "/api/stickers/{id}/favorite",
    "method": "DELETE",
    "authenticated": true
  },
  "stickersList": {
    "path": "/api/stickers",
    "method": "GET",
    "authenticated": true
  },
  "stickersCreate": {
    "path": "/api/stickers",
    "method": "POST",
    "authenticated": true
  },
  "stickersDelete": {
    "path": "/api/stickers/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "notesList": {
    "path": "/api/notes",
    "method": "GET",
    "authenticated": true
  },
  "notesCreate": {
    "path": "/api/notes",
    "method": "POST",
    "authenticated": true
  },
  "notesDelete": {
    "path": "/api/notes/me",
    "method": "DELETE",
    "authenticated": true
  },
  "notesReply": {
    "path": "/api/notes/{id}/reply",
    "method": "POST",
    "authenticated": true
  },
  "notesUploadAudio": {
    "path": "/api/notes/audio",
    "method": "POST",
    "authenticated": true
  },
  "pushKey": {
    "path": "/api/push/key",
    "method": "GET",
    "authenticated": true
  },
  "pushSubscribe": {
    "path": "/api/push/subscriptions",
    "method": "POST",
    "authenticated": true
  },
  "pushUnsubscribe": {
    "path": "/api/push/subscriptions/remove",
    "method": "POST",
    "authenticated": true
  },
  "pushTest": {
    "path": "/api/push/test",
    "method": "POST",
    "authenticated": true
  },
  "callsConfig": {
    "path": "/api/calls/config",
    "method": "GET",
    "authenticated": true
  },
  "callsCurrent": {
    "path": "/api/calls/current",
    "method": "GET",
    "authenticated": true
  },
  "callsStart": {
    "path": "/api/calls",
    "method": "POST",
    "authenticated": true
  },
  "callsPoll": {
    "path": "/api/calls/{id}",
    "method": "GET",
    "authenticated": true
  },
  "callsAction": {
    "path": "/api/calls/{id}/action",
    "method": "POST",
    "authenticated": true
  },
  "callsSignal": {
    "path": "/api/calls/{id}/signals",
    "method": "POST",
    "authenticated": true
  },
  "messagesStreak": {
    "path": "/api/messages/{id}/streak",
    "method": "GET",
    "authenticated": true
  },
  "messagesRestoreStreak": {
    "path": "/api/messages/{id}/streak/restore",
    "method": "POST",
    "authenticated": true
  },
  "circlesList": {
    "path": "/api/circles",
    "method": "GET",
    "authenticated": true
  },
  "circlesCreate": {
    "path": "/api/circles",
    "method": "POST",
    "authenticated": true
  },
  "circlesInvite": {
    "path": "/api/circles/invites/{code}",
    "method": "GET",
    "authenticated": true
  },
  "circlesJoin": {
    "path": "/api/circles/join",
    "method": "POST",
    "authenticated": true
  },
  "circlesGet": {
    "path": "/api/circles/{id}",
    "method": "GET",
    "authenticated": true
  },
  "circlesUpdate": {
    "path": "/api/circles/{id}",
    "method": "PATCH",
    "authenticated": true
  },
  "circlesDelete": {
    "path": "/api/circles/{id}",
    "method": "DELETE",
    "authenticated": true
  },
  "circlesResetInvite": {
    "path": "/api/circles/{id}/invite/reset",
    "method": "POST",
    "authenticated": true
  },
  "circlesLeave": {
    "path": "/api/circles/{id}/leave",
    "method": "POST",
    "authenticated": true
  },
  "circlesMembers": {
    "path": "/api/circles/{id}/members",
    "method": "GET",
    "authenticated": true
  },
  "circlesSetRole": {
    "path": "/api/circles/{id}/members/{userId}/role",
    "method": "POST",
    "authenticated": true
  },
  "circlesRemoveMember": {
    "path": "/api/circles/{id}/members/{userId}",
    "method": "DELETE",
    "authenticated": true
  },
  "circlesFeed": {
    "path": "/api/circles/{id}/posts",
    "method": "GET",
    "authenticated": true
  },
  "circlesCreatePost": {
    "path": "/api/circles/{id}/posts",
    "method": "POST",
    "authenticated": true
  },
  "circlesDeletePost": {
    "path": "/api/circles/{id}/posts/{postId}",
    "method": "DELETE",
    "authenticated": true
  },
  "circlesToday": {
    "path": "/api/circles/{id}/today",
    "method": "GET",
    "authenticated": true
  },
  "circlesPromptHistory": {
    "path": "/api/circles/{id}/prompts",
    "method": "GET",
    "authenticated": true
  },
  "circlesSetPrompt": {
    "path": "/api/circles/{id}/prompts",
    "method": "POST",
    "authenticated": true
  },
  "circlesAlbums": {
    "path": "/api/circles/{id}/albums",
    "method": "GET",
    "authenticated": true
  },
  "circlesCreateAlbum": {
    "path": "/api/circles/{id}/albums",
    "method": "POST",
    "authenticated": true
  },
  "circlesAlbumItems": {
    "path": "/api/circles/{id}/albums/{albumId}/items",
    "method": "GET",
    "authenticated": true
  },
  "circlesDeleteAlbum": {
    "path": "/api/circles/{id}/albums/{albumId}",
    "method": "DELETE",
    "authenticated": true
  },
  "previewsPost": {
    "path": "/api/posts/{id}/preview.jpg",
    "method": "GET",
    "authenticated": false
  },
  "previewsAvatar": {
    "path": "/api/users/{username}/avatar.jpg",
    "method": "GET",
    "authenticated": false
  },
  "adminImporterRequest": {
    "path": "/api/admin/importer/request",
    "method": "POST",
    "authenticated": true
  },
  "adminCoreMe": {
    "path": "/api/admin/me",
    "method": "GET",
    "authenticated": true
  },
  "adminCoreStepUpToken": {
    "path": "/api/admin/step-up",
    "method": "POST",
    "authenticated": true
  },
  "adminCoreDashboard": {
    "path": "/api/admin/dashboard",
    "method": "GET",
    "authenticated": true
  },
  "adminAnalyticsOverview": {
    "path": "/api/admin/analytics/overview",
    "method": "GET",
    "authenticated": true
  },
  "adminAnalyticsTimeseries": {
    "path": "/api/admin/analytics/timeseries",
    "method": "GET",
    "authenticated": true
  },
  "adminAnalyticsTop": {
    "path": "/api/admin/analytics/top-content",
    "method": "GET",
    "authenticated": true
  },
  "adminUsersSessions": {
    "path": "/api/admin/users/{id}/sessions",
    "method": "GET",
    "authenticated": true
  },
  "adminUsersRevokeSessions": {
    "path": "/api/admin/users/{id}/sessions/revoke",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersRevokeSession": {
    "path": "/api/admin/users/{id}/sessions/{sessionId}/revoke",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersResetPassword": {
    "path": "/api/admin/users/{id}/password",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersUpdateProfile": {
    "path": "/api/admin/users/{id}/profile",
    "method": "PATCH",
    "authenticated": true
  },
  "adminUsersActivity": {
    "path": "/api/admin/users/{id}/activity",
    "method": "GET",
    "authenticated": true
  },
  "adminUsersNotes": {
    "path": "/api/admin/users/{id}/notes",
    "method": "GET",
    "authenticated": true
  },
  "adminUsersAddNote": {
    "path": "/api/admin/users/{id}/notes",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersDeleteNote": {
    "path": "/api/admin/users/{id}/notes/{noteId}",
    "method": "DELETE",
    "authenticated": true
  },
  "adminUsersDeleteAccount": {
    "path": "/api/admin/users/{id}/delete",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersDeleteContent": {
    "path": "/api/admin/users/{id}/content/delete",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersList": {
    "path": "/api/admin/users",
    "method": "GET",
    "authenticated": true
  },
  "adminUsersDetail": {
    "path": "/api/admin/users/{id}",
    "method": "GET",
    "authenticated": true
  },
  "adminUsersSuspend": {
    "path": "/api/admin/users/{id}/suspend",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersReinstate": {
    "path": "/api/admin/users/{id}/reinstate",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersBan": {
    "path": "/api/admin/users/{id}/ban",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersUnban": {
    "path": "/api/admin/users/{id}/unban",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersWarn": {
    "path": "/api/admin/users/{id}/warnings",
    "method": "POST",
    "authenticated": true
  },
  "adminUsersRole": {
    "path": "/api/admin/users/{id}/role",
    "method": "PATCH",
    "authenticated": true
  },
  "adminUsersSetVerified": {
    "path": "/api/admin/users/{id}/verified",
    "method": "PATCH",
    "authenticated": true
  },
  "adminUsersModerateContent": {
    "path": "/api/admin/users/{id}/content/moderation",
    "method": "POST",
    "authenticated": true
  },
  "adminContentSetPinned": {
    "path": "/api/admin/posts/{id}/pin",
    "method": "POST",
    "authenticated": true
  },
  "adminContentDeletePost": {
    "path": "/api/admin/posts/{id}/delete",
    "method": "POST",
    "authenticated": true
  },
  "adminContentDeleteComment": {
    "path": "/api/admin/comments/{id}/delete",
    "method": "POST",
    "authenticated": true
  },
  "adminContentPosts": {
    "path": "/api/admin/posts",
    "method": "GET",
    "authenticated": true
  },
  "adminContentPost": {
    "path": "/api/admin/posts/{id}",
    "method": "GET",
    "authenticated": true
  },
  "adminContentModeratePost": {
    "path": "/api/admin/posts/{id}/moderation",
    "method": "POST",
    "authenticated": true
  },
  "adminContentReels": {
    "path": "/api/admin/reels",
    "method": "GET",
    "authenticated": true
  },
  "adminContentComments": {
    "path": "/api/admin/comments",
    "method": "GET",
    "authenticated": true
  },
  "adminContentComment": {
    "path": "/api/admin/comments/{id}",
    "method": "GET",
    "authenticated": true
  },
  "adminContentModerateComment": {
    "path": "/api/admin/comments/{id}/moderation",
    "method": "POST",
    "authenticated": true
  },
  "adminMediaList": {
    "path": "/api/admin/media",
    "method": "GET",
    "authenticated": true
  },
  "adminMediaScan": {
    "path": "/api/admin/media/scan",
    "method": "GET",
    "authenticated": true
  },
  "adminMediaCleanupPreview": {
    "path": "/api/admin/media/cleanup",
    "method": "GET",
    "authenticated": true
  },
  "adminMediaCleanup": {
    "path": "/api/admin/media/cleanup",
    "method": "POST",
    "authenticated": true
  },
  "adminMediaDetail": {
    "path": "/api/admin/media/{id}",
    "method": "GET",
    "authenticated": true
  },
  "adminMediaHealth": {
    "path": "/api/admin/media/{id}/health",
    "method": "GET",
    "authenticated": true
  },
  "adminReportsList": {
    "path": "/api/admin/reports",
    "method": "GET",
    "authenticated": true
  },
  "adminReportsDetail": {
    "path": "/api/admin/reports/{id}",
    "method": "GET",
    "authenticated": true
  },
  "adminReportsAssign": {
    "path": "/api/admin/reports/{id}/assignee",
    "method": "PATCH",
    "authenticated": true
  },
  "adminReportsStatus": {
    "path": "/api/admin/reports/{id}/status",
    "method": "PATCH",
    "authenticated": true
  },
  "adminReportsNote": {
    "path": "/api/admin/reports/{id}/notes",
    "method": "POST",
    "authenticated": true
  },
  "adminReportsAct": {
    "path": "/api/admin/reports/{id}/actions",
    "method": "POST",
    "authenticated": true
  },
  "adminAnnouncementsList": {
    "path": "/api/admin/announcements",
    "method": "GET",
    "authenticated": true
  },
  "adminAnnouncementsCreate": {
    "path": "/api/admin/announcements",
    "method": "POST",
    "authenticated": true
  },
  "adminAnnouncementsGet": {
    "path": "/api/admin/announcements/{id}",
    "method": "GET",
    "authenticated": true
  },
  "adminAnnouncementsUpdate": {
    "path": "/api/admin/announcements/{id}",
    "method": "PUT",
    "authenticated": true
  },
  "adminAnnouncementsPublish": {
    "path": "/api/admin/announcements/{id}/publish",
    "method": "POST",
    "authenticated": true
  },
  "adminAnnouncementsArchive": {
    "path": "/api/admin/announcements/{id}/archive",
    "method": "POST",
    "authenticated": true
  },
  "adminSettingsGet": {
    "path": "/api/admin/settings",
    "method": "GET",
    "authenticated": true
  },
  "adminSettingsUpdate": {
    "path": "/api/admin/settings",
    "method": "PATCH",
    "authenticated": true
  },
  "adminSystemRoles": {
    "path": "/api/admin/roles",
    "method": "GET",
    "authenticated": true
  },
  "adminSystemAudit": {
    "path": "/api/admin/audit-logs",
    "method": "GET",
    "authenticated": true
  },
  "adminSystemActions": {
    "path": "/api/admin/audit-logs/actions",
    "method": "GET",
    "authenticated": true
  },
  "adminSystemSystem": {
    "path": "/api/admin/system",
    "method": "GET",
    "authenticated": true
  }
} as const;
