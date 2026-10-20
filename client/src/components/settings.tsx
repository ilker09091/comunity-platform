"use client";
import { useState } from "react";
import Link from "next/link";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LockKeyhole,
  UserRound,
  Check,
  Shield,
  LogOut,
  Loader2,
  UserPlus,
  Ban,
  Volume2,
} from "lucide-react";
import { followRequestErrorMessage, useFollowRequestDecision } from "@/lib/follow-requests";
import { api, type Models } from "@/lib/api/client";
import { setVideoStartMuted, useVideoPreferences } from "@/lib/video-preferences";
import {
  useSession,
  useToast,
  broadcastSession,
  changeSession,
} from "./providers";
import {
  Avatar,
  ErrorState,
  LoadingSkeleton,
  LoadMore,
  SignInPrompt,
  ConfirmDialog,
  PageHeader,
  VerifiedBadge,
} from "./ui";

/** Account privacy. Public profile details are edited from the profile page (Edit Profile). */
function PrivacySettings({ user }: { user: Models["MeDto"] }) {
  const toast = useToast();
  const client = useQueryClient();
  const privacy = useMutation({
    mutationFn: (isPrivate: boolean) => api("usersUpdateMe", { body: { isPrivate } }),
    onSuccess: (data) => {
      client.setQueryData(["session"], data);
      for (const key of ["profile", "follow-requests", "notifications", "posts"])
        void client.invalidateQueries({ queryKey: [key] });
      toast(
        data.isPrivate
          ? "Your account is now private."
          : "Your account is now public. Pending follow requests were approved.",
      );
    },
    onError: (e) => toast(e.message, true),
  });
  const value = privacy.isPending ? !!privacy.variables : user.isPrivate;
  return (
    <section className="card settings-card">
      <div className="settings-title">
        <LockKeyhole size={20} />
        <div>
          <h2>Privacy</h2>
          <p>Control who can see your posts and reels.</p>
        </div>
      </div>
      <label className="privacy-control">
        <span>
          <span>
            <strong>Private account</strong>
            <small>
              Only approved followers can see your posts. Switching to public approves all pending requests.
            </small>
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={value}
          disabled={privacy.isPending}
          aria-checked={value}
          onChange={(e) => privacy.mutate(e.target.checked)}
        />
      </label>
    </section>
  );
}
const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];
export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();
  return <section className="card settings-card" aria-labelledby="appearance-title">
    <div className="settings-title"><Moon size={20} /><div><h2 id="appearance-title">Appearance</h2><p>Light, dark, or follow your device.</p></div></div>
    <div className="theme-options" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button type="button" role="radio" key={value} aria-checked={preference === value} className={`theme-option ${value}`} onClick={() => setPreference(value)}>
          {value === "system"
            ? <span className="theme-preview-stack" aria-hidden="true"><span className="theme-preview"><span /><span /><span /></span><span className="theme-preview dark"><span /><span /><span /></span></span>
            : <span className={`theme-preview ${value}`} aria-hidden="true"><span /><span /><span /></span>}
          <span className="theme-option-label"><Icon size={15} /> {label}</span>
        </button>
      ))}
    </div>
  </section>;
}
export function VideoPlaybackSettings() {
  const preferences = useVideoPreferences();
  const toast = useToast();
  return <section className="card settings-card" aria-labelledby="video-playback-title">
    <div className="settings-title"><Volume2 size={20} /><div><h2 id="video-playback-title">Video Playback</h2><p>Choose how videos sound across Circle.</p></div></div>
    <label className="privacy-control"><span><span><strong>Start videos with sound</strong><small>When enabled, feed videos and Reels attempt to play with sound. Your browser may still require a tap.</small></span></span>
      <input type="checkbox" role="switch" className="switch" checked={!preferences.startMuted} aria-checked={!preferences.startMuted} onChange={e => {
        const persisted = setVideoStartMuted(!e.target.checked);
        if (!persisted) toast("Sound preference updated for this session. Browser storage is unavailable.");
      }} />
    </label><p className="video-settings-note">Saved in this browser.</p>
  </section>;
}
function SecuritySettings() {
  const toast = useToast();
  const client = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const password = useMutation({
    mutationFn: () =>
      api("authChangePassword", { body: { currentPassword, newPassword } }),
    onSuccess: () => {
      setCurrent("");
      setNew("");
      toast("Password changed. Your other sessions have been signed out.");
    },
  });
  const logoutAll = useMutation({
    mutationFn: () => api("authLogoutAll"),
    onSuccess: async () => {
      await changeSession(client, null);
      broadcastSession();
      toast("All sessions have been signed out.");
    },
    onError: (e) => toast(e.message, true),
  });
  return (
    <section className="card settings-card">
      <div className="settings-title">
        <Shield size={21} />
        <div>
          <h2>Account security</h2>
          <p>Keep your corner of the world secure.</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          password.mutate();
        }}
      >
        <label className="form-field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label className="form-field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
            minLength={8}
            maxLength={128}
            pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,128}"
          />
          <small>Use at least 8 characters, a letter, and a number.</small>
        </label>
        {password.isError && (
          <p className="form-error" role="alert">
            {password.error.message}
          </p>
        )}
        <button className="button secondary" disabled={password.isPending}>
          Update password
        </button>
      </form>
      <div className="session-control">
        <div>
          <h3>Signed-in sessions</h3>
          <p>Sign out of this and every other device.</p>
        </div>
        <button
          className="button secondary small"
          onClick={() => setConfirmLogout(true)}
        >
          <LogOut size={15} />
          Sign out everywhere
        </button>
      </div>
      {confirmLogout && (
        <ConfirmDialog
          title="Sign out everywhere?"
          description="You’ll need to sign in again on all your devices."
          onClose={() => setConfirmLogout(false)}
          onConfirm={() => logoutAll.mutate()}
          pending={logoutAll.isPending}
        />
      )}
    </section>
  );
}
function FollowRequestRow({ requester }: { requester: Models["UserSummaryDto"] }) {
  const toast = useToast();
  const decision = useFollowRequestDecision(requester.id);
  const run = (choice: "accept" | "reject") =>
    decision.mutate(choice, {
      onSuccess: () =>
        toast(choice === "accept" ? `${requester.displayName} can now see your posts.` : "Follow request declined."),
      onError: (e) => toast(followRequestErrorMessage(e), true),
    });
  return (
    <div className="people-result">
      <Link className="user-identity" href={`/profile/${requester.username}`}>
        <Avatar user={requester} size={40} />
        <div>
          <strong>{requester.displayName}{requester.isVerified && <VerifiedBadge size={14} />}</strong>
          <span>@{requester.username}</span>
        </div>
      </Link>
      <div className="inline-actions">
        <button className="button xs" disabled={decision.isPending} onClick={() => run("accept")}>
          {decision.isPending && decision.variables === "accept" ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
          Accept
        </button>
        <button className="button xs neutral" disabled={decision.isPending} onClick={() => run("reject")}>
          {decision.isPending && decision.variables === "reject" && <Loader2 size={13} className="spin" />}
          Reject
        </button>
      </div>
    </div>
  );
}
function FollowRequests() {
  const query = useInfiniteQuery({
    queryKey: ["follow-requests"],
    queryFn: ({ pageParam, signal }) =>
      api("followsListRequests", {
        query: { cursor: pageParam, limit: 20 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="card settings-card" id="follow-requests">
      <div className="settings-title">
        <UserPlus size={20} />
        <div>
          <h2>Follow requests</h2>
          <p>Requests can also be approved from Notifications.</p>
        </div>
      </div>
      {query.isPending ? (
        <LoadingSkeleton compact />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !items.length ? (
        <p className="widget-note">No pending follow requests.</p>
      ) : (
        items.map(({ user }) => <FollowRequestRow key={user.id} requester={user} />)
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </section>
  );
}
function BlockedAccounts() {
  const toast = useToast();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["blocks"],
    queryFn: ({ pageParam, signal }) =>
      api("followsListBlocks", {
        query: { cursor: pageParam, limit: 20 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
  });
  const unblock = useMutation({
    mutationFn: (id: string) => api("followsUnblock", { params: { id } }),
    onSuccess: () => {
      void client.invalidateQueries();
      toast("Account unblocked.");
    },
    onError: (e) => toast(e.message, true),
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="card settings-card">
      <div className="settings-title">
        <Ban size={20} />
        <div>
          <h2>Blocked accounts</h2>
          <p>Blocked people can’t see your posts or interact with you.</p>
        </div>
      </div>
      {query.isPending ? (
        <LoadingSkeleton compact />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !items.length ? (
        <p className="widget-note">You haven’t blocked anyone.</p>
      ) : (
        items.map((item) => (
          <div className="people-result" key={item.user.id}>
            <Link className="user-identity" href={`/profile/${item.user.username}`}>
              <Avatar user={item.user} />
              <strong>{item.user.displayName}{item.user.isVerified && <VerifiedBadge size={14} />}</strong>
            </Link>
            <button
              className="button secondary small"
              disabled={unblock.isPending}
              onClick={() => unblock.mutate(item.user.id)}
            >
              Unblock
            </button>
          </div>
        ))
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </section>
  );
}
export default function Settings() {
  const { user, loading, error } = useSession();
  if (loading) return <LoadingSkeleton />;
  if (!user)
    return error ? (
      <div className="card">
        <ErrorState error={error} />
      </div>
    ) : (
      <SignInPrompt
        title="Make Circle your own"
        description="Sign in to manage your profile, privacy, and security."
      />
    );
  return (
    <>
      <PageHeader
        title="Settings"
        description="Privacy, security and account preferences."
        action={
          <Link href="/profile/edit" className="button secondary small">
            <UserRound size={15} /> Edit profile
          </Link>
        }
      />
      <AppearanceSettings />
      <PrivacySettings key={user.id} user={user} />
      <VideoPlaybackSettings />
      <SecuritySettings />
      <FollowRequests />
      <BlockedAccounts />
    </>
  );
}
