"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, ExternalLink, Film, Flag, Heart, ImageIcon, MessageCircle, MoreHorizontal, RotateCcw, Trash2, UserRound } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { bytes, compact, dateTime, duration, fmt, humanize, useAdminMe, useCan, useUrlFilters } from "@/lib/admin";
import { useToast } from "@/components/providers";
import { Avatar, Dropdown } from "@/components/ui";
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
  MODERATION_PRESETS,
  Pagination,
  Panel,
  SearchBox,
  Select,
  Tabs,
  TimeCell,
  UserCell,
  useSensitive,
} from "./kit";
import { ReportsTable } from "./reports";

type PostRow = Models["AdminPostRowDto"];
type ReelRow = Models["AdminReelRowDto"];
type CommentRow = Models["AdminCommentRowDto"];
type Status = Models["ContentModerationStatus"];
const PAGE_SIZE = 20;
export type ContentPage = { items: (PostRow | ReelRow | CommentRow)[]; page: number; pageSize: number; total: number };

export function PostCell({ post }: { post: Pick<PostRow, "contentPreview" | "thumbnailUrl" | "media" | "kind"> }) {
  return (
    <span className="post-cell">
      <PostThumb post={post} />
      <span className="cell-stack">
        <strong className="clamp-1">{post.contentPreview || <span className="muted">No text</span>}</strong>
        <span>{mediaLabel(post)}</span>
      </span>
    </span>
  );
}
function PostThumb({ post }: { post: Pick<PostRow, "thumbnailUrl" | "media"> }) {
  return (
    <span className="post-thumb" aria-hidden="true">
      {post.thumbnailUrl ? (
        <img src={post.thumbnailUrl} alt="" loading="lazy" />
      ) : post.media.videos ? (
        <Film size={16} />
      ) : post.media.images ? (
        <ImageIcon size={16} />
      ) : (
        <span>Aa</span>
      )}
      {post.media.videos > 0 && <span className="thumb-flag">▶</span>}
    </span>
  );
}
function mediaLabel(post: Pick<PostRow, "media" | "kind">) {
  const parts = [];
  if (post.kind !== "POST") parts.push(humanize(post.kind));
  if (post.media.images) parts.push(`${post.media.images} image${post.media.images > 1 ? "s" : ""}`);
  if (post.media.videos) parts.push("Video");
  if (!post.media.images && !post.media.videos) parts.push("Text");
  return parts.join(" · ");
}

function StatusBadge({ status, deletedAt }: { status: Status; deletedAt?: string | null }) {
  if (deletedAt) return <Badge value="ARCHIVED" label="Deleted by author" />;
  return status === "ACTIVE" ? null : <Badge value={status} />;
}
function ReportChip({ open }: { open: number }) {
  return open ? (
    <span className="report-chip">
      <Flag size={11} aria-hidden="true" /> {open} open report{open > 1 ? "s" : ""}
    </span>
  ) : null;
}

/* ============================ Moderation actions ============================ */

const LABELS: Record<Status, string> = { ACTIVE: "Restore", HIDDEN: "Hide", REMOVED: "Delete permanently" };
const DESCRIPTIONS: Record<Status, string> = {
  HIDDEN: "Hidden content disappears from every feed and page but can be restored at any time.",
  REMOVED: "Permanently deletes this content and its unused media files from storage. It cannot be restored. Open reports are closed.",
  ACTIVE: "Restoring makes the content visible again wherever its visibility allows.",
};

/**
 * Hide / remove / restore with a reasoned confirmation. `compact` renders one primary button plus a
 * “more” menu, for list rows; otherwise all applicable buttons are shown (detail pages).
 */
