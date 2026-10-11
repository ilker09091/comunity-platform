"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, FileText, Loader2, MessageCircle, UserCheck, UserRound, UserX } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { compact, dateTime, fmt, humanize, REPORT_REASONS, useAdminMe, useCan, useUrlFilters } from "@/lib/admin";
import { useToast } from "@/components/providers";
import {
  ActionDialog,
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  Badge,
  DataTable,
  errorText,
  History,
  Item,
  ItemList,
  KeyValues,
  Pagination,
  Panel,
  RoleBadge,
  Select,
  Tabs,
  TimeCell,
  UserCell,
  useSensitive,
} from "./kit";
import { PostBody, PostCell } from "./content";

type Report = Models["AdminReportRowDto"];
type Action = Models["ReportAction"];

function targetLabel(r: Report) {
  return r.isReel ? "Reel" : humanize(r.targetType);
}

const TARGET_ICONS = { POST: FileText, REEL: Clapperboard, COMMENT: MessageCircle, USER: UserRound } as const;

export function ReportsTable({ rows, empty = "No reports" }: { rows: Report[]; empty?: string }) {
  return (
    <ItemList label="Reports" empty={<AdminEmpty title={empty} />}>
      {rows.map((r) => {
        const Icon = TARGET_ICONS[r.isReel ? "REEL" : r.targetType];
        return (
          <Item
            key={r.id}
            href={`/admin/reports/${r.id}`}
            leading={
              <span className={`report-icon reason-${r.reason.toLowerCase()}`} aria-hidden="true">
                <Icon size={18} />
              </span>
            }
            title={
              <span>
                {humanize(r.reason)} <span className="muted">· {targetLabel(r)}</span>
              </span>
            }
            badges={
              <>
                {r.status !== "OPEN" && <Badge value={r.status} />}
                {r.samePendingCount > 1 && <span className="report-chip">{r.samePendingCount} reports on this</span>}
              </>
            }
            body={r.target.exists ? (r.target.preview ?? "—") : <span className="muted">The reported item no longer exists</span>}
            meta={
              <>
                <TimeCell value={r.createdAt} />
                {r.target.owner && <span>Against @{r.target.owner.username}</span>}
                <span>By @{r.reporter?.username}</span>
                <span>{r.assignee ? `Assigned to @${r.assignee.username}` : "Unassigned"}</span>
              </>
            }
            actions={
              <Link href={`/admin/reports/${r.id}`} className="button secondary xs">
                {r.status === "OPEN" || r.status === "IN_REVIEW" ? "Review" : "View"}
              </Link>
            }
          />
        );
      })}
    </ItemList>
  );
}

const QUEUE_TABS = [
  { value: "PENDING", label: "To review" },
  { value: "mine", label: "Assigned to me" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "DISMISSED", label: "Dismissed" },
];

export function ReportsQueue() {
  const f = useUrlFilters<"tab" | "type" | "reason">({ tab: "PENDING" });
  const tab = f.get("tab");
  const query = compact({
    status: tab === "mine" ? "PENDING" : tab,
    assigned: tab === "mine" ? "me" : "",
    targetType: f.get("type"),
    reason: f.get("reason"),
    order: tab === "PENDING" || tab === "mine" ? "asc" : "desc",
    page: f.page,
    pageSize: 20,
  });
  const q = useQuery({
    queryKey: ["admin", "reports", query],
    queryFn: ({ signal }) => api("adminReportsList", { query, signal }),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const pending = useQuery({
    queryKey: ["admin", "pending-reports"],
    queryFn: ({ signal }) => api("adminReportsList", { query: { status: "PENDING", pageSize: 1 }, signal }),
  });
  return (
    <AdminPage title="Reports" description="What members reported. Oldest first, so nothing waits too long. Open one to take action.">
      <Tabs
        label="Report status"
        value={tab}
        onChange={(v) => f.set({ tab: v })}
        items={QUEUE_TABS.map((t) => (t.value === "PENDING" ? { ...t, count: pending.data?.total } : t))}
      />
      <div className="admin-subtabs">
        <div className="segmented" role="tablist" aria-label="Reported item">
          {[
            ["", "Everything"],
            ["POST", "Posts"],
            ["REEL", "Reels"],
            ["COMMENT", "Comments"],
            ["USER", "Accounts"],
          ].map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={f.get("type") === v} className={f.get("type") === v ? "active" : ""} onClick={() => f.set({ type: v })}>
              {l}
            </button>
          ))}
        </div>
        <Select label="Reason" value={f.get("reason")} onChange={(v) => f.set({ reason: v })} options={[["", "Any reason"], ...REPORT_REASONS.map((r) => [r, humanize(r)] as [string, string])]} />
      </div>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            <ReportsTable rows={q.data.items} empty={tab === "PENDING" ? "All caught up — nothing to review" : tab === "mine" ? "Nothing assigned to you" : "No reports here"} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(page) => f.set({ page })} />
          </>
        )}
      </Panel>
    </AdminPage>
  );
}

