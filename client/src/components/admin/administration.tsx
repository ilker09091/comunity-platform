"use client";
import { Fragment, useDeferredValue, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Loader2, Minus, RefreshCw } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { bytes, compact, dateTime, fmt, humanize, uptime, useUrlFilters, type Role } from "@/lib/admin";
import { useToast } from "@/components/providers";
import { Avatar } from "@/components/ui";
import { ROLE_INFO, RolePicker, UserActionDialog, useAllowedUserActions } from "./users";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  Badge,
  DataTable,
  describeAudit,
  errorText,
  History,
  isCancelled,
  Item,
  ItemList,
  KeyValues,
  Pagination,
  Panel,
  RoleBadge,
  Select,
  TimeCell,
  Toolbar,
  UserCell,
  useSensitive,
} from "./kit";

/* ============================ Roles ============================ */

const PERMISSION_GROUPS: [string, string[]][] = [
  ["Users", ["users.read", "users.email.read", "users.update", "users.warn", "users.suspend", "users.ban", "users.roles.manage", "admins.manage"]],
  ["Content", ["posts.read", "posts.moderate", "comments.moderate", "reels.moderate", "media.manage"]],
  ["Safety", ["reports.read", "reports.resolve"]],
  ["Platform", ["notifications.broadcast", "analytics.read", "settings.read", "settings.update"]],
  ["Administration", ["audit.read", "system.read"]],
];