export function ModerationControls({
  kind,
  id,
  status,
  openReports,
  allowed,
  compact: small = false,
  detailHref,
  authorId,
}: {
  kind: "post" | "comment";
  id: string;
  status: Status;
  openReports: number;
  allowed: boolean;
  compact?: boolean;
  detailHref?: string;
  authorId?: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const [target, setTarget] = useState<Status | null>(null);
  const [resolve, setResolve] = useState(true);
  const dialog = target && (
    <ActionDialog
      title={`${LABELS[target]} ${kind}`}
      description={DESCRIPTIONS[target]}
      confirmLabel={LABELS[target]}
      tone={target === "REMOVED" ? "danger" : "primary"}
      presets={target === "ACTIVE" ? ["Reviewed – no violation", "Appeal accepted", "Removed by mistake"] : MODERATION_PRESETS}
      extra={
        target === "HIDDEN" && openReports > 0 ? (
          <label className="check-row">
            <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
            Also resolve {openReports} open report{openReports > 1 ? "s" : ""}
          </label>
        ) : undefined
      }
      onClose={() => setTarget(null)}
      onSubmit={async (reason) => {
        const body = { status: target, reason, resolveReports: target !== "ACTIVE" && openReports > 0 && resolve };
        const res = target === "REMOVED"
          ? await sensitive((headers) => kind === "post"
            ? api("adminContentDeletePost", { params: { id }, body: { reason }, headers })
            : api("adminContentDeleteComment", { params: { id }, body: { reason }, headers }))
          : kind === "post"
            ? await api("adminContentModeratePost", { params: { id }, body })
            : await api("adminContentModerateComment", { params: { id }, body });
        toast(
          `${humanize(kind)} ${target === "ACTIVE" ? "restored" : target === "HIDDEN" ? "hidden" : "permanently deleted"}${res.resolvedReports ? ` · ${res.resolvedReports} report(s) resolved` : ""}.`,
        );
        await client.invalidateQueries();
      }}
    />
  );

  if (small)
    return (
      <>
        {allowed &&
          (status === "ACTIVE" ? (
            <button className="button secondary xs" onClick={() => setTarget("HIDDEN")}>
              <EyeOff size={14} /> Hide
            </button>
          ) : (
            <button className="button secondary xs" onClick={() => setTarget("ACTIVE")}>
              <RotateCcw size={14} /> Restore
            </button>
          ))}
        <Dropdown label="More actions" summaryClassName="icon-button small" summary={<MoreHorizontal size={17} />}>
          {detailHref && (
            <Link href={detailHref}>
              <ExternalLink size={16} /> Open details
            </Link>
          )}
          {authorId && (
            <Link href={`/admin/users/${authorId}`}>
              <UserRound size={16} /> View author
            </Link>
          )}
          {allowed && (
            <button type="button" className="danger-text" onClick={() => setTarget("REMOVED")}>
              <Trash2 size={16} /> Delete {kind} permanently
            </button>
          )}
        </Dropdown>
        {dialog}
      </>
    );

  if (!allowed) return null;
  return (
    <>
      <div className="quick-actions">
        {status === "ACTIVE" && (
          <button className="button secondary small" onClick={() => setTarget("HIDDEN")}>
            <EyeOff size={15} /> Hide
          </button>
        )}
        {allowed && (
          <button className="button danger small" onClick={() => setTarget("REMOVED")}>
            <Trash2 size={15} /> Delete permanently
          </button>
        )}
        {status !== "ACTIVE" && (
          <button className="button secondary small" onClick={() => setTarget("ACTIVE")}>
            <RotateCcw size={15} /> Restore
          </button>
        )}
      </div>
      {dialog}
    </>
  );
}

export function useCanModeratePost() {
  const can = useCan();
  const me = useAdminMe().data;
  return (post: Pick<PostRow, "media" | "author">) =>
    post.author?.id !== me?.user.id && (post.media.videos > 0 ? can("reels.moderate") : can("posts.moderate"));
}

/* ============================ Content hub ============================ */

type Tab = "posts" | "reels" | "comments";
const VIEWS = [
  { value: "all", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "hidden", label: "Hidden" },
  { value: "removed", label: "Removed" },
];

/** One place for posts, Reels and comments: pick a type, pick a view, act inline. */
export function ContentHub() {
  const f = useUrlFilters<"tab" | "view" | "q" | "sort" | "authorId" | "postId">({ tab: "posts", view: "all", sort: "created" });
  const tab = f.get("tab") as Tab;
  const view = f.get("view");
  const query = compact({
    q: f.get("q"),
    reported: view === "reported" ? "true" : "",
    status: view === "hidden" ? "HIDDEN" : view === "removed" ? "REMOVED" : "",
    authorId: f.get("authorId"),
    postId: tab === "comments" ? f.get("postId") : "",
    sort: f.get("sort"),
    order: "desc",
    page: f.page,
    pageSize: PAGE_SIZE,
  });
  const q = useQuery({
    queryKey: ["admin", "content", tab, query],
    queryFn: ({ signal }): Promise<ContentPage> =>
      tab === "reels"
        ? api("adminContentReels", { query, signal })
        : tab === "comments"
          ? api("adminContentComments", { query, signal })
          : api("adminContentPosts", { query, signal }),
    placeholderData: (prev) => prev,
  });
  const reportedCount = useQuery({
    queryKey: ["admin", "content-reported", tab],
    queryFn: ({ signal }): Promise<ContentPage> => {
      const query = { reported: "true", status: "ACTIVE", pageSize: 1 };
      return tab === "reels"
        ? api("adminContentReels", { query, signal })
        : tab === "comments"
          ? api("adminContentComments", { query, signal })
          : api("adminContentPosts", { query, signal });
    },
  });
  const noun = tab === "reels" ? "Reels" : tab === "comments" ? "comments" : "posts";

  return (
    <AdminPage title="Content" description="Review and moderate everything members share. Hidden and removed items can always be restored.">
      <Tabs
        label="Content type"
        value={tab}
        onChange={(v) => f.set({ tab: v, view: "all", postId: "" })}
        items={[
          { value: "posts", label: "Posts" },
          { value: "reels", label: "Reels" },
          { value: "comments", label: "Comments" },
        ]}
      />
      <div className="admin-subtabs">
        <div className="segmented" role="tablist" aria-label="Show">
          {VIEWS.map((v) => (
            <button key={v.value} type="button" role="tab" aria-selected={view === v.value} className={view === v.value ? "active" : ""} onClick={() => f.set({ view: v.value })}>
              {v.label}
              {v.value === "reported" && !!reportedCount.data?.total && <span className="tab-count">{reportedCount.data.total}</span>}
            </button>
          ))}
        </div>
        <SearchBox value={f.get("q")} onSearch={(v) => f.set({ q: v })} placeholder={`Search ${noun} by text or @author`} />
        <Select label="Sort" value={f.get("sort")} onChange={(v) => f.set({ sort: v })} options={[["created", "Newest"], ["reports", "Most reported"], ["likes", "Most liked"]]} />
        {(f.get("authorId") || f.get("postId")) && (
          <button className="admin-chip selected" onClick={() => f.set({ authorId: "", postId: "" })}>
            {f.get("postId") ? "Comments on one post" : "One author"} ✕
          </button>
        )}
      </div>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            {tab === "comments" ? (
              <CommentItems rows={q.data.items as CommentRow[]} empty={`No ${view === "all" ? "" : view + " "}comments`} />
            ) : (
              <PostItems rows={q.data.items as (PostRow | ReelRow)[]} reels={tab === "reels"} empty={`No ${view === "all" ? "" : view + " "}${noun}`} />
            )}
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(page) => f.set({ page })} />
          </>
        )}
      </Panel>
    </AdminPage>
  );
}

