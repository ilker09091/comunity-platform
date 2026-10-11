"use client";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Lock,
  Search,
  ShieldAlert,
} from "lucide-react";
import { api, ApiError, type Models } from "@/lib/api/client";
import {
  clearStepUp,
  currentStepUpToken,
  dateTime,
  fmt,
  humanize,
  isStepUpError,
  stepUpHeaders,
  storeStepUp,
} from "@/lib/admin";
import { Avatar, Modal, relativeTime } from "@/components/ui";

/* ======================= Step-up ======================= */

const StepUpContext = createContext<() => Promise<boolean>>(async () => false);
export const CANCELLED = "CANCELLED";

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<((ok: boolean) => void) | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        setPassword("");
        setError("");
        setPending(() => resolve);
      }),
    [],
  );
  const finish = (ok: boolean) => {
    pending?.(ok);
    setPending(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api("adminCoreStepUpToken", { body: { password } });
      storeStepUp(res.token, res.expiresAt);
      finish(true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "INVALID_CREDENTIALS" ? "That password is incorrect." : (err as Error).message);
    } finally {
      setBusy(false);
      setPassword("");
    }
  };
  return (
    <StepUpContext.Provider value={request}>
      {children}
      {pending && (
        <Modal title="Confirm it’s you" onClose={() => finish(false)} className="admin-stepup">
          <form onSubmit={submit}>
            <p className="stepup-intro">
              <Lock size={18} aria-hidden="true" />
              This action is sensitive. Enter your password to continue. You won’t be asked again for 10 minutes.
            </p>
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-autofocus
                aria-invalid={!!error}
              />
            </label>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => finish(false)} disabled={busy}>
                Cancel
              </button>
              <button className="button" disabled={busy || !password}>
                {busy && <Loader2 size={16} className="spin" />} Confirm
              </button>
            </div>
          </form>
        </Modal>
      )}
    </StepUpContext.Provider>
  );
}

/**
 * Runs a sensitive operation with the step-up header, asking for the password first
 * (or again if the server rejects an expired token). Throws ApiError(CANCELLED) on cancel.
 */
export function useSensitive() {
  const request = useContext(StepUpContext);
  return useCallback(
    async <T,>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> => {
      const cancelled = () => new ApiError(0, CANCELLED, "Confirmation cancelled.");
      if (!currentStepUpToken() && !(await request())) throw cancelled();
      try {
        return await fn(stepUpHeaders());
      } catch (error) {
        if (!isStepUpError(error)) throw error;
        clearStepUp();
        if (!(await request())) throw cancelled();
        return fn(stepUpHeaders());
      }
    },
    [request],
  );
}
export const isCancelled = (e: unknown) => e instanceof ApiError && e.code === CANCELLED;

