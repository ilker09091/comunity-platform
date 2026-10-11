"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, ArrowRight, Info, Eye, Flag, FileText, UserX } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { dateOnly, fmt, humanize, rangeFor, useCan, useUrlFilters } from "@/lib/admin";
import { TrendChart } from "./charts";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  Badge,
  DataTable,
  History,
  Item,
  ItemList,
  Panel,
  RoleBadge,
  Select,
  StatCard,
  TimeCell,
  Toolbar,
  UserCell,
} from "./kit";
import { PostCell } from "./content";
import { ReportsTable } from "./reports";
import { Avatar } from "@/components/ui";

const RANGES: [string, string][] = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["365d", "Last 12 months"],
];

function Alerts({ alerts }: { alerts: Models["AlertDto"][] }) {
  if (!alerts.length) return null;
  const Icon = { info: Info, warning: AlertTriangle, critical: AlertOctagon };
  return (
    <ul className="admin-alerts" aria-label="Alerts">
      {alerts.map((a, i) => {
        const I = Icon[a.level];
        const body = (
          <>
            <I size={18} aria-hidden="true" />
            <div>
              <strong>
                <span className="sr-only">{a.level}: </span>
                {a.title}
              </strong>
              {a.detail && <p>{a.detail}</p>}
            </div>
            {a.href && <ArrowRight size={16} aria-hidden="true" className="alert-go" />}
          </>
        );
        return (
          <li key={i} className={`admin-alert level-${a.level}`}>
            {a.href ? <Link href={a.href}>{body}</Link> : <div>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function Dashboard() {
  const can = useCan();
  const filters = useUrlFilters<"range">({ range: "30d" });
  const range = rangeFor(filters.get("range"));
  const q = useQuery({ queryKey: ["admin", "dashboard"], queryFn: ({ signal }) => api("adminCoreDashboard", { signal }), refetchInterval: 60_000 });
  const reported = useQuery({
    queryKey: ["admin", "content-reported", "posts"],
    queryFn: ({ signal }) => api("adminContentPosts", { query: { reported: "true", status: "ACTIVE", pageSize: 1 }, signal }),
    enabled: can("posts.read"),
  });
  const trends = useQuery({
    queryKey: ["admin", "dashboard-trends", range.from, range.to],
    queryFn: ({ signal }) =>
      api("adminAnalyticsTimeseries", { query: { metrics: "registrations,posts,reports_created", from: range.from, to: range.to, interval: range.interval }, signal }),
    enabled: can("analytics.read"),
  });
  if (q.isPending) return <AdminLoading label="Loading dashboard" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const o = d.overview;
  const restricted = o.suspendedAccounts + o.bannedAccounts;
  const todo = [
    can("reports.read") && { href: "/admin/reports", icon: Flag, label: "Reports to review", value: o.pendingReports, tone: o.pendingReports ? "warning" : "ok" },
    can("posts.read") && { href: "/admin/content?tab=posts&view=reported", icon: FileText, label: "Reported posts still visible", value: reported.data?.total ?? 0, tone: reported.data?.total ? "warning" : "ok" },
    { href: "/admin/users?tab=suspended", icon: UserX, label: "Restricted accounts", value: restricted, tone: "neutral" },
  ].filter(Boolean) as { href: string; icon: typeof Flag; label: string; value: number; tone: string }[];

  return (
    <AdminPage title="Dashboard" description={`Everything at a glance · updated ${new Date(o.generatedAt).toLocaleTimeString("en", { timeStyle: "short" })}`}>
      <Alerts alerts={d.alerts} />

      <section aria-label="Needs attention" className="todo-grid">
        {todo.map((t) => (
          <Link key={t.label} href={t.href} className={`todo-card tone-${t.tone}`}>
            <t.icon size={20} aria-hidden="true" />
            <span>
              <strong>{fmt(t.value)}</strong>
              {t.label}
            </span>
            <ArrowRight size={16} aria-hidden="true" className="todo-go" />
          </Link>
        ))}
      </section>

      <div className="admin-stats">
        <StatCard label="Members" value={o.totalUsers} hint={`+${fmt(o.newUsersToday)} today · +${fmt(o.newUsers7d)} this week`} href="/admin/users" />
        <StatCard label="Active today" value={o.activeUsers24h} hint={o.activeUsers24h === null ? "Collecting data…" : `${fmt(o.activeUsers7d)} this week`} />
        <StatCard label="Posts" value={o.totalPosts} hint={`${fmt(o.postsToday)} today`} href={can("posts.read") ? "/admin/content?tab=posts" : undefined} />
        <StatCard label="Reels" value={o.totalReels} href={can("posts.read") ? "/admin/content?tab=reels" : undefined} />
        <StatCard label="Comments" value={o.totalComments} href={can("posts.read") ? "/admin/content?tab=comments" : undefined} />
        <StatCard label="Likes" value={o.totalLikes} hint={`${fmt(o.totalReposts)} reposts · ${fmt(o.totalBookmarks)} saves`} />
      </div>

      {can("analytics.read") && (
        <Panel title="Trends" action={<Select label="Date range" value={filters.get("range")} onChange={(v) => filters.set({ range: v })} options={RANGES} />}>
          {trends.isPending ? (
            <AdminLoading label="Loading trends" />
          ) : trends.error ? (
            <AdminError error={trends.error} retry={() => void trends.refetch()} />
          ) : (
            <div className="trend-grid">
              {trends.data.series.map((s) => (
                <TrendChart key={s.metric} title={METRIC_LABELS[s.metric]} points={s.points} total={s.total} interval={trends.data.interval} />
              ))}
            </div>
          )}
        </Panel>
      )}

      <div className="admin-grid-2">
        {can("reports.read") && (
          <Panel title="Next reports to review" action={<Link href="/admin/reports" className="panel-link">Open queue</Link>} flush>
            <ReportsTable rows={d.recentReports.slice(0, 5)} empty="All caught up" />
          </Panel>
        )}
        <Panel title="New members" action={<Link href="/admin/users" className="panel-link">All users</Link>} flush>
          <ItemList label="New members" empty={<AdminEmpty title="No members yet" />}>
            {d.recentUsers.slice(0, 5).map((u) => (
              <Item
                key={u.id}
                href={`/admin/users/${u.id}`}
                leading={<Avatar user={u} size={36} />}
                title={
                  <span>
                    {u.displayName} <span className="muted">@{u.username}</span>
                  </span>
                }
                badges={u.role !== "USER" ? <RoleBadge role={u.role} /> : undefined}
                meta={
                  <span>
                    Joined <TimeCell value={u.createdAt} />
                  </span>
                }
              />
            ))}
          </ItemList>
        </Panel>
      </div>
      {can("audit.read") && d.recentActions.length > 0 && (
        <Panel title="Latest admin actions" action={<Link href="/admin/audit-logs" className="panel-link">Full audit log</Link>}>
          <History items={d.recentActions.slice(0, 5)} />
        </Panel>
      )}
    </AdminPage>
  );
}

export const METRIC_LABELS: Record<Models["TimeSeriesDto"]["metric"], string> = {
  registrations: "New registrations",
  active_users: "Active users",
  posts: "Posts created",
  reels: "Reels created",
  comments: "Comments",
  likes: "Likes",
  reposts: "Reposts",
  bookmarks: "Bookmarks",
  reports_created: "Reports received",
  reports_resolved: "Reports closed",
};
const ALL_METRICS = Object.keys(METRIC_LABELS).join(",");

export function Analytics() {
  const filters = useUrlFilters<"range" | "interval" | "by" | "kind">({ range: "30d", by: "engagement", kind: "posts" });
  const preset = rangeFor(filters.get("range"));
  const interval = (filters.get("interval") || preset.interval) as "day" | "week" | "month";
  const series = useQuery({
    queryKey: ["admin", "analytics", preset.from, preset.to, interval],
    queryFn: ({ signal }) =>
      api("adminAnalyticsTimeseries", { query: { metrics: ALL_METRICS, from: preset.from, to: preset.to, interval }, signal }),
  });
  const by = filters.get("by") as "engagement" | "likes" | "comments" | "reposts";
  const kind = filters.get("kind") as "posts" | "reels";
  const top = useQuery({
    queryKey: ["admin", "top", preset.from, preset.to, by, kind],
    queryFn: ({ signal }) => api("adminAnalyticsTop", { query: { from: preset.from, to: preset.to, by, kind, limit: 10 }, signal }),
  });

  return (
    <AdminPage title="Analytics" description="Real aggregates from platform data, bucketed in UTC.">
      <Toolbar>
        <Select label="Date range" value={filters.get("range")} onChange={(v) => filters.set({ range: v, interval: "" })} options={RANGES} />
        <Select
          label="Interval"
          value={interval}
          onChange={(v) => filters.set({ interval: v })}
          options={[
            ["day", "Daily"],
            ["week", "Weekly"],
            ["month", "Monthly"],
          ]}
        />
      </Toolbar>
      {series.isPending ? (
        <AdminLoading label="Loading analytics" />
      ) : series.error ? (
        <AdminError error={series.error} retry={() => void series.refetch()} />
      ) : (
        <div className="trend-grid wide">
          {series.data.series.map((s) => (
            <Panel key={s.metric} className="trend-panel">
              <TrendChart
                title={METRIC_LABELS[s.metric]}
                points={s.points}
                total={s.total}
                interval={series.data.interval}
                note={s.note}
                totalLabel={s.metric === "active_users" ? "distinct users" : "in range"}
              />
            </Panel>
          ))}
        </div>
      )}
      <Panel
        title="Top content"
        action={
          <div className="panel-filters">
            <Select label="Content type" value={kind} onChange={(v) => filters.set({ kind: v })} options={[["posts", "Posts"], ["reels", "Reels"]]} />
            <Select
              label="Rank by"
              value={by}
              onChange={(v) => filters.set({ by: v })}
              options={[
                ["engagement", "Engagement"],
                ["likes", "Likes"],
                ["comments", "Comments"],
                ["reposts", "Reposts & quotes"],
              ]}
            />
          </div>
        }
        flush
      >
        {top.isPending ? (
          <AdminLoading />
        ) : top.error ? (
          <AdminError error={top.error} />
        ) : (
          <>
            <DataTable
              caption="Top content"
              rows={top.data.items}
              onRowHref={(p) => `/admin/posts/${p.id}`}
              empty={<AdminEmpty title="No engagement in this range" />}
              columns={[
                { key: "post", header: kind === "reels" ? "Reel" : "Post", cell: (p) => <PostCell post={p} /> },
                { key: "author", header: "Author", cell: (p) => <span>@{p.author?.username}</span> },
                { key: "likes", header: "Likes", cell: (p) => fmt(p.likeCount), className: "num" },
                { key: "comments", header: "Comments", cell: (p) => fmt(p.commentCount), className: "num" },
                { key: "reposts", header: "Reposts", cell: (p) => fmt(p.repostCount + p.quoteCount), className: "num" },
                { key: "score", header: "Score", cell: (p) => <strong>{fmt(p.score)}</strong>, className: "num" },
              ]}
            />
            <p className="admin-footnote">
              <Eye size={14} aria-hidden="true" /> Engagement score = likes + 2 × comments + 3 × reposts. View counts are not tracked yet, so
              Reel watch metrics are not shown.
            </p>
          </>
        )}
      </Panel>
    </AdminPage>
  );
}