export function PostItems({ rows, reels, empty }: { rows: (PostRow | ReelRow)[]; reels: boolean; empty: string }) {
  const canModerate = useCanModeratePost();
  return (
    <ItemList label={reels ? "Reels" : "Posts"} empty={<AdminEmpty title={empty} />}>
      {rows.map((p) => {
        const video = (p as ReelRow).video;
        return (
          <Item
            key={p.id}
            href={`/admin/posts/${p.id}`}
            leading={<PostThumb post={p} />}
            title={
              <span>
                {p.author?.displayName ?? "Unknown"} <span className="muted">@{p.author?.username}</span>
              </span>
            }
            badges={
              <>
                <StatusBadge status={p.moderationStatus} deletedAt={p.deletedAt} />
                <ReportChip open={p.openReportCount} />
              </>
            }
            body={p.contentPreview || <span className="muted">{mediaLabel(p)}</span>}
            meta={
              <>
                <TimeCell value={p.createdAt} />
                <span>
                  <Heart size={12} aria-hidden="true" /> {fmt(p.likeCount)}
                </span>
                <span>
                  <MessageCircle size={12} aria-hidden="true" /> {fmt(p.commentCount)}
                </span>
                {reels && video ? (
                  <span>
                    {duration(video.durationMs)} · {bytes(video.sizeBytes)}
                  </span>
                ) : (
                  <span>{mediaLabel(p)}</span>
                )}
              </>
            }
            actions={
              !p.deletedAt && (
                <ModerationControls
                  compact
                  kind="post"
                  id={p.id}
                  status={p.moderationStatus}
                  openReports={p.openReportCount}
                  allowed={canModerate(p)}
                  detailHref={`/admin/posts/${p.id}`}
                  authorId={p.author?.id}
                />
              )
            }
          />
        );
      })}
    </ItemList>
  );
}