const ACTION_LABELS: Record<Action, string> = {
  HIDE_CONTENT: "Hide content",
  REMOVE_CONTENT: "Remove content",
  RESTORE_CONTENT: "Restore content",
  WARN_USER: "Warn the account",
  SUSPEND_USER: "Suspend the account",
  BAN_USER: "Ban the account",
};

export function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const can = useCan();
  const me = useAdminMe().data!;
  const [action, setAction] = useState<Action | null>(null);
  const [closing, setClosing] = useState<"RESOLVED" | "DISMISSED" | null>(null);
  const [resolve, setResolve] = useState(true);
  const [warning, setWarning] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [phrase, setPhrase] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["admin", "report", id], queryFn: ({ signal }) => api("adminReportsDetail", { params: { id }, signal }) });
  if (q.isPending) return <AdminLoading label="Loading report" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const r = d.report;
  const canResolve = can("reports.resolve");
  const closed = r.status === "RESOLVED" || r.status === "DISMISSED";
  const owner = r.target.owner;
  const refresh = () => client.invalidateQueries({ queryKey: ["admin"] });
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      await refresh();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const contentStatus = (d.post?.post.moderationStatus ?? d.comment?.comment.moderationStatus) as Models["ContentModerationStatus"] | undefined;
  const actions: Action[] = [
    ...(r.targetType !== "USER" && r.target.exists
      ? ([contentStatus === "ACTIVE" && "HIDE_CONTENT", contentStatus !== "REMOVED" && "REMOVE_CONTENT", contentStatus !== "ACTIVE" && "RESTORE_CONTENT"].filter(
          Boolean,
        ) as Action[])
      : []),
    ...(owner && owner.id !== me.user.id
      ? ([can("users.warn") && "WARN_USER", can("users.suspend") && owner.status === "ACTIVE" && "SUSPEND_USER", can("users.ban") && owner.status !== "BANNED" && "BAN_USER"].filter(
          Boolean,
        ) as Action[])
      : []),
  ];
  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    const body = note.trim();
    if (!body) return;
    await run(() => api("adminReportsNote", { params: { id }, body: { body } }), "Note added.");
    setNote("");
  };

  return (
    <AdminPage
      title={`${humanize(r.reason)} report`}
      description={`${targetLabel(r)} · received ${dateTime(r.createdAt)}`}
      actions={
        canResolve && (
          <div className="quick-actions">
            {r.assignee?.id === me.user.id ? (
              <button className="button secondary small" disabled={busy} onClick={() => run(() => api("adminReportsAssign", { params: { id }, body: { assigneeId: null } }), "Unassigned.")}>
                <UserX size={15} /> Unassign me
              </button>
            ) : (
              !closed && (
                <button className="button secondary small" disabled={busy} onClick={() => run(() => api("adminReportsAssign", { params: { id }, body: { assigneeId: me.user.id } }), "Assigned to you.")}>
                  <UserCheck size={15} /> Assign to me
                </button>
              )
            )}
            {r.status === "IN_REVIEW" && (
              <button className="button secondary small" disabled={busy} onClick={() => run(() => api("adminReportsStatus", { params: { id }, body: { status: "OPEN" } }), "Moved back to open.")}>
                Back to open
              </button>
            )}
            {!closed && (
              <>
                <button className="button secondary small" disabled={busy} onClick={() => setClosing("DISMISSED")}>
                  Dismiss
                </button>
                <button className="button small" disabled={busy} onClick={() => setClosing("RESOLVED")}>
                  Resolve without action
                </button>
              </>
            )}
            {closed && (
              <button className="button secondary small" disabled={busy} onClick={() => run(() => api("adminReportsStatus", { params: { id }, body: { status: "OPEN" } }), "Report reopened.")}>
                Reopen
              </button>
            )}
          </div>
        )
      }
    >
      <div className="admin-grid-main">
        <div className="admin-stack">
          <Panel title="Reported content" action={<Badge value={r.status} />}>
            {!r.target.exists ? (
              <AdminEmpty title="The reported item no longer exists" />
            ) : d.post ? (
              <>
                <div className="admin-author-row">
                  <UserCell user={d.post.post.author} />
                  <Link href={`/admin/posts/${d.post.post.id}`} className="panel-link">
                    Open {r.isReel ? "Reel" : "post"} · <Badge value={d.post.post.moderationStatus} />
                  </Link>
                </div>
                <PostBody detail={d.post} />
              </>
            ) : d.comment ? (
              <>
                <div className="admin-author-row">
                  <UserCell user={d.comment.comment.author} />
                  <Link href={`/admin/comments/${d.comment.comment.id}`} className="panel-link">
                    Open comment · <Badge value={d.comment.comment.moderationStatus} />
                  </Link>
                </div>
                <p className="admin-post-text">{d.comment.comment.content}</p>
                <p className="admin-muted-line">
                  On <Link href={`/admin/posts/${d.comment.post.id}`}><PostCell post={d.comment.post} /></Link>
                </p>
              </>
            ) : d.user ? (
              <div className="admin-author-row">
                <UserCell user={d.user} sub={`@${d.user.username} · ${fmt(d.user.postCount)} posts · joined ${dateTime(d.user.createdAt)}`} />
                <span className="badges">
                  <RoleBadge role={d.user.role} />
                  <Badge value={d.user.status} />
                </span>
              </div>
            ) : null}
          </Panel>

          {canResolve && actions.length > 0 && (
            <Panel title="Take action">
              <p className="admin-muted-line">Actions use the same permission and rank rules as everywhere else and are recorded in the audit log.</p>
              <div className="action-grid">
                {actions.map((a) => (
                  <button
                    key={a}
                    className={`button ${a === "BAN_USER" || a === "REMOVE_CONTENT" ? "danger" : "secondary"} small`}
                    onClick={() => {
                      setResolve(true);
                      setWarning("");
                      setExpiresAt("");
                      setPhrase("");
                      setAction(a);
                    }}
                  >
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Internal notes">
            {d.notes.length ? (
              <ul className="admin-notes">
                {d.notes.map((n) => (
                  <li key={n.id}>
                    <p>{n.body}</p>
                    <span>
                      @{n.author?.username} · <TimeCell value={n.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted-line">No notes yet. Notes are visible to staff only.</p>
            )}
            <form className="admin-note-form" onSubmit={addNote}>
              <label className="sr-only" htmlFor="report-note">
                Add an internal note
              </label>
              <textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} placeholder="Add an internal note…" />
              <button className="button small" disabled={busy || !note.trim()}>
                {busy && <Loader2 size={14} className="spin" />} Add note
              </button>
            </form>
          </Panel>
        </div>
        <div className="admin-stack">
          <Panel title="Report">
            <KeyValues
              items={[
                ["Reason", humanize(r.reason)],
                ["Reporter", <UserCell key="r" user={r.reporter} />],
                ["Details", r.details || <span className="muted">None given</span>],
                ["Assignee", r.assignee ? `@${r.assignee.username}` : "Unassigned"],
                ["Other pending on target", fmt(Math.max(0, r.samePendingCount - (closed ? 0 : 1)))],
                ...(closed
                  ? ([
                      ["Closed", dateTime(r.resolvedAt)],
                      ["Resolution note", r.resolutionNote || "—"],
                    ] as [string, string][])
                  : []),
              ]}
            />
          </Panel>
          <Panel title="History">
            <History items={d.history} />
          </Panel>
        </div>
      </div>
      {d.related.length > 0 && (
        <Panel title="Other reports about this target" flush>
          <ReportsTable rows={d.related} />
        </Panel>
      )}

      {closing && (
        <ActionDialog
          title={closing === "DISMISSED" ? "Dismiss report" : "Resolve report"}
          description={closing === "DISMISSED" ? "Use this when the report doesn’t violate policy." : "Mark the report as handled without changing the content or account."}
          confirmLabel={closing === "DISMISSED" ? "Dismiss" : "Resolve"}
          reasonLabel="Resolution note"
          reasonRequired={false}
          onClose={() => setClosing(null)}
          onSubmit={async (text) => {
            await api("adminReportsStatus", { params: { id }, body: { status: closing, ...(text ? { note: text } : {}) } });
            toast(closing === "DISMISSED" ? "Report dismissed." : "Report resolved.");
            await refresh();
          }}
        />
      )}
      {action && (
        <ActionDialog
          title={ACTION_LABELS[action]}
          tone={action === "BAN_USER" || action === "REMOVE_CONTENT" || action === "SUSPEND_USER" ? "danger" : "primary"}
          confirmLabel={ACTION_LABELS[action]}
          description={action === "BAN_USER" ? "Bans are indefinite and sign the account out everywhere." : undefined}
          extra={
            <>
              {action === "WARN_USER" && (
                <label className="form-field">
                  <span>Message to the member</span>
                  <textarea value={warning} onChange={(e) => setWarning(e.target.value)} rows={3} maxLength={1000} required minLength={5} />
                </label>
              )}
              {action === "SUSPEND_USER" && (
                <label className="form-field">
                  <span>Ends (optional)</span>
                  <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </label>
              )}
              {action === "BAN_USER" && owner && (
                <label className="form-field">
                  <span>
                    Type <code>{owner.username}</code> to confirm
                  </span>
                  <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
              )}
              <label className="check-row">
                <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
                Resolve this report (and other pending reports on the same target)
              </label>
            </>
          }
          onClose={() => setAction(null)}
          onSubmit={async (reason) => {
            const body = {
              action,
              reason,
              resolve,
              ...(action === "WARN_USER" ? { warningMessage: warning.trim() } : {}),
              ...(action === "SUSPEND_USER" && expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
              ...(action === "BAN_USER" ? { confirmUsername: phrase } : {}),
            };
            if (action === "BAN_USER") await sensitive((headers) => api("adminReportsAct", { params: { id }, body, headers }));
            else await api("adminReportsAct", { params: { id }, body });
            toast("Action applied.");
            await refresh();
          }}
        />
      )}
    </AdminPage>
  );
}
