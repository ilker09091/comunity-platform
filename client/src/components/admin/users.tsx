"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ExternalLink, Flag, MailWarning, MoreHorizontal, PauseCircle, PlayCircle, RotateCcw, ShieldPlus, Trash2, Undo2, UserRound, BadgeCheck } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { compact, dateTime, fmt, humanize, REPORT_REASONS, useAdminMe, useCan, useUrlFilters, type Role } from "@/lib/admin";
import { useToast } from "@/components/providers";
import { Avatar, Dropdown, VerifiedBadge } from "@/components/ui";
import {
  ActionDialog,
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  Badge,
  DataTable,
  History,
  Item,
  ItemList,
  KeyValues,
  Pagination,
  Panel,
  RoleBadge,
  SearchBox,
  Select,
  Tabs,
  TimeCell,
  useSensitive,
} from "./kit";
import { ReportsTable } from "./reports";
import { CommentItems, PostItems, type ContentPage } from "./content";
import { EditProfileButton, ResetPasswordButton, UserActivity, UserNotes, UserSessions } from "./user-management";

export const RANK: Record<Role, number> = { USER: 0, SUPPORT: 1, MODERATOR: 2, ADMIN: 3, SUPER_ADMIN: 4 };
export const ROLE_INFO: Record<Role, string> = {
  USER: "Regular member, no admin access.",
  SUPPORT: "Can look up accounts, emails, content and reports. Cannot change anything.",
  MODERATOR: "Handles reports, hides/removes content, warns and suspends members.",
  ADMIN: "Everything a moderator can do, plus bans, settings, announcements, media and roles below Admin.",
  SUPER_ADMIN: "Full access, including managing other admins.",
};
const PAGE_SIZE = 20;

type Target = Pick<Models["AdminUserRowDto"], "id" | "username" | "displayName" | "role" | "status">;
type ActionKey = "warn" | "suspend" | "reinstate" | "ban" | "unban" | "role" | "purge" | "delete-account";

/** Which account actions the signed-in staff member may take on `user` (the API enforces the same rules). */
export function useAllowedUserActions(user: Target) {
  const can = useCan();
  const me = useAdminMe().data!;
  const self = user.id === me.user.id;
  const outranks = !self && RANK[me.role] > RANK[user.role];
  const roleOptions = me.assignableRoles.filter((r) => r !== user.role && (RANK[r] < RANK.ADMIN || me.permissions.includes("admins.manage")));
  const keys: ActionKey[] = [];
  if (outranks && can("users.warn")) keys.push("warn");
  if (outranks && can("users.suspend") && user.status === "ACTIVE") keys.push("suspend");
  if (outranks && can("users.suspend") && user.status === "SUSPENDED") keys.push("reinstate");
  if (can("users.roles.manage") && !self && roleOptions.length && (outranks || me.role === "SUPER_ADMIN")) keys.push("role");
  if (outranks && can("posts.moderate", "reels.moderate", "comments.moderate")) keys.push("purge");
  if (outranks && can("users.ban") && user.status !== "BANNED") keys.push("ban");
  if (outranks && can("users.ban") && user.status === "BANNED") keys.push("unban");
  if (outranks && can("users.ban", "media.manage")) keys.push("delete-account");
  return { keys, self, outranks, roleOptions };
}

const ACTIONS: Record<ActionKey, { label: string; icon: typeof Ban; danger?: boolean }> = {
  "delete-account": { label: "Delete account permanently", icon: Trash2, danger: true },
  warn: { label: "Send warning", icon: MailWarning },
  suspend: { label: "Suspend", icon: PauseCircle },
  reinstate: { label: "Lift suspension", icon: PlayCircle },
  role: { label: "Change role", icon: ShieldPlus },
  purge: { label: "Delete all content permanently", icon: Trash2, danger: true },
  ban: { label: "Ban account", icon: Ban, danger: true },
  unban: { label: "Lift ban", icon: Undo2 },
};