/* ======================= Layout pieces ======================= */

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="admin-page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`admin-panel ${flush ? "flush" : ""} ${className}`}>
      {(title || action) && (
        <header>
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      <div className="admin-panel-body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: number | null | undefined;
  hint?: ReactNode;
  href?: string;
  tone?: "warning" | "danger";
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value === null ? <span className="muted">Not tracked yet</span> : fmt(value)}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  const cls = `admin-stat ${tone ? `tone-${tone}` : ""}`;
  return href ? (
    <Link href={href} className={`${cls} link`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KeyValues({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="admin-kv">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="admin-loading" role="status">
      <Loader2 className="spin" size={20} /> {label}…
    </div>
  );
}
export function AdminError({ error, retry }: { error: Error | null; retry?: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div className="admin-error" role="alert">
      {forbidden ? <ShieldAlert size={22} /> : <AlertTriangle size={22} />}
      <div>
        <strong>{forbidden ? "You don’t have access to this" : "Couldn’t load this"}</strong>
        <p>{forbidden ? "Your role doesn’t include the permission this page needs." : (error?.message ?? "Please try again.")}</p>
      </div>
      {retry && !forbidden && (
        <button className="button secondary small" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}
export function AdminEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="admin-empty">
      <Inbox size={22} aria-hidden="true" />
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

/* ======================= Badges ======================= */

const TONES: Record<string, string> = {
  ACTIVE: "ok",
  OK: "ok",
  READY: "ok",
  PUBLISHED: "ok",
  RESOLVED: "ok",
  OPEN: "info",
  IN_REVIEW: "warn",
  DRAFT: "neutral",
  PENDING: "neutral",
  DISMISSED: "neutral",
  ARCHIVED: "neutral",
  DEACTIVATED: "neutral",
  HIDDEN: "warn",
  SUSPENDED: "warn",
  DEGRADED: "warn",
  SIZE_MISMATCH: "warn",
  REMOVED: "danger",
  BANNED: "danger",
  FAILED: "danger",
  DOWN: "danger",
  MISSING: "danger",
  ERROR: "danger",
};
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`admin-badge tone-${TONES[value] ?? "neutral"}`}>{label ?? humanize(value)}</span>;
}
export function RoleBadge({ role }: { role: Models["UserRole"] }) {
  if (role === "USER") return <span className="admin-role role-user">Member</span>;
  return <span className={`admin-role role-${role.toLowerCase()}`}>{humanize(role)}</span>;
}

type Ref = Models["AdminUserRefDto"];
export function UserCell({ user, sub, link = true }: { user: Ref | null | undefined; sub?: ReactNode; link?: boolean }) {
  if (!user) return <span className="muted">System</span>;
  const body = (
    <>
      <Avatar user={user} size={30} />
      <span className="user-cell-text">
        <strong>{user.displayName}</strong>
        <span>{sub ?? `@${user.username}`}</span>
      </span>
    </>
  );
  return link ? (
    <Link href={`/admin/users/${user.id}`} className="user-cell">
      {body}
    </Link>
  ) : (
    <span className="user-cell">{body}</span>
  );
}

export function TimeCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <time dateTime={value} title={dateTime(value)}>
      {relativeTime(value)}
    </time>
  );
}

/* ======================= Table ======================= */

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty,
  caption,
  onRowHref,
}: {
  columns: Column<T>[];
  rows: T[];
  empty: ReactNode;
  caption: string;
  onRowHref?: (row: T) => string;
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={onRowHref ? "linked" : ""}>
              {columns.map((c, i) => (
                <td key={c.key} className={c.className}>
                  {i === 0 && onRowHref ? (
                    <Link href={onRowHref(row)} className="row-link">
                      {c.cell(row)}
                    </Link>
                  ) : (
                    c.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  return (
    <nav className="admin-pagination" aria-label="Pagination">
      <span>
        {fmt(first)}–{fmt(Math.min(total, page * pageSize))} of {fmt(total)}
      </span>
      <div>
        <button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={18} />
        </button>
        <span aria-current="page">
          Page {page} of {pages}
        </span>
        <button className="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  );
}

/* ======================= Filters ======================= */

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}
export function SearchBox({
  value,
  onSearch,
  placeholder,
}: {
  value: string;
  onSearch: (q: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return (
    <form
      className="admin-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        maxLength={100}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!e.target.value) onSearch("");
        }}
      />
    </form>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="admin-select">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ======================= Action dialog ======================= */

/**
 * A reasoned action: requires a written reason, optionally a typed confirmation phrase,
 * and renders any extra fields the caller provides.
 */
export function ActionDialog({
  title,
  description,
  confirmLabel,
  tone = "primary",
  confirmPhrase,
  reasonLabel = "Reason (recorded in the audit log)",
  reasonRequired = true,
  noReason = false,
  presets,
  extra,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  confirmPhrase?: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  /** Hide the reason field entirely (for actions whose API takes no reason). */
  noReason?: boolean;
  /** One-tap reasons that fill the reason field. */
  presets?: string[];
  extra?: ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = (noReason || !reasonRequired || reason.trim().length >= 3) && (!confirmPhrase || phrase === confirmPhrase);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (err) {
      if (!isCancelled(err)) setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} guardClose={() => !busy}>
      <form onSubmit={submit} className="admin-action-form">
        {description && <div className="admin-action-desc">{description}</div>}
        {extra}
        {!noReason && presets && (
          <div className="reason-presets" role="group" aria-label="Common reasons">
            {presets.map((p) => (
              <button type="button" key={p} className={`admin-chip ${reason === p ? "selected" : ""}`} onClick={() => setReason(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        {!noReason && (
        <label className="form-field">
          <span>
            {reasonLabel}
            {!reasonRequired && <small> · optional</small>}
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            required={reasonRequired}
            minLength={reasonRequired ? 3 : undefined}
            data-autofocus
          />
        </label>
        )}
        {confirmPhrase && (
          <label className="form-field">
            <span>
              Type <code>{confirmPhrase}</code> to confirm
            </span>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`button ${tone === "danger" ? "danger" : ""}`} disabled={busy || !ready}>
            {busy && <Loader2 size={16} className="spin" />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function errorText(err: unknown) {
  if (err instanceof ApiError) {
    const detail = err.details?.map((d) => d.message).join(" ");
    return detail ? `${err.message}: ${detail}` : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/* ======================= History ======================= */

export function describeAudit(log: Models["AuditLogDto"]) {
  const m = log.metadata as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.reason === "string" && m.reason) parts.push(`“${m.reason}”`);
  if (m.from !== undefined && m.to !== undefined) parts.push(`${String(m.from)} → ${String(m.to)}`);
  if (m.previousStatus && m.newStatus) parts.push(`${String(m.previousStatus)} → ${String(m.newStatus)}`);
  if (m.expiresAt) parts.push(`until ${dateTime(String(m.expiresAt))}`);
  return parts.join(" · ");
}

export function History({ items, empty = "No recorded actions yet." }: { items: Models["AuditLogDto"][]; empty?: string }) {
  if (!items.length) return <p className="muted admin-muted-line">{empty}</p>;
  return (
    <ol className="admin-history">
      {items.map((h) => (
        <li key={h.id}>
          <span className="dot" aria-hidden="true" />
          <div>
            <p>
              <strong>{humanize(h.action)}</strong>
              {h.targetLabel && h.targetType === "USER" && <span> · {h.targetLabel}</span>}
              {h.actor ? (
                <>
                  {" "}
                  by <Link href={`/admin/users/${h.actor.id}`}>@{h.actor.username}</Link>
                </>
              ) : (
                <span className="muted"> · system</span>
              )}
            </p>
            {describeAudit(h) && <p className="muted">{describeAudit(h)}</p>}
            <TimeCell value={h.createdAt} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ======================= Tabs & simple lists ======================= */

export function Tabs({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; count?: number }[];
}) {
  return (
    <div className="admin-tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={value === t.value ? "active" : ""}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {!!t.count && <span className="tab-count">{t.count > 99 ? "99+" : t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Simple stacked rows: a primary area (usually a link), a meta line and actions on the right. */
export function ItemList({ children, empty, label }: { children: ReactNode[]; empty: ReactNode; label: string }) {
  if (!children.length) return <>{empty}</>;
  return (
    <ul className="admin-list" aria-label={label}>
      {children}
    </ul>
  );
}
export function Item({
  href,
  leading,
  title,
  body,
  meta,
  badges,
  actions,
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  const main = (
    <>
      {leading && <span className="item-leading">{leading}</span>}
      <span className="item-text">
        <span className="item-title">
          {title}
          {badges && <span className="item-badges">{badges}</span>}
        </span>
        {body && <span className="item-body">{body}</span>}
        {meta && <span className="item-meta">{meta}</span>}
      </span>
    </>
  );
  return (
    <li className="admin-item">
      {href ? (
        <Link href={href} className="item-main">
          {main}
        </Link>
      ) : (
        <div className="item-main">{main}</div>
      )}
      {actions && <div className="item-actions">{actions}</div>}
    </li>
  );
}

export const MODERATION_PRESETS = ["Spam", "Harassment or bullying", "Hate speech", "Nudity or sexual content", "Violence", "Misinformation", "Other policy violation"];