export function Roles() {
  const q = useQuery({ queryKey: ["admin", "roles"], queryFn: ({ signal }) => api("adminSystemRoles", { signal }) });
  const [changing, setChanging] = useState<Models["AdminUserRowDto"] | null>(null);
  if (q.isPending) return <AdminLoading label="Loading team" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const staffRoles = d.roles.filter((r) => r.role !== "USER");
  return (
    <AdminPage title="Team & roles" description="Give people access to the admin panel and choose what they can do. Every change is recorded in the audit log.">
      <AssignRole />

      <div className="team-groups">
        {staffRoles.map((r) => {
          const members = d.staff.filter((s) => s.role === r.role);
          return (
            <Panel
              key={r.role}
              title={
                <span className="team-title">
                  <RoleBadge role={r.role} /> <span className="muted">{members.length}</span>
                </span>
              }
              flush
            >
              <p className="admin-help team-desc">{ROLE_INFO[r.role]}</p>
              <ItemList label={humanize(r.role)} empty={<p className="admin-help team-desc">Nobody has this role yet.</p>}>
                {members.map((u) => (
                  <TeamMember key={u.id} user={u} onChange={() => setChanging(u)} />
                ))}
              </ItemList>
            </Panel>
          );
        })}
      </div>

      <details className="admin-disclosure">
        <summary>What can each role do?</summary>
        <div className="admin-table-wrap">
          <table className="admin-table matrix">
            <caption className="sr-only">Permissions by role</caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                {staffRoles.map((r) => (
                  <th key={r.role} scope="col" className="center">
                    {humanize(r.role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map(([group, perms]) => (
                <Fragment key={group}>
                  <tr className="group-row">
                    <th colSpan={staffRoles.length + 1} scope="colgroup">
                      {group}
                    </th>
                  </tr>
                  {perms
                    .filter((p) => d.allPermissions.includes(p))
                    .map((p) => (
                      <tr key={p}>
                        <th scope="row">{PERMISSION_LABELS[p] ?? p}</th>
                        {staffRoles.map((r) => (
                          <td key={r.role} className="center">
                            {r.permissions.includes(p) ? (
                              <Check size={16} className="text-ok" aria-label="Allowed" />
                            ) : (
                              <Minus size={16} className="muted" aria-label="Not allowed" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <Panel title="Recent role changes">
        <History items={d.recentChanges} empty="No role changes recorded yet." />
      </Panel>
      <p className="admin-footnote">
        The very first super admin is created on the server: <code>npm run user:set-role -- &lt;username&gt; SUPER_ADMIN</code>. The last super admin can’t be
        demoted.
      </p>
      {changing && <UserActionDialog user={changing} action="role" onClose={() => setChanging(null)} />}
    </AdminPage>
  );
}

function TeamMember({ user, onChange }: { user: Models["AdminUserRowDto"]; onChange: () => void }) {
  const { keys } = useAllowedUserActions(user);
  return (
    <Item
      href={`/admin/users/${user.id}`}
      leading={<Avatar user={user} size={36} />}
      title={
        <span>
          {user.displayName} <span className="muted">@{user.username}</span>
        </span>
      }
      badges={user.status !== "ACTIVE" ? <Badge value={user.status} /> : undefined}
      meta={<span>{user.lastActiveAt ? <>Active <TimeCell value={user.lastActiveAt} /></> : "No recent activity"}</span>}
      actions={
        keys.includes("role") ? (
          <button className="button secondary xs" onClick={onChange}>
            Change role
          </button>
        ) : undefined
      }
    />
  );
}

/** Search for any account, pick a role, confirm with your password. */
function AssignRole() {
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term.trim().replace(/^@/, ""));
  const [picked, setPicked] = useState<Models["AdminUserRowDto"] | null>(null);
  const results = useQuery({
    queryKey: ["admin", "role-search", deferred],
    queryFn: ({ signal }) => api("adminUsersList", { query: { q: deferred, pageSize: 6 }, signal }),
    enabled: deferred.length >= 2 && !picked,
    placeholderData: (prev) => prev,
  });
  return (
    <Panel title="Give someone a role" className="assign-role">
      {!picked ? (
        <>
          <label className="form-field">
            <span>Find a person</span>
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Type a name or @username"
              autoComplete="off"
              maxLength={100}
            />
          </label>
          {deferred.length >= 2 &&
            (results.isPending ? (
              <AdminLoading label="Searching" />
            ) : results.data?.items.length ? (
              <ul className="pick-list">
                {results.data.items.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => setPicked(u)}>
                      <Avatar user={u} size={32} />
                      <span className="user-cell-text">
                        <strong>{u.displayName}</strong>
                        <span>@{u.username}</span>
                      </span>
                      <RoleBadge role={u.role} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-help">No one matches “{deferred}”.</p>
            ))}
        </>
      ) : (
        <AssignRoleTo user={picked} onReset={() => { setPicked(null); setTerm(""); }} />
      )}
    </Panel>
  );
}

function AssignRoleTo({ user, onReset }: { user: Models["AdminUserRowDto"]; onReset: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const { keys, roleOptions, self } = useAllowedUserActions(user);
  const [role, setRole] = useState<Role | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!role) return;
    setBusy(true);
    setError("");
    try {
      await sensitive((headers) => api("adminUsersRole", { params: { id: user.id }, body: { role }, headers }));
      toast(`@${user.username} is now ${role === "USER" ? "a member" : humanize(role)}.`);
      await client.invalidateQueries({ queryKey: ["admin"] });
      onReset();
    } catch (e) {
      if (!isCancelled(e)) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="assign-step">
      <div className="picked-user">
        <Avatar user={user} size={40} />
        <span className="user-cell-text">
          <strong>{user.displayName}</strong>
          <span>@{user.username}</span>
        </span>
        <RoleBadge role={user.role} />
        <button type="button" className="button ghost xs" onClick={onReset}>
          Choose someone else
        </button>
      </div>
      {!keys.includes("role") ? (
        <p className="admin-note">
          {self ? "You can’t change your own role." : "You can’t change this person’s role: their role is the same as or higher than yours."}
        </p>
      ) : (
        <>
          <RolePicker options={roleOptions} value={role} onChange={setRole} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="button" disabled={!role || busy} onClick={save}>
              {busy && <Loader2 size={15} className="spin" />} Save role
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const PERMISSION_LABELS: Record<string, string> = {
  "users.read": "See accounts",
  "users.email.read": "See email addresses",
  "users.update": "Edit accounts",
  "users.warn": "Send warnings",
  "users.suspend": "Suspend accounts",
  "users.ban": "Ban accounts",
  "users.roles.manage": "Give roles below their own",
  "admins.manage": "Manage admins",
  "posts.read": "See all content",
  "posts.moderate": "Hide/remove posts",
  "comments.moderate": "Hide/remove comments",
  "reels.moderate": "Hide/remove Reels",
  "media.manage": "Manage media files",
  "reports.read": "See reports",
  "reports.resolve": "Handle reports",
  "notifications.broadcast": "Send announcements",
  "analytics.read": "See analytics",
  "settings.read": "See settings",
  "settings.update": "Change settings",
  "audit.read": "See the audit log",
  "system.read": "See system status",
};

/* ============================ Audit log ============================ */

const TARGETS: [string, string][] = [
  ["", "All targets"],
  ...["USER", "POST", "COMMENT", "REPORT", "MEDIA", "ANNOUNCEMENT", "SETTINGS", "SYSTEM"].map((t) => [t, humanize(t)] as [string, string]),
];

export function AuditLog() {
  const f = useUrlFilters<"action" | "targetType" | "actorId" | "targetId" | "order">({ order: "desc" });
  const query = compact({
    action: f.get("action"),
    targetType: f.get("targetType"),
    actorId: f.get("actorId"),
    targetId: f.get("targetId"),
    order: f.get("order"),
    page: f.page,
    pageSize: 50,
  });
  const actions = useQuery({ queryKey: ["admin", "audit-actions"], queryFn: ({ signal }) => api("adminSystemActions", { signal }), staleTime: 300_000 });
  const q = useQuery({ queryKey: ["admin", "audit", query], queryFn: ({ signal }) => api("adminSystemAudit", { query, signal }), placeholderData: (p) => p });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <AdminPage title="Audit log" description="Append-only record of every administrative action. Entries can’t be edited or deleted.">
      <Toolbar>
        <Select
          label="Action"
          value={f.get("action")}
          onChange={(v) => f.set({ action: v })}
          options={[["", "All actions"], ...(actions.data ?? []).map((a) => [a, humanize(a)] as [string, string])]}
        />
        <Select label="Target type" value={f.get("targetType")} onChange={(v) => f.set({ targetType: v })} options={TARGETS} />
        <Select label="Order" value={f.get("order")} onChange={(v) => f.set({ order: v })} options={[["desc", "Newest first"], ["asc", "Oldest first"]]} />
        {(f.get("actorId") || f.get("targetId")) && (
          <button className="admin-chip" onClick={() => f.set({ actorId: "", targetId: "" })}>
            {f.get("actorId") ? "One actor" : "One target"} ✕
          </button>
        )}
      </Toolbar>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : !q.data.items.length ? (
          <AdminEmpty title="No entries match these filters" />
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Audit log</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Expand</span>
                    </th>
                    <th scope="col">Action</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Target</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((l) => (
                    <Fragment key={l.id}>
                      <tr>
                        <td className="expand-cell">
                          <button
                            className="icon-button small"
                            aria-expanded={open === l.id}
                            aria-label={open === l.id ? "Hide details" : "Show details"}
                            onClick={() => setOpen(open === l.id ? null : l.id)}
                          >
                            {open === l.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td>
                          <span className="cell-stack">
                            <strong>{humanize(l.action)}</strong>
                            <span className="clamp-1">{describeAudit(l) || l.action}</span>
                          </span>
                        </td>
                        <td>
                          {l.actor ? (
                            <button className="link-button" onClick={() => f.set({ actorId: l.actor!.id })} title="Show only this actor">
                              @{l.actor.username}
                            </button>
                          ) : (
                            <span className="muted">System</span>
                          )}{" "}
                          {l.actorRole && <span className="muted">· {humanize(l.actorRole)}</span>}
                        </td>
                        <td>
                          {l.targetType ? (
                            <AuditTarget log={l} />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <time dateTime={l.createdAt}>{dateTime(l.createdAt)}</time>
                        </td>
                      </tr>
                      {open === l.id && (
                        <tr className="detail-row">
                          <td />
                          <td colSpan={4}>
                            <KeyValues
                              items={[
                                ["Request ID", l.requestId ? <code key="r">{l.requestId}</code> : "—"],
                                ["IP address", l.ipAddress ?? "—"],
                                ["Target ID", l.targetId ? <code key="t">{l.targetId}</code> : "—"],
                              ]}
                            />
                            <pre className="audit-json">{JSON.stringify(l.metadata, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(page) => f.set({ page })} />
          </>
        )}
      </Panel>
    </AdminPage>
  );
}

function AuditTarget({ log }: { log: Models["AuditLogDto"] }) {
  const href =
    log.targetId &&
    ({ USER: `/admin/users/${log.targetId}`, POST: `/admin/posts/${log.targetId}`, COMMENT: `/admin/comments/${log.targetId}`, REPORT: `/admin/reports/${log.targetId}` } as Record<
      string,
      string
    >)[log.targetType!];
  const label = log.targetLabel ?? humanize(log.targetType!);
  return href ? (
    <Link href={href} className="inline-link">
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

/* ============================ System ============================ */

function HealthCard({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <Panel title={title} action={<Badge value={status} label={status === "OK" ? "Healthy" : humanize(status)} />}>
      {children}
    </Panel>
  );
}

export function SystemStatus() {
  const q = useQuery({ queryKey: ["admin", "system"], queryFn: ({ signal }) => api("adminSystemSystem", { signal }), refetchInterval: 30_000 });
  if (q.isPending) return <AdminLoading label="Checking services" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const s = q.data;
  const used = s.storage.totalBytes && s.storage.freeBytes !== null ? s.storage.totalBytes - s.storage.freeBytes : null;
  return (
    <AdminPage
      title="System status"
      description={`Checked ${dateTime(s.checkedAt)} · refreshes every 30 seconds`}
      actions={
        <button className="button secondary small" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw size={15} className={q.isFetching ? "spin" : ""} /> Check now
        </button>
      }
    >
      <div className="admin-grid-3">
        <HealthCard title="API" status="OK">
          <KeyValues
            items={[
              ["App version", s.api.appVersion],
              ["API version", s.api.apiVersion],
              ["Environment", s.api.environment],
              ["Node.js", s.api.nodeVersion],
              ["Uptime", uptime(s.api.uptimeSeconds)],
              ["Started", dateTime(s.api.startedAt)],
            ]}
          />
        </HealthCard>
        <HealthCard title="Database" status={s.database.status}>
          <KeyValues
            items={[
              ["Latency", s.database.latencyMs !== null ? `${s.database.latencyMs} ms` : "—"],
              ["Server", s.database.version ?? "—"],
              ["Applied migrations", fmt(s.database.appliedMigrations)],
              [
                "Pending migrations",
                s.database.pendingMigrations.length ? (
                  <span className="text-warn">{s.database.pendingMigrations.join(", ")}</span>
                ) : (
                  "None"
                ),
              ],
              ...(s.database.detail ? ([["Detail", s.database.detail]] as [string, string][]) : []),
            ]}
          />
        </HealthCard>
        <HealthCard title="Media storage" status={s.storage.status}>
          <KeyValues
            items={[
              ["Driver", s.storage.driver],
              ["Latency", s.storage.latencyMs !== null ? `${s.storage.latencyMs} ms` : "—"],
              ["Free space", s.storage.freeBytes !== null ? `${bytes(s.storage.freeBytes)} of ${bytes(s.storage.totalBytes)}` : "Not reported"],
              ...(s.storage.detail ? ([["Detail", s.storage.detail]] as [string, string][]) : []),
            ]}
          />
          {used !== null && s.storage.totalBytes ? (
            <div className="usage-meter" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((used / s.storage.totalBytes) * 100)}>
              <span style={{ width: `${(used / s.storage.totalBytes) * 100}%` }} />
            </div>
          ) : null}
        </HealthCard>
      </div>
      <Panel title="Background jobs" flush>
        <DataTable
          caption="Background jobs"
          rows={s.jobs.map((j) => ({ ...j, id: j.name }))}
          empty={<AdminEmpty title="No scheduled jobs registered" />}
          columns={[
            { key: "name", header: "Job", cell: (j) => <span className="cell-stack"><strong>{j.name}</strong><span>{j.description}</span></span> },
            { key: "schedule", header: "Schedule", cell: (j) => j.schedule },
            { key: "last", header: "Last run", cell: (j) => (j.lastRunAt ? <TimeCell value={j.lastRunAt} /> : <span className="muted">Not yet run since start</span>) },
            { key: "status", header: "Result", cell: (j) => (j.lastStatus ? <Badge value={j.lastStatus} /> : "—") },
            { key: "detail", header: "Detail", cell: (j) => j.lastDetail ?? "—" },
          ]}
        />
      </Panel>
      <Panel title="Recent server errors" flush>
        <DataTable
          caption="Recent server errors"
          rows={s.recentErrors.map((e, i) => ({ ...e, id: `${e.at}-${i}` }))}
          empty={<AdminEmpty title="No server errors since the last restart" description="Only 5xx responses are recorded (last 50, in memory)." />}
          columns={[
            { key: "at", header: "When", cell: (e) => <TimeCell value={e.at} /> },
            { key: "req", header: "Request", cell: (e) => <code>{e.method} {e.path}</code> },
            { key: "code", header: "Status", cell: (e) => e.statusCode },
            { key: "err", header: "Error", cell: (e) => <span className="clamp-2">{e.error}</span> },
            { key: "id", header: "Request ID", cell: (e) => (e.requestId ? <code>{e.requestId}</code> : "—") },
          ]}
        />
      </Panel>
      <p className="admin-footnote">
        CPU and memory metrics aren’t collected by this server, so they aren’t shown. No shell or environment access is available from the admin panel.
      </p>
    </AdminPage>
  );
}