/** Account actions as buttons (detail page) or a compact “⋯” menu (list rows), with their dialogs. */
export function UserActions({ user, variant }: { user: Target; variant: "buttons" | "menu" }) {
  const { keys } = useAllowedUserActions(user);
  const [open, setOpen] = useState<ActionKey | null>(null);
  const dialogs = open && <UserActionDialog user={user} action={open} onClose={() => setOpen(null)} />;
  if (variant === "menu")
    return (
      <>
        <Dropdown label={`Actions for @${user.username}`} summaryClassName="icon-button small" summary={<MoreHorizontal size={17} />}>
          <Link href={`/admin/users/${user.id}`}>
            <UserRound size={16} /> Open account
          </Link>
          {keys.map((k) => {
            const A = ACTIONS[k];
            return (
              <button key={k} type="button" className={A.danger ? "danger-text" : ""} onClick={() => setOpen(k)}>
                <A.icon size={16} /> {A.label}
              </button>
            );
          })}
        </Dropdown>
        {dialogs}
      </>
    );
  return (
    <>
      <div className="quick-actions">
        {keys.map((k) => {
          const A = ACTIONS[k];
          return (
            <button key={k} className={`button small ${A.danger ? "danger" : "secondary"}`} onClick={() => setOpen(k)}>
              <A.icon size={15} /> {A.label}
            </button>
          );
        })}
      </div>
      {dialogs}
    </>
  );
}