export function CommentItems({ rows, empty }: { rows: CommentRow[]; empty: string }) {
  const can = useCan();
  const me = useAdminMe().data;
  return (
    <ItemList label="Comments" empty={<AdminEmpty title={empty} />}>
      {rows.map((c) => (
        <Item
          key={c.id}
          href={`/admin/comments/${c.id}`}
          leading={<Avatar user={c.author} size={36} />}
          title={
            <span>
              {c.author?.displayName ?? "Unknown"} <span className="muted">@{c.author?.username}</span>
            </span>
          }
          badges={
            <>
              <StatusBadge status={c.moderationStatus} deletedAt={c.deletedAt} />
              <ReportChip open={c.openReportCount} />
            </>
          }
          body={c.content}
          meta={
            <>
              <TimeCell value={c.createdAt} />
              <span>{c.parentId ? "Reply" : "Comment"} on “{(c.postPreview ?? "a post").slice(0, 48)}”</span>
              <span>
                <Heart size={12} aria-hidden="true" /> {fmt(c.likeCount)}
              </span>
              {c.replyCount > 0 && <span>{fmt(c.replyCount)} replies</span>}
            </>
          }
          actions={
            !c.deletedAt && (
              <ModerationControls
                compact
                kind="comment"
                id={c.id}
                status={c.moderationStatus}
                openReports={c.openReportCount}
                allowed={can("comments.moderate") && c.author?.id !== me?.user.id}
                detailHref={`/admin/comments/${c.id}`}
                authorId={c.author?.id}
              />
            )
          }
        />
      ))}
    </ItemList>
  );
}

/* ============================ Detail pages ============================ */

