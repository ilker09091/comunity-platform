"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, AlertCircle, Compass, X, Loader2 } from "lucide-react";
import type { Models } from "@/lib/api/client";

export function Avatar({
  user,
  size = 42,
}: {
  user?: Pick<Models["UserSummaryDto"], "displayName" | "avatarUrl"> | null;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt="" />
      ) : (
        (user?.displayName ?? "C")
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Compass size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={24} />
      <h3>Something didn’t load</h3>
      <p>{error?.message ?? "Please try again."}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function LoadingSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="card skeleton-card" aria-label="Loading" role="status">
      <div className="skeleton-row">
        <span className="skeleton circle" />
        <div>
          <div className="skeleton line short" />
          <div className="skeleton line tiny" />
        </div>
      </div>
      <div className="skeleton line" />
      <div className="skeleton line" />
      {!compact && <div className="skeleton media" />}
      <span className="sr-only">Loading content</span>
    </div>
  );
}
export function SignInPrompt({
  title = "Your community is waiting",
  description = "Sign in to share, connect, and keep the conversation going.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="card">
      <EmptyState
        title={title}
        description={description}
        action={
          <Link href="/login" className="button">
            Sign in <ArrowRight size={16} />
          </Link>
        }
      />
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = "",
  guardClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  /** Return false to keep the dialog open (e.g. to ask about unsaved changes first). */
  guardClose?: () => boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // showModal() focuses the first focusable (the close button); prefer a marked field.
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => { window.clearTimeout(closeTimer.current); dialog?.close(); };
  }, []);
  /** Plays the exit transition before handing control back to the owner. */
  const requestClose = () => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    if (guardClose && !guardClose()) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return onClose();
    closing.current = true;
    dialog.classList.add("closing");
    closeTimer.current = window.setTimeout(() => {
      closing.current = false;
      onClose();
    }, 160);
  };
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) requestClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" className="icon-button" onClick={requestClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  onConfirm,
  onClose,
  pending,
  confirmLabel = "Confirm",
  tone = "danger",
}: {
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  pending?: boolean;
  confirmLabel?: string;
  tone?: "danger" | "primary";
}) {
  return (
    <Modal title={title} onClose={onClose} className="confirm-dialog">
      <div className="confirm-body">{description}</div>
      <div className="dialog-actions">
        <button className="button secondary" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button className={`button ${tone === "danger" ? "danger" : ""}`} disabled={pending} onClick={onConfirm}>
          {pending && <Loader2 className="spin" size={16} />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
export function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
export function LoadMore({
  hasMore,
  pending,
  onClick,
}: {
  hasMore?: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return hasMore ? (
    <button
      className="button secondary load-more"
      onClick={onClick}
      disabled={pending}
    >
      {pending ? <Loader2 size={17} className="spin" /> : null}
      {pending ? "Loading…" : "Load more"}
    </button>
  ) : null;
}

/**
 * Disclosure menu built on <details>: keyboard accessible by default, and additionally
 * closes on outside click, Escape and after choosing an item.
 */
export function Dropdown({
  label,
  summary,
  children,
  className = "",
  align = "end",
  summaryClassName = "",
}: {
  label: string;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  summaryClassName?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const close = (event: Event) => {
      if (!details.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className={`dropdown ${className}`}>
      <summary aria-label={label} className={summaryClassName}>
        {summary}
      </summary>
      <div
        className={`dropdown-menu align-${align}`}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("a,button:not(:disabled)") && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="card page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
