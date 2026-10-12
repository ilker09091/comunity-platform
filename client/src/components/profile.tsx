"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  Link2,
  CalendarDays,
  LockKeyhole,
  MoreHorizontal,
  Ban,
  Flag,
  Copy,
  Settings,
  Bookmark,
  Grid3X3,
  Repeat2,
  ShieldOff,
  Clapperboard,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Dropdown, EmptyState, ErrorState, LoadMore, Modal, VerifiedBadge } from "./ui";
import FollowButton from "./follow-button";
import Feed from "./feed";
import ReportDialog from "./report-dialog";
import { useFeatures } from "@/lib/platform-config";

type Profile = Models["UserProfileDto"];

function Connections({ id, mode }: { id: string; mode: "followers" | "following" }) {
  const query = useInfiniteQuery({
    queryKey: ["connections", id, mode],
    queryFn: ({ pageParam, signal }) =>
      api(mode === "followers" ? "followsFollowers" : "followsFollowing", {
        params: { id },
        query: { cursor: pageParam, limit: 20 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="connections">
      {query.isPending ? (
        <div className="skeleton-list" role="status" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton circle" />
              <div>
                <div className="skeleton line short" />
                <div className="skeleton line tiny" />
              </div>
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : items.length ? (
        items.map((user) => (
          <div className="people-result" key={user.id}>
            <Link href={`/profile/${user.username}`} className="user-identity">
              <Avatar user={user} size={40} />
              <div>
                <strong>{user.displayName}{user.isVerified && <VerifiedBadge size={14} />}</strong>
                <span>@{user.username}</span>
              </div>
            </Link>
            <FollowButton id={user.id} following={user.isFollowing} compact />
          </div>
        ))
      ) : (
        <EmptyState title="No connections yet" description="New connections will appear here." />
      )}
      <LoadMore hasMore={query.hasNextPage} pending={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </div>
  );
}

function useCopyProfileLink(username: string) {
  const toast = useToast();
  return async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/profile/${username}`);
      toast("Profile link copied.");
    } catch {
      toast("Unable to copy the link.", true);
    }
  };
}

/** Block/unblock with server confirmation and cache resync across the app. */
function useBlock(profile: Profile) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (block: boolean) => api(block ? "followsBlock" : "followsUnblock", { params: { id: profile.id } }),
    onSuccess: (_data, block) => {
      for (const key of ["profile", "posts", "suggestions", "notifications", "unread", "session", "connections", "blocks", "follow-requests"])
        void client.invalidateQueries({ queryKey: [key] });
      toast(block ? `You blocked @${profile.username}.` : `You unblocked @${profile.username}.`);
    },
    onError: (error) => toast(error.message, true),
  });
}

function ProfileMenu({ profile }: { profile: Profile }) {
  const { user } = useSession();
  const copy = useCopyProfileLink(profile.username);
  const block = useBlock(profile);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { on } = useFeatures();

  if (profile.isSelf)
    return (
      <Dropdown label="Profile options" summaryClassName="button secondary icon-only" summary={<MoreHorizontal size={18} />}>
        <Link href="/profile/edit">
          <Settings size={16} /> Edit profile
        </Link>
        <button type="button" onClick={() => void copy()}>
          <Copy size={16} /> Copy profile link
        </button>
        <Link href="/saved">
          <Bookmark size={16} /> Saved posts
        </Link>
        <Link href="/settings">
          <Settings size={16} /> Settings & privacy
        </Link>
      </Dropdown>
    );

  return (
    <>
      <Dropdown label="Profile options" summaryClassName="button secondary icon-only" summary={<MoreHorizontal size={18} />}>
        <button type="button" onClick={() => void copy()}>
          <Copy size={16} /> Copy profile link
        </button>
        {user &&
          (profile.isBlocking ? (
            <button type="button" disabled={block.isPending} onClick={() => block.mutate(false)}>
              <ShieldOff size={16} /> Unblock @{profile.username}
            </button>
          ) : (
            <button type="button" className="danger-text" onClick={() => setConfirmBlock(true)}>
              <Ban size={16} /> Block @{profile.username}
            </button>
          ))}
        {user && on("reporting") && (
          <button type="button" className="danger-text" onClick={() => setReporting(true)}>
            <Flag size={16} /> Report @{profile.username}
          </button>
        )}
      </Dropdown>
      {confirmBlock && (
        <ConfirmDialog
          title={`Block @${profile.username}?`}
          confirmLabel="Block"
          pending={block.isPending}
          onClose={() => setConfirmBlock(false)}
          onConfirm={() => block.mutate(true, { onSuccess: () => setConfirmBlock(false) })}
          description={
            <ul className="block-explainer">
              <li>They won’t be able to see your profile, posts or reels, or interact with you.</li>
              <li>You’ll unfollow each other, and pending follow requests are removed.</li>
              <li>They won’t be notified. You can unblock them at any time.</li>
            </ul>
          }
        />
      )}
      {reporting && (
        <ReportDialog targetType="USER" targetId={profile.id} subject={`@${profile.username}`} onClose={() => setReporting(false)} />
      )}
    </>
  );
}

const TABS = [
  { id: "posts", label: "Posts", icon: Grid3X3, content:'home', kinds: ["POST", "QUOTE"] as ("POST" | "QUOTE" | "REPOST")[] },
  { id: "reels", label: "Reels", icon: Clapperboard, content:'reels', kinds: ["POST", "QUOTE"] as ("POST" | "QUOTE" | "REPOST")[] },
  { id: "reposts", label: "Reposts", icon: Repeat2, content:'all', kinds: ["REPOST"] as ("POST" | "QUOTE" | "REPOST")[] },
] as const;

function ProfileTabs({ active, onChange }: { active: number; onChange: (index: number) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (active + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      className="profile-tabs"
      role="tablist"
      aria-label="Profile content"
      style={{ "--tab-count": TABS.length, "--tab-index": active } as React.CSSProperties}
      onKeyDown={onKey}
    >
      {TABS.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={active === i}
          aria-controls={`panel-${tab.id}`}
          tabIndex={active === i ? 0 : -1}
          className={active === i ? "active" : ""}
          onClick={() => onChange(i)}
        >
          <tab.icon size={15} aria-hidden="true" />
          {tab.label}
        </button>
      ))}
      <span className="profile-tab-indicator" aria-hidden="true" />
    </div>
  );
}

export default function Profile({ username }: { username: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user: me } = useSession();
  const layout = 'grid' as const;
  const [connections, setConnections] = useState<"followers" | "following" | null>(null);
  const tab = Math.max(0, TABS.findIndex((t) => t.id === params.get("tab")));
  const editing = params.get("edit") === "1";
  useEffect(() => { if (editing && me?.username === username) router.replace("/profile/edit"); }, [editing, me?.username, username, router]);
  const query = useQuery({
    queryKey: ["profile", username],
    queryFn: ({ signal }) => api("usersGetProfile", { params: { username }, signal }),
  });
  // UI state (tab, editor) lives in the URL but is updated with the native History API,
  // which Next syncs with useSearchParams without a server round-trip.
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value === null) next.delete(key);
    else next.set(key, value);
    window.history.replaceState(null, "", next.size ? `${pathname}?${next}` : pathname);
  };
  const block = useBlock(query.data ?? ({} as Profile));

  if (query.isPending)
    return (
      <section className="card profile-header" aria-busy="true">
        <div className="profile-hero skeleton" />
        <div className="profile-header-body">
          <span className="skeleton circle profile-avatar-skeleton" />
          <div className="skeleton line short" />
          <div className="skeleton line tiny" />
        </div>
      </section>
    );
  if (query.isError)
    return (
      <div className="card">
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      </div>
    );

  const user = query.data;
  const active = TABS[tab];
  const joined = new Date(user.createdAt).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <section className="card profile-header">
        <div className="profile-hero">
          {user.coverUrl ? <img src={user.coverUrl} alt="" /> : <div className="cover-art" aria-hidden="true" />}
        </div>
        <div className="profile-header-body">
          <div className="profile-header-top">
            <span className="profile-avatar">
              <Avatar user={user} size={104} />
            </span>
            <div className="profile-actions">
              {user.isSelf ? (
                <Link href="/profile/edit" className="button">
                  Edit Profile
                </Link>
              ) : user.isBlocking ? (
                <button type="button" className="button secondary" disabled={block.isPending} onClick={() => block.mutate(false)}>
                  Unblock
                </button>
              ) : (
                <FollowButton id={user.id} following={user.isFollowing} requested={user.isFollowRequested} />
              )}
              <ProfileMenu profile={user} />
            </div>
          </div>
          <h1 className="profile-name">
            {user.displayName}
            {user.isVerified && <VerifiedBadge size={22} className="profile-verified" />}
            {user.isPrivate && <LockKeyhole size={16} aria-label="Private account" />}
          </h1>
          <p className="profile-handle">
            @{user.username}
            {user.followsYou && <span className="follows-you">Follows you</span>}
          </p>
          <div className="profile-counts">
            <span>
              <strong>{user.postCount.toLocaleString("en")}</strong> posts
            </span>
            {(["followers", "following"] as const).map((kind) => (
              <button key={kind} type="button" onClick={() => setConnections(kind)} disabled={!user.canViewContent}>
                <strong>{(kind === "followers" ? user.followerCount : user.followingCount).toLocaleString("en")}</strong>{" "}
                {kind}
              </button>
            ))}
          </div>
          {user.bio && <p className="profile-bio-text">{user.bio}</p>}
          <div className="profile-details">
            {user.location && (
              <span>
                <MapPin size={14} />
                {user.location}
              </span>
            )}
            {user.website && /^https?:\/\//i.test(user.website) && (
              <a href={user.website} target="_blank" rel="noopener noreferrer nofollow">
                <Link2 size={14} />
                {user.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
            <span>
              <CalendarDays size={14} />
              Joined {joined}
            </span>
          </div>
        </div>
        {!user.isBlocking && user.canViewContent && (
          <ProfileTabs active={tab} onChange={(i) => setParam("tab", i === 0 ? null : TABS[i].id)} />
        )}
      </section>

      {user.isBlocking ? (
        <div className="card">
          <EmptyState
            title={`You blocked @${user.username}`}
            description="You won’t see their posts and they can’t interact with you. Unblocking doesn’t restore previous follows."
            action={
              <button type="button" className="button secondary small" disabled={block.isPending} onClick={() => block.mutate(false)}>
                Unblock
              </button>
            }
          />
        </div>
      ) : !user.canViewContent ? (
        <div className="card">
          <EmptyState
            title="This account is private"
            description={
              user.isFollowRequested
                ? "Your follow request is pending. You’ll see their posts once they approve it."
                : "Follow this account to see their posts and reposts."
            }
          />
        </div>
      ) : (
        <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} className="profile-panel">
          <Feed
            key={active.id}
            userId={user.id}
            kinds={[...active.kinds]}
            content={active.content}
            layout={layout}
            emptyTitle={active.id === "posts" ? "No posts yet" : active.id==='reels' ? 'No Reels yet' : "No reposts yet"}
            emptyDescription={
              active.id !== "reposts"
                ? user.isSelf
                  ? "Share your first post from the home feed."
                  : `When @${user.username} shares something, it’ll appear here.`
                : user.isSelf
                  ? "Posts you repost will appear here."
                  : `Posts @${user.username} reposts will appear here.`
            }
          />
        </div>
      )}

      {connections && (
        <Modal title={connections === "followers" ? "Followers" : "Following"} onClose={() => setConnections(null)}>
          <Connections id={user.id} mode={connections} />
        </Modal>
      )}
    </>
  );
}
