"use client";
import { useCallback, useEffect, useRef, type ReactNode, type HTMLAttributes } from "react";
import Link from "next/link";
import { ArrowRight, AlertCircle, Compass, X, Loader2, AlertTriangle, BadgeCheck } from "lucide-react";
import type { Models } from "@/lib/api/client";
import { ApiError } from "@/lib/api/client";

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
/** Blue verification badge shown next to a verified account's name. */
export function VerifiedBadge({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`verified-badge ${className}`} role="img" aria-label="Verified account" title="Verified account">
      <BadgeCheck size={size} fill="#1d9bf0" stroke="#fff" strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-illustration" aria-hidden="true">
        <span className="empty-illustration-dot d1" />
        <span className="empty-illustration-dot d2" />
        <span className="empty-illustration-dot d3" />
        <span className="empty-icon">
          {icon ?? <Compass size={30} />}
        </span>
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
  const missingUser = error instanceof ApiError && error.code === "USER_NOT_FOUND";
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={24} />
      <h3>{missingUser ? "Kullanıcı bulunamadı" : "Something didn’t load"}</h3>
      <p>{missingUser ? "Bu profil kullanılamıyor." : error?.message ?? "Please try again."}</p>
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
  closeOnBackdrop = true,
  modal = true,
  headerActions,
  dialogProps,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  /** Return false to keep the dialog open (e.g. to ask about unsaved changes first). */
  guardClose?: () => boolean;
  closeOnBackdrop?: boolean;
  /** Keep the same media elements mounted while a call switches to a non-modal window. */
  modal?: boolean;
  headerActions?: ReactNode;
  dialogProps?: Pick<HTMLAttributes<HTMLDialogElement>,'style'|'onPointerDown'|'onPointerMove'|'onPointerUp'|'onPointerCancel'>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const dialog = ref.current;
    if(modal)dialog?.showModal();else dialog?.show();
    const viewport=window.visualViewport;
    const resize=()=>dialog?.style.setProperty('--dialog-height',`${viewport?.height??window.innerHeight}px`);
    resize();viewport?.addEventListener('resize',resize);
    // showModal() focuses the first focusable (the close button); prefer a marked field.
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => { viewport?.removeEventListener('resize',resize);window.clearTimeout(closeTimer.current); dialog?.close(); };
  }, [modal]);
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
      {...dialogProps}
      ref={ref}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === ref.current) requestClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        {headerActions}
        <button type="button" aria-label="Close dialog" className="icon-button" onClick={requestClose}>
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
  className = "",
}: {
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  pending?: boolean;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  className?: string;
}) {
  return (
    <Modal title={title} onClose={onClose} className={`confirm-dialog ${className}`}>
      <div className="confirm-body">
        {tone === "danger" && (
          <span className="confirm-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
        )}
        <div>{description}</div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button type="button" className={`button ${tone === "danger" ? "danger" : ""}`} disabled={pending} onClick={onConfirm}>
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
  const sentinel = useRef<HTMLDivElement>(null);
  const load = useRef(onClick);
  const busy = useRef(false);
  useEffect(() => { load.current = onClick; }, [onClick]);
  useEffect(() => { busy.current = pending; }, [pending]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || pending || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !busy.current) {
        busy.current = true;
        load.current();
      }
    }, { rootMargin: '180px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, pending]);
  return hasMore ? (
    <div ref={sentinel} className="auto-load-more" role="status" aria-live="polite">
    <button
      className="button secondary load-more"
      onClick={onClick}
      disabled={pending}
    >
      {pending ? <Loader2 size={17} className="spin" /> : null}
      {pending ? "Loading…" : "Load more"}
    </button>
    </div>
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
  const menuRef = useRef<HTMLDivElement>(null);
  const positionMenu = useCallback(() => {
    const details=ref.current,menu=menuRef.current;
    if(!details||!menu)return;
    if(!details.open){if(menu.hidePopover&&menu.matches(":popover-open"))menu.hidePopover();return;}
    if(menu.showPopover&&!menu.matches(":popover-open"))menu.showPopover();
    const anchor=details.querySelector("summary")!.getBoundingClientRect();
    const viewport=window.visualViewport;
    const width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
    const offsetX=viewport?.offsetLeft??0,offsetY=viewport?.offsetTop??0;
    const menuWidth=Math.min(260,width-16);
    Object.assign(menu.style,{position:"fixed",inset:"auto",margin:"0",width:`${menuWidth}px`,maxWidth:"calc(100vw - 16px)",maxHeight:`${height-16}px`,overflowY:"auto"});
    const menuHeight=menu.getBoundingClientRect().height;
    const left=Math.max(offsetX+8,Math.min(align==="end"?anchor.right-menuWidth:anchor.left,offsetX+width-menuWidth-8));
    const top=Math.max(offsetY+8,Math.min(anchor.bottom+6+menuHeight<=offsetY+height-8?anchor.bottom+6:anchor.top-menuHeight-6,offsetY+height-menuHeight-8));
    menu.style.left=`${left}px`;menu.style.top=`${top}px`;
  },[align]);
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
    const reposition=(event:Event)=>{if(!menuRef.current?.contains(event.target as Node))positionMenu();};
    window.addEventListener("resize",positionMenu);
    window.visualViewport?.addEventListener("resize",positionMenu);
    document.addEventListener("scroll",reposition,true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize",positionMenu);
      window.visualViewport?.removeEventListener("resize",positionMenu);
      document.removeEventListener("scroll",reposition,true);
    };
  }, [positionMenu]);
  return (
    <details ref={ref} className={`dropdown ${className}`} onToggle={positionMenu}>
      <summary aria-label={label} className={summaryClassName}>
        {summary}
      </summary>
      <div
        ref={menuRef}
        popover="manual"
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
