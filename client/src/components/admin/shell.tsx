"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Clapperboard,
  FileText,
  Flag,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  Megaphone,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import { humanize, useAdminMe, type Permission } from "@/lib/admin";
import { useSession } from "@/components/providers";
import { Avatar } from "@/components/ui";
import { AdminLoading, RoleBadge, StepUpProvider } from "./kit";

type NavItem = { href: string; label: string; icon: typeof Users; permission: Permission; badge?: "reports" };
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: Gauge, permission: "users.read" },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.read" },
    ],
  },
  {
    group: "Moderation",
    items: [
      { href: "/admin/reports", label: "Reports", icon: Flag, permission: "reports.read", badge: "reports" },
      { href: "/admin/content", label: "Content", icon: FileText, permission: "posts.read" },
    ],
  },
  {
    group: "People",
    items: [
      { href: "/admin/users", label: "Users", icon: Users, permission: "users.read" },
      { href: "/admin/roles", label: "Team & roles", icon: KeyRound, permission: "users.roles.manage" },
    ],
  },
  {
    group: "Platform",
    items: [
      { href: "/admin/notifications", label: "Announcements", icon: Megaphone, permission: "notifications.broadcast" },
      { href: "/admin/media", label: "Media", icon: ImageIcon, permission: "media.manage" },
      { href: "/admin/fiktok", label: "Fiktok Importer", icon: Clapperboard, permission: "media.manage" },
      { href: "/admin/settings", label: "Settings", icon: Settings2, permission: "settings.read" },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/admin/audit-logs", label: "Audit log", icon: ScrollText, permission: "audit.read" },
      { href: "/admin/system", label: "System status", icon: Activity, permission: "system.read" },
    ],
  },
];
const LABELS: Record<string, string> = {
  admin: "Admin",
  "audit-logs": "Audit log",
  notifications: "Announcements",
  roles: "Team & roles",
  posts: "Content",
  comments: "Content",
  system: "System status",
  fiktok: "Fiktok Importer",
};

export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const me = useAdminMe(!!user);
  if (loading || (user && me.isPending)) return <AdminLoading label="Opening admin" />;
  if (!user)
    return (
      <Gate title="Sign in required" body="Sign in with a staff account to open the admin control center." action={<Link className="button" href="/login">Sign in</Link>} />
    );
  if (me.error)
    return me.error instanceof ApiError && me.error.status === 403 ? (
      <Gate title="Not authorized" body="Your account doesn’t have access to the admin control center." action={<Link className="button secondary" href="/">Back to Circle</Link>} />
    ) : (
      <Gate title="Couldn’t open admin" body={me.error.message} action={<button className="button secondary" onClick={() => void me.refetch()}>Retry</button>} />
    );
  return (
    <StepUpProvider>
      <Frame>{children}</Frame>
    </StepUpProvider>
  );
}

function Gate({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <main className="admin-gate">
      <div>
        <ShieldCheck size={30} aria-hidden="true" />
        <h1>{title}</h1>
        <p>{body}</p>
        {action}
      </div>
    </main>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useAdminMe().data!;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }
  const canReports = me.permissions.includes("reports.read");
  const pending = useQuery({
    queryKey: ["admin", "pending-reports"],
    queryFn: ({ signal }) => api("adminReportsList", { query: { status: "PENDING", pageSize: 1 }, signal }),
    enabled: canReports,
    refetchInterval: 60_000,
  });
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => me.permissions.includes(i.permission)) })).filter(
    (g) => g.items.length,
  );
  const isActive = (href: string) =>
    href === "/admin"
      ? pathname === "/admin"
      : pathname.startsWith(href) || (href === "/admin/content" && /^\/admin\/(posts|comments)\//.test(pathname));
  const crumbs = pathname
    .split("/")
    .filter(Boolean)
    .map((seg, i, all) => ({
      href: ["posts", "comments"].includes(seg) ? `/admin/content?tab=${seg}` : "/" + all.slice(0, i + 1).join("/"),
      label: /^[0-9a-f-]{36}$/.test(seg) ? "Details" : (LABELS[seg] ?? humanize(seg)),
    }));

  return (
    <div className={`admin-root ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <a href="#admin-main" className="skip-link">
        Skip to content
      </a>
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-brand">
          <Link href="/admin" className="admin-brand-link">
            <Image src="/circle-logo.png" alt="" width={706} height={728} className="admin-logo" />
            <span>
              Circle <em>Admin</em>
            </span>
          </Link>
          <button className="icon-button admin-only-narrow" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <nav>
          {groups.map((g) => (
            <div key={g.group} className="admin-nav-group">
              <p>{g.group}</p>
              <ul>
                {g.items.map(({ href, label, icon: Icon, badge }) => {
                  const active = isActive(href);
                  const count = badge === "reports" ? pending.data?.total : undefined;
                  return (
                    <li key={href}>
                      <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}>
                        <Icon size={18} aria-hidden="true" />
                        <span className="label">{label}</span>
                        {!!count && (
                          <span className="admin-nav-count" aria-label={`${count} pending`}>
                            {count > 99 ? "99+" : count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <Link href="/" className="admin-back">
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="label">Back to Circle</span>
        </Link>
      </aside>
      <button className="admin-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setMobileOpen(false)} />
      <div className="admin-main-col">
        <header className="admin-topbar">
          <button className="icon-button admin-only-narrow" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <button
            className="icon-button admin-only-wide"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
          <nav aria-label="Breadcrumb" className="admin-crumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={c.href}>
                  {i === crumbs.length - 1 ? <span aria-current="page">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
                </li>
              ))}
            </ol>
          </nav>
          <div className="admin-me">
            <RoleBadge role={me.role} />
            <Avatar user={me.user} size={32} />
            <span className="admin-me-name">{me.user.displayName}</span>
          </div>
        </header>
        <main id="admin-main" className="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}