export function UserActionDialog({ user, action, onClose }: { user: Target; action: ActionKey; onClose: () => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const { roleOptions } = useAllowedUserActions(user);
  const [days, setDays] = useState(7);
  const [warnReason, setWarnReason] = useState<Models["ReportReason"]>("OTHER");
  const [role, setRole] = useState<Role | "">("");
  const id = user.id;
  const done = async (message: string) => {
    toast(message);
    await client.invalidateQueries({ queryKey: ["admin"] });
  };
  switch (action) {
    case "delete-account":
      return <ActionDialog title={`Delete @${user.username} permanently`}
        description="Deletes the account from the database, including sessions, posts, comments, messages, stories and uploaded media. This cannot be undone."
        confirmLabel="Delete account permanently" confirmPhrase={user.username} tone="danger"
        presets={["Account deletion requested", "Spam account", "Repeated rule violations"]} onClose={onClose}
        onSubmit={async reason => {
          await sensitive(headers => api("adminUsersDeleteAccount", {params:{id},body:{reason,confirmUsername:user.username},headers}));
          router.replace("/admin/users");
          await client.invalidateQueries();
          toast("Account and its content permanently deleted.");
        }} />;
    case "warn":
      return (
        <ActionDialog
          title={`Warn @${user.username}`}
          description="The member gets this message in their in-app inbox."
          confirmLabel="Send warning"
          reasonLabel="Message to the member"
          presets={["Please keep conversations respectful.", "Please stop posting spam or repeated links.", "This content breaks our community rules."]}
          extra={
            <label className="form-field">
              <span>Rule</span>
              <select value={warnReason} onChange={(e) => setWarnReason(e.target.value as Models["ReportReason"])}>
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </select>
            </label>
          }
          onClose={onClose}
          onSubmit={async (message) => {
            await api("adminUsersWarn", { params: { id }, body: { reason: warnReason, message } });
            await done("Warning sent.");
          }}
        />
      );
    case "suspend":
      return (
        <ActionDialog
          title={`Suspend @${user.username}`}
          description="They are signed out everywhere and can’t sign in until the suspension ends or you lift it."
          confirmLabel="Suspend"
          tone="danger"
          presets={["Repeated rule violations", "Harassment", "Spam"]}
          extra={
            <div className="form-field">
              <span>Duration</span>
              <div className="reason-presets">
                {(
                  [
                    ["1 day", 1],
                    ["3 days", 3],
                    ["7 days", 7],
                    ["30 days", 30],
                    ["Until lifted", 0],
                  ] as const
                ).map(([label, n]) => (
                  <button key={label} type="button" className={`admin-chip ${days === n ? "selected" : ""}`} onClick={() => setDays(n)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          }
          onClose={onClose}
          onSubmit={async (reason) => {
            const expiresAt = days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined;
            await api("adminUsersSuspend", { params: { id }, body: { reason, ...(expiresAt ? { expiresAt } : {}) } });
            await done("Account suspended.");
          }}
        />
      );
    case "reinstate":
      return (
        <ActionDialog
          title={`Lift suspension for @${user.username}`}
          confirmLabel="Lift suspension"
          presets={["Suspension served", "Appeal accepted"]}
          onClose={onClose}
          onSubmit={async (reason) => {
            await api("adminUsersReinstate", { params: { id }, body: { reason } });
            await done("Suspension lifted.");
          }}
        />
      );
    case "ban":
      return (
        <ActionDialog
          title={`Ban @${user.username}`}
          description="Bans are permanent until lifted. They are signed out everywhere and can’t sign in."
          confirmLabel="Ban account"
          tone="danger"
          confirmPhrase={user.username}
          presets={["Severe or repeated violations", "Spam account", "Impersonation"]}
          onClose={onClose}
          onSubmit={async (reason) => {
            await sensitive((headers) => api("adminUsersBan", { params: { id }, body: { reason, confirmUsername: user.username }, headers }));
            await done("Account banned.");
          }}
        />
      );
    case "unban":
      return (
        <ActionDialog
          title={`Lift ban for @${user.username}`}
          confirmLabel="Lift ban"
          presets={["Appeal accepted", "Banned by mistake"]}
          onClose={onClose}
          onSubmit={async (reason) => {
            await sensitive((headers) => api("adminUsersUnban", { params: { id }, body: { reason }, headers }));
            await done("Ban lifted.");
          }}
        />
      );
    case "purge":
      return <BulkContentDialog user={user} status="REMOVED" onClose={onClose} />;
    case "role":
      return (
        <ActionDialog
          title={`Change role for @${user.username}`}
          description={
            <>
              Current role: <RoleBadge role={user.role} />
            </>
          }
          confirmLabel="Save role"
          noReason
          extra={<RolePicker options={roleOptions} value={role} onChange={setRole} />}
          onClose={onClose}
          onSubmit={async () => {
            if (!role) throw new Error("Choose a role.");
            await sensitive((headers) => api("adminUsersRole", { params: { id }, body: { role }, headers }));
            await done(`@${user.username} is now ${role === "USER" ? "a member" : humanize(role)}.`);
          }}
        />
      );
  }
}

export function RolePicker({ options, value, onChange }: { options: Role[]; value: Role | ""; onChange: (r: Role) => void }) {
  const sorted = [...options].sort((a, b) => RANK[a] - RANK[b]);
  return (
    <fieldset className="role-options">
      <legend>New role</legend>
      {sorted.map((r) => (
        <label key={r} className={value === r ? "selected" : ""}>
          <input type="radio" name="role" value={r} checked={value === r} onChange={() => onChange(r)} />
          <span>
            <RoleBadge role={r} />
            <small>{ROLE_INFO[r]}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/* ============================ List ============================ */

const TABS = [
  { value: "all", label: "Everyone" },
  { value: "team", label: "Team" },
  { value: "suspended", label: "Suspended" },
  { value: "banned", label: "Banned" },
];

export function UsersList() {
  const f = useUrlFilters<"tab" | "q" | "sort">({ tab: "all", sort: "created" });
  const tab = f.get("tab");
  const query = compact({
    q: f.get("q"),
    status: tab === "suspended" ? "SUSPENDED" : tab === "banned" ? "BANNED" : "",
    staff: tab === "team" ? "true" : "",
    sort: f.get("sort"),
    order: "desc",
    page: f.page,
    pageSize: PAGE_SIZE,
  });
  const q = useQuery({
    queryKey: ["admin", "users", query],
    queryFn: ({ signal }) => api("adminUsersList", { query, signal }),
    placeholderData: (prev) => prev,
  });
  return (
    <AdminPage title="Users" description="Find any account and act on it from the ⋯ menu: warn, suspend, ban or change its role.">
      <Tabs label="Show" value={tab} onChange={(v) => f.set({ tab: v })} items={TABS} />
      <div className="admin-subtabs">
        <SearchBox value={f.get("q")} onSearch={(v) => f.set({ q: v })} placeholder="Search by name, @username or email" />
        <Select
          label="Sort"
          value={f.get("sort")}
          onChange={(v) => f.set({ sort: v })}
          options={[
            ["created", "Newest"],
            ["lastActive", "Recently active"],
            ["reports", "Most reported"],
            ["followers", "Most followers"],
          ]}
        />
      </div>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            <ItemList label="Users" empty={<AdminEmpty title="No accounts here" description={f.get("q") ? "Try a different search." : undefined} />}>
              {q.data.items.map((u) => (
                <Item
                  key={u.id}
                  href={`/admin/users/${u.id}`}
                  leading={<Avatar user={u} size={40} />}
                  title={
                    <span>
                      {u.displayName}
                      {u.isVerified && <VerifiedBadge size={14} />} <span className="muted">@{u.username}</span>
                    </span>
                  }
                  badges={
                    <>
                      {u.role !== "USER" && <RoleBadge role={u.role} />}
                      {u.status !== "ACTIVE" && <Badge value={u.status} />}
                      {u.openReportCount > 0 && (
                        <span className="report-chip">
                          <Flag size={11} aria-hidden="true" /> {u.openReportCount} open report{u.openReportCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </>
                  }
                  body={u.email ?? undefined}
                  meta={
                    <>
                      <span>Joined {dateTime(u.createdAt).split(",")[0]}</span>
                      <span>{u.lastActiveAt ? <>Active <TimeCell value={u.lastActiveAt} /></> : "No recent activity"}</span>
                      <span>{fmt(u.postCount)} posts</span>
                      <span>{fmt(u.followerCount)} followers</span>
                    </>
                  }
                  actions={<UserActions user={u} variant="menu" />}
                />
              ))}
            </ItemList>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(page) => f.set({ page })} />
          </>
        )}
      </Panel>
    </AdminPage>
  );
}

/* ============================ Detail ============================ */

/** Grants or removes the blue verification badge (needs `users.update`). */
function VerifyToggle({ user }: { user: Models["AdminUserRowDto"] }) {
  const can = useCan();
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!can("users.update")) return null;
  const next = !user.isVerified;
  return (
    <button
      type="button"
      className={`button small ${next ? "" : "secondary"} verify-toggle`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("adminUsersSetVerified", { params: { id: user.id }, body: { verified: next } });
          toast(next ? `@${user.username} now has a blue badge.` : `Blue badge removed from @${user.username}.`);
          await client.invalidateQueries({ queryKey: ["admin"] });
        } catch (error) {
          toast(error instanceof Error ? error.message : "Could not update the badge.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <BadgeCheck size={15} /> {next ? "Give blue badge" : "Remove blue badge"}
    </button>
  );
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const q = useQuery({ queryKey: ["admin", "user", id], queryFn: ({ signal }) => api("adminUsersDetail", { params: { id }, signal }) });
  if (q.isPending) return <AdminLoading label="Loading account" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  return <UserDetailView d={q.data} canReports={can("reports.read")} />;
}

function UserDetailView({ d, canReports }: { d: Models["AdminUserDetailDto"]; canReports: boolean }) {
  const u = d.user;
  const { self, outranks } = useAllowedUserActions(u);
  const [tab, setTab] = useState("overview");
  const activeRestrictions = d.restrictions.filter((r) => r.active).length;
  return (
    <AdminPage
      title={u.displayName}
      description={
        <>
          @{u.username} ·{" "}
          <Link href={`/profile/${u.username}`} className="inline-link">
            View public profile <ExternalLink size={12} aria-hidden="true" />
          </Link>
        </>
      }
      actions={
        <>
          <VerifyToggle user={u} />
          <EditProfileButton key={`${u.username}-${u.displayName}`} detail={d} canAct={!self && outranks} />
          <ResetPasswordButton user={u} canAct={!self && outranks} />
          <UserActions user={u} variant="buttons" />
        </>
      }
    >
      <div className="admin-profile-head">
        <Avatar user={u} size={64} />
        <div>
          <div className="badges">
            <RoleBadge role={u.role} />
            <Badge value={u.status} />
            {u.isVerified && (
              <span className="admin-badge tone-info">
                <VerifiedBadge size={13} /> Verified
              </span>
            )}
            {d.isPrivate && <span className="admin-badge tone-neutral">Private account</span>}
          </div>
          {d.bio && <p className="admin-bio">{d.bio}</p>}
          <p className="admin-help">
            Joined {dateTime(u.createdAt)} · {u.lastActiveAt ? `last active ${dateTime(u.lastActiveAt)}` : "no recent activity"}
          </p>
        </div>
      </div>
      {self && <p className="admin-note">This is your own account. Restrictions and role changes must be made by another administrator.</p>}
      {!self && !outranks && <p className="admin-note">This account has the same or a higher role than yours, so you can’t restrict it.</p>}

      <Tabs
        label="Account sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "activity", label: "Activity" },
          { value: "devices", label: "Devices", count: d.activeSessions },
          { value: "notes", label: "Notes" },
          { value: "content", label: "Content" },
          { value: "safety", label: "Restrictions & warnings", count: activeRestrictions },
          ...(canReports ? [{ value: "reports", label: "Reports", count: u.openReportCount }] : []),
          { value: "history", label: "History" },
        ]}
      />

      {tab === "overview" && (
        <div className="admin-grid-3">
          <Panel title="Account">
            <KeyValues
              items={[
                ["Email", u.email ?? <span className="muted">Hidden for your role</span>],
                ["Active sessions", fmt(d.activeSessions)],
                ["Location", d.location || "—"],
                ["Website", d.website || "—"],
              ]}
            />
          </Panel>
          <Panel title="Content">
            <KeyValues
              items={[
                ["Posts", <Link key="p" href={`/admin/content?tab=posts&authorId=${u.id}`}>{fmt(d.content.posts)}</Link>],
                ["Reels", <Link key="r" href={`/admin/content?tab=reels&authorId=${u.id}`}>{fmt(d.content.reels)}</Link>],
                ["Comments", <Link key="c" href={`/admin/content?tab=comments&authorId=${u.id}`}>{fmt(d.content.comments)}</Link>],
                ["Hidden / removed", fmt(d.content.moderatedPosts + d.content.moderatedComments)],
              ]}
            />
          </Panel>
          <Panel title="Connections">
            <KeyValues
              items={[
                ["Followers", fmt(d.relationships.followers)],
                ["Following", fmt(d.relationships.following)],
                ["Blocking", fmt(d.relationships.blocking)],
                ["Blocked by", fmt(d.relationships.blockedBy)],
              ]}
            />
          </Panel>
        </div>
      )}

      {tab === "activity" && <UserActivity id={u.id} />}
      {tab === "devices" && <UserSessions user={u} canAct={!self && outranks} />}
      {tab === "notes" && <UserNotes id={u.id} />}
      {tab === "content" && <UserContent user={u} counts={d.content} />}

      {tab === "safety" && (
        <div className="admin-grid-2">
          <Panel title="Restrictions" flush>
            <DataTable
              caption="Restrictions"
              rows={d.restrictions}
              empty={<AdminEmpty title="Never suspended or banned" />}
              columns={[
                { key: "type", header: "Type", cell: (r) => <Badge value={r.type === "BAN" ? "BANNED" : "SUSPENDED"} label={humanize(r.type)} /> },
                { key: "reason", header: "Reason", cell: (r) => r.reason },
                { key: "end", header: "Until", cell: (r) => (r.expiresAt ? dateTime(r.expiresAt) : "Lifted manually") },
                { key: "state", header: "State", cell: (r) => (r.active ? <strong>Active</strong> : <span className="muted">Lifted</span>) },
              ]}
            />
          </Panel>
          <Panel title="Warnings" flush>
            <DataTable
              caption="Warnings"
              rows={d.warnings}
              empty={<AdminEmpty title="No warnings sent" />}
              columns={[
                { key: "reason", header: "Warning", cell: (w) => <span className="cell-stack"><strong>{humanize(w.reason)}</strong><span>{w.message}</span></span> },
                { key: "by", header: "By", cell: (w) => `@${w.createdBy?.username ?? "—"}` },
                { key: "read", header: "Seen", cell: (w) => (w.readAt ? <TimeCell value={w.readAt} /> : <span className="muted">Not yet</span>) },
              ]}
            />
          </Panel>
        </div>
      )}

      {tab === "reports" && (
        <Panel flush>
          <ReportsTable rows={d.reports} empty="No reports involve this account" />
        </Panel>
      )}

      {tab === "history" && (
        <Panel>
          <History items={d.history} />
        </Panel>
      )}
    </AdminPage>
  );
}

/* ============================ Bulk content ============================ */

type Scope = "posts" | "comments" | "all";

/** Permanently delete content, or restore content that was only moderated. */
export function BulkContentDialog({
  user,
  status,
  counts,
  onClose,
}: {
  user: Target;
  status: "REMOVED" | "ACTIVE";
  counts?: { posts: number; comments: number };
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const [scope, setScope] = useState<Scope>("posts");
  const remove = status === "REMOVED";
  const n = (k: "posts" | "comments") => (counts ? ` (${fmt(counts[k])})` : "");
  const scopes: [Scope, string, string][] = [
    ["posts", `Posts and Reels${n("posts")}`, "Includes quotes and reposts."],
    ["comments", `Comments${n("comments")}`, "Including replies under other people’s posts."],
    ["all", "Everything", "Posts, Reels and comments."],
  ];
  return (
    <ActionDialog
      title={remove ? `Permanently delete content from @${user.username}` : `Restore content for @${user.username}`}
      description={
        remove
          ? "Permanently deletes the selected posts, Reels, comments and unused media files from storage. Deleted content cannot be restored. Open reports are closed."
          : "Brings back content that was hidden or moderated. Permanently deleted content cannot be restored."
      }
      confirmLabel={remove ? "Delete permanently" : "Restore content"}
      tone={remove ? "danger" : "primary"}
      confirmPhrase={remove ? user.username : undefined}
      presets={remove ? ["Spam account", "Repeated rule violations", "Hate speech", "Compromised account"] : ["Appeal accepted", "Removed by mistake"]}
      extra={
        <>
          <fieldset className="role-options">
            <legend>What should be {remove ? "removed" : "restored"}?</legend>
            {scopes.map(([value, label, hint]) => (
              <label key={value} className={scope === value ? "selected" : ""}>
                <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)} />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      }
      onClose={onClose}
      onSubmit={async (reason) => {
        const res = remove
          ? await sensitive((headers) => api("adminUsersDeleteContent", {
            params: { id: user.id },
            body: { scope, reason, confirmUsername: user.username },
            headers,
          }))
          : await sensitive((headers) => api("adminUsersModerateContent", {
            params: { id: user.id },
            body: { scope, status, reason, resolveReports: false, confirmUsername: user.username },
            headers,
          }));
        const parts = [
          res.posts ? `${res.posts} post${res.posts > 1 ? "s" : ""}` : "",
          res.comments ? `${res.comments} comment${res.comments > 1 ? "s" : ""}` : "",
        ].filter(Boolean);
        toast(
          parts.length
            ? `${remove ? "Permanently deleted" : "Restored"} ${parts.join(" and ")}${res.resolvedReports ? ` · ${res.resolvedReports} report(s) closed` : ""}.`
            : "Nothing needed changing.",
        );
        await client.invalidateQueries();
      }}
    />
  );
}

type ContentType = "posts" | "reels" | "comments";

/** The account’s posts, Reels and comments, with bulk remove/restore. */
function UserContent({ user, counts }: { user: Target; counts: Models["AdminUserContentCountsDto"] }) {
  const { keys } = useAllowedUserActions(user);
  const [type, setType] = useState<ContentType>("posts");
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const [bulk, setBulk] = useState<"REMOVED" | "ACTIVE" | null>(null);
  const query = compact({
    authorId: user.id,
    status: view === "all" ? "" : view.toUpperCase(),
    page,
    pageSize: 10,
    sort: "created",
    order: "desc",
  });
  const q = useQuery({
    queryKey: ["admin", "content", type, query, "user"],
    queryFn: ({ signal }): Promise<ContentPage> =>
      type === "reels"
        ? api("adminContentReels", { query, signal })
        : type === "comments"
          ? api("adminContentComments", { query, signal })
          : api("adminContentPosts", { query, signal }),
    placeholderData: (prev) => prev,
  });
  const moderated = counts.moderatedPosts + counts.moderatedComments;
  const bulkCounts = { posts: counts.posts + counts.reposts, comments: counts.comments };
  const types: [ContentType, string][] = [
    ["posts", `Posts (${fmt(counts.posts)})`],
    ["reels", `Reels (${fmt(counts.reels)})`],
    ["comments", `Comments (${fmt(counts.comments)})`],
  ];
  return (
    <>
      {keys.includes("purge") && (
        <div className="bulk-bar">
          <p>
            <strong>Bulk actions</strong>
            <span>Act on everything this account has posted at once. Reversible.</span>
          </p>
          <div className="quick-actions">
            {moderated > 0 && (
              <button className="button secondary small" onClick={() => setBulk("ACTIVE")}>
                <RotateCcw size={15} /> Restore content ({fmt(moderated)})
              </button>
            )}
            <button className="button danger small" onClick={() => setBulk("REMOVED")} disabled={!bulkCounts.posts && !bulkCounts.comments}>
              <Trash2 size={15} /> Delete all content permanently
            </button>
          </div>
        </div>
      )}
      <div className="admin-subtabs">
        <div className="segmented" role="tablist" aria-label="Content type">
          {types.map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={type === v}
              className={type === v ? "active" : ""}
              onClick={() => {
                setType(v);
                setPage(1);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <Select
          label="Status"
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
          }}
          options={[
            ["all", "Any status"],
            ["active", "Visible"],
            ["hidden", "Hidden"],
            ["removed", "Removed"],
          ]}
        />
      </div>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            {type === "comments" ? (
              <CommentItems rows={q.data.items as Models["AdminCommentRowDto"][]} empty="No comments" />
            ) : (
              <PostItems rows={q.data.items as Models["AdminPostRowDto"][]} reels={type === "reels"} empty={type === "reels" ? "No Reels" : "No posts"} />
            )}
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      {bulk && <BulkContentDialog user={user} status={bulk} counts={bulkCounts} onClose={() => setBulk(null)} />}
    </>
  );
}