export function PostBody({ detail }: { detail: Models["AdminPostDetailDto"] }) {
  return (
    <div className="admin-post-body">
      {detail.content ? <p className="admin-post-text">{detail.content}</p> : <p className="muted">No text.</p>}
      {detail.media.length > 0 && (
        <div className="admin-media-grid">
          {detail.media.map((m) =>
            m.type === "VIDEO" ? (
              <video key={m.id} src={m.url} controls preload="metadata" playsInline />
            ) : (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                <img src={m.url} alt="Attached image" loading="lazy" />
              </a>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const canModerate = useCanModeratePost();
  const can = useCan();
  const q = useQuery({ queryKey: ["admin", "post", id], queryFn: ({ signal }) => api("adminContentPost", { params: { id }, signal }) });
  if (q.isPending) return <AdminLoading label="Loading post" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const p = d.post;
  const isReel = p.media.videos > 0;
  return (
    <AdminPage
      title={isReel ? "Reel" : humanize(p.kind)}
      description={
        <>
          Posted {dateTime(p.createdAt)}
          {d.editedAt ? ` · edited ${dateTime(d.editedAt)}` : ""}
          {" · "}
          {p.moderationStatus === "ACTIVE" && !p.deletedAt ? (
            <Link href={`/post/${p.id}`} className="inline-link">
              Open on Circle <ExternalLink size={12} aria-hidden="true" />
            </Link>
          ) : (
            "Not visible to members"
          )}
        </>
      }
      actions={!p.deletedAt && <ModerationControls kind="post" id={p.id} status={p.moderationStatus} openReports={p.openReportCount} allowed={canModerate(p)} />}
    >
      <div className="admin-grid-main">
        <Panel title="Content">
          <div className="admin-author-row">
            <UserCell user={p.author} />
            <StatusBadge status={p.moderationStatus} deletedAt={p.deletedAt} />
          </div>
          <PostBody detail={d} />
          {d.referencedPostId && (
            <p className="admin-muted-line">
              {humanize(p.kind)} of <Link href={`/admin/posts/${d.referencedPostId}`}>another post</Link>
            </p>
          )}
        </Panel>
        <div className="admin-stack">
          <Panel title="Details">
            <KeyValues
              items={[
                ["Status", p.deletedAt ? "Deleted by author" : humanize(p.moderationStatus)],
                ["Visibility", humanize(p.visibility)],
                ["Likes", fmt(p.likeCount)],
                ["Comments", <Link key="c" href={`/admin/content?tab=comments&postId=${p.id}`}>{fmt(p.commentCount)}</Link>],
                ["Reposts · quotes", `${fmt(p.repostCount)} · ${fmt(p.quoteCount)}`],
                ["Bookmarks", fmt(d.bookmarkCount)],
                ["Reports", `${fmt(p.reportCount)} (${fmt(p.openReportCount)} open)`],
              ]}
            />
          </Panel>
          <Panel title="Moderation history">
            <History items={d.history} />
          </Panel>
        </div>
      </div>
      {can("reports.read") && d.reports.length > 0 && (
        <Panel title="Reports" flush>
          <ReportsTable rows={d.reports} />
        </Panel>
      )}
    </AdminPage>
  );
}

function CommentsTable({ rows, empty = "No comments" }: { rows: CommentRow[]; empty?: string }) {
  return (
    <DataTable
      caption="Comments"
      rows={rows}
      onRowHref={(c) => `/admin/comments/${c.id}`}
      empty={<AdminEmpty title={empty} />}
      columns={[
        { key: "comment", header: "Reply", cell: (c) => <strong className="clamp-2">{c.content}</strong> },
        { key: "author", header: "Author", cell: (c) => <UserCell user={c.author} /> },
        { key: "at", header: "Posted", cell: (c) => <TimeCell value={c.createdAt} /> },
      ]}
    />
  );
}

export function CommentDetail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const me = useAdminMe().data;
  const q = useQuery({ queryKey: ["admin", "comment", id], queryFn: ({ signal }) => api("adminContentComment", { params: { id }, signal }) });
  if (q.isPending) return <AdminLoading label="Loading comment" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const c = d.comment;
  return (
    <AdminPage
      title="Comment"
      description={`Posted ${dateTime(c.createdAt)}`}
      actions={
        !c.deletedAt && (
          <ModerationControls
            kind="comment"
            id={c.id}
            status={c.moderationStatus}
            openReports={c.openReportCount}
            allowed={can("comments.moderate") && c.author?.id !== me?.user.id}
          />
        )
      }
    >
      <div className="admin-grid-main">
        <div className="admin-stack">
          <Panel title="Thread">
            <ol className="admin-thread">
              <li className="thread-post">
                <Link href={`/admin/posts/${d.post.id}`}>
                  <PostCell post={d.post} />
                </Link>
              </li>
              {d.thread.map((t) => (
                <li key={t.id}>
                  <UserCell user={t.author} sub={<TimeCell value={t.createdAt} />} />
                  <p>{t.content}</p>
                </li>
              ))}
              <li className="thread-focus">
                <div className="admin-author-row">
                  <UserCell user={c.author} sub={<TimeCell value={c.createdAt} />} />
                  <StatusBadge status={c.moderationStatus} deletedAt={c.deletedAt} />
                </div>
                <p>{c.content}</p>
              </li>
            </ol>
          </Panel>
          {d.replies.length > 0 && (
            <Panel title={`Replies (${fmt(c.replyCount)})`} flush>
              <CommentsTable rows={d.replies} />
            </Panel>
          )}
        </div>
        <div className="admin-stack">
          <Panel title="Details">
            <KeyValues
              items={[
                ["Status", c.deletedAt ? "Deleted by author" : humanize(c.moderationStatus)],
                ["Likes", fmt(c.likeCount)],
                ["Depth", c.depth + 1],
                ["Reports", `${fmt(c.reportCount)} (${fmt(c.openReportCount)} open)`],
              ]}
            />
          </Panel>
          <Panel title="Moderation history">
            <History items={d.history} />
          </Panel>
        </div>
      </div>
      {can("reports.read") && d.reports.length > 0 && (
        <Panel title="Reports" flush>
          <ReportsTable rows={d.reports} />
        </Panel>
      )}
    </AdminPage>
  );
}
