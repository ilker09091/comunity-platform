"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Film, HardDrive, Loader2, Plus, ScanSearch, Trash2 } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { bytes, compact, dateTime, duration, fmt, humanize, REPORT_REASONS, useCan, useUrlFilters } from "@/lib/admin";
import { useToast } from "@/components/providers";
import { ConfirmDialog, Modal } from "@/components/ui";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  Badge,
  DataTable,
  errorText,
  isCancelled,
  Pagination,
  Panel,
  Select,
  Tabs,
  TimeCell,
  Toolbar,
  UserCell,
  useSensitive,
} from "./kit";

/* ============================ Media ============================ */

type MediaRow = Models["AdminMediaRowDto"];
type Health = Models["MediaHealthDto"];

function MediaThumb({ m }: { m: MediaRow }) {
  return (
    <a href={m.url} target="_blank" rel="noreferrer" className="media-thumb" aria-label={`Open ${m.type.toLowerCase()} in a new tab`}>
      {m.type === "IMAGE" ? <img src={m.url} alt="" loading="lazy" /> : <Film size={18} aria-hidden="true" />}
    </a>
  );
}
function UsageCell({ usage }: { usage: Models["MediaUsageDto"] }) {
  if (usage.kind === "POST" && usage.postId)
    return (
      <Link href={`/admin/posts/${usage.postId}`} className="inline-link">
        Post
      </Link>
    );
  return usage.kind === "UNATTACHED" ? <Badge value="PENDING" label="Unattached" /> : <span>{humanize(usage.kind)}</span>;
}

export function MediaLibrary() {
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const f = useUrlFilters<"type" | "usage" | "status" | "sort" | "order">({ sort: "created", order: "desc" });
  const query = compact({ type: f.get("type"), usage: f.get("usage"), status: f.get("status"), sort: f.get("sort"), order: f.get("order"), page: f.page, pageSize: 25 });
  const q = useQuery({ queryKey: ["admin", "media", query], queryFn: ({ signal }) => api("adminMediaList", { query, signal }), placeholderData: (p) => p });
  const [health, setHealth] = useState<Record<string, Health | "checking">>({});
  const [scan, setScan] = useState<{ checked: number; problems: Health[]; next: string | null; done: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<Models["CleanupPreviewDto"] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = async (id: string) => {
    setHealth((h) => ({ ...h, [id]: "checking" }));
    try {
      const res = await api("adminMediaHealth", { params: { id } });
      setHealth((h) => ({ ...h, [id]: res }));
    } catch (e) {
      setHealth((h) => {
        const next = { ...h };
        delete next[id];
        return next;
      });
      toast(errorText(e), true);
    }
  };
  const runScan = async (fresh: boolean) => {
    setScanning(true);
    try {
      const after = fresh ? undefined : (scan?.next ?? undefined);
      const res = await api("adminMediaScan", { query: { limit: 100, afterId: after } });
      setScan((s) => ({
        checked: (fresh ? 0 : (s?.checked ?? 0)) + res.checked,
        problems: [...(fresh ? [] : (s?.problems ?? [])), ...res.problems],
        next: res.nextAfterId ?? null,
        done: !res.nextAfterId,
      }));
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setScanning(false);
    }
  };
  const loadPreview = async () => {
    setBusy(true);
    try {
      const res = await api("adminMediaCleanupPreview");
      setPreview(res);
      setSelected(res.items.map((i) => i.id));
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const cleanup = async () => {
    setBusy(true);
    try {
      const res = await sensitive((headers) => api("adminMediaCleanup", { body: { mediaIds: selected }, headers }));
      toast(`Deleted ${res.deleted} file(s), freed ${bytes(res.freedBytes)}${res.skipped ? ` · ${res.skipped} skipped (now in use or too new)` : ""}.`);
      setConfirm(false);
      setPreview(null);
      await client.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      if (!isCancelled(e)) toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage title="Media library" description="Every uploaded image and video, where it is used, and whether its file is healthy.">
      <div className="admin-grid-2">
        <Panel
          title="Storage check"
          action={
            <button className="button secondary small" disabled={scanning} onClick={() => runScan(true)}>
              {scanning ? <Loader2 size={15} className="spin" /> : <ScanSearch size={15} />} {scan ? "Restart scan" : "Scan storage"}
            </button>
          }
        >
          {!scan ? (
            <p className="admin-muted-line">Compares media records against stored files in batches of 100: missing files, size mismatches and failed processing. Read-only.</p>
          ) : (
            <>
              <p className="admin-muted-line">
                Checked {fmt(scan.checked)} file(s) · {scan.problems.length ? <strong className="text-warn">{scan.problems.length} problem(s)</strong> : "no problems found"}
                {scan.done ? " · complete" : ""}
              </p>
              {!scan.done && (
                <button className="button secondary small" disabled={scanning} onClick={() => runScan(false)}>
                  Continue scan
                </button>
              )}
              {scan.problems.length > 0 && (
                <ul className="scan-problems">
                  {scan.problems.map((p) => (
                    <li key={p.id}>
                      <Badge value={p.state} /> <code>{p.storageKey}</code>
                      <span className="muted">{p.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
        <Panel
          title="Orphaned uploads"
          action={
            <button className="button secondary small" disabled={busy} onClick={loadPreview}>
              <HardDrive size={15} /> {preview ? "Refresh preview" : "Preview cleanup"}
            </button>
          }
        >
          {!preview ? (
            <p className="admin-muted-line">Uploads never attached to a post, avatar or cover. Preview first; nothing is deleted until you review and confirm.</p>
          ) : preview.count === 0 ? (
            <p className="admin-muted-line">
              <CheckCircle2 size={14} aria-hidden="true" /> No orphaned uploads older than {preview.ttlHours} hours.
            </p>
          ) : (
            <>
              <p className="admin-muted-line">
                {fmt(preview.count)} unattached upload(s) older than {preview.ttlHours} h · {bytes(preview.totalBytes)}
                {preview.items.length < preview.count ? ` · showing the first ${preview.items.length}` : ""}
              </p>
              <ul className="cleanup-list">
                {preview.items.map((m) => (
                  <li key={m.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(m.id)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))}
                      />
                      <MediaThumb m={m} />
                      <span className="cell-stack">
                        <strong>
                          {humanize(m.type)} · {bytes(m.sizeBytes)}
                        </strong>
                        <span>
                          @{m.owner?.username} · {dateTime(m.createdAt)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button className="button danger small" disabled={busy || !selected.length} onClick={() => setConfirm(true)}>
                <Trash2 size={15} /> Delete {selected.length} selected
              </button>
            </>
          )}
        </Panel>
      </div>

      <Toolbar>
        <Select label="Type" value={f.get("type")} onChange={(v) => f.set({ type: v })} options={[["", "Images & videos"], ["IMAGE", "Images"], ["VIDEO", "Videos"]]} />
        <Select label="Usage" value={f.get("usage")} onChange={(v) => f.set({ usage: v })} options={[["", "Any usage"], ["POST", "In posts"], ["AVATAR", "Avatars"], ["COVER", "Covers"], ["UNATTACHED", "Unattached"]]} />
        <Select label="Status" value={f.get("status")} onChange={(v) => f.set({ status: v })} options={[["", "Any status"], ["READY", "Ready"], ["PROCESSING", "Processing"], ["FAILED", "Failed"]]} />
        <Select
          label="Sort by"
          value={`${f.get("sort")}:${f.get("order")}`}
          onChange={(v) => {
            const [sort, order] = v.split(":");
            f.set({ sort, order });
          }}
          options={[["created:desc", "Newest first"], ["created:asc", "Oldest first"], ["size:desc", "Largest first"]]}
        />
      </Toolbar>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Media"
              rows={q.data.items}
              empty={<AdminEmpty title="No media matches these filters" />}
              columns={[
                {
                  key: "file",
                  header: "File",
                  cell: (m) => (
                    <span className="post-cell">
                      <MediaThumb m={m} />
                      <span className="cell-stack">
                        <strong>{m.mimeType}</strong>
                        <span>
                          {m.width && m.height ? `${m.width}×${m.height}` : "Dimensions unknown"}
                          {m.type === "VIDEO" ? ` · ${duration(m.durationMs)}` : ""}
                        </span>
                      </span>
                    </span>
                  ),
                },
                { key: "owner", header: "Owner", cell: (m) => <UserCell user={m.owner} /> },
                { key: "usage", header: "Used in", cell: (m) => <UsageCell usage={m.usage} /> },
                { key: "size", header: "Size", cell: (m) => bytes(m.sizeBytes), className: "num" },
                { key: "status", header: "Status", cell: (m) => <Badge value={m.status} /> },
                {
                  key: "health",
                  header: "File check",
                  cell: (m) => {
                    const h = health[m.id];
                    if (h === "checking") return <Loader2 size={15} className="spin" aria-label="Checking" />;
                    if (h) return <Badge value={h.state} label={h.state === "OK" ? "File OK" : humanize(h.state)} />;
                    return (
                      <button className="button ghost xs" onClick={() => check(m.id)}>
                        Check
                      </button>
                    );
                  },
                },
                { key: "at", header: "Uploaded", cell: (m) => <TimeCell value={m.createdAt} /> },
              ]}
            />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(page) => f.set({ page })} />
          </>
        )}
      </Panel>
      {confirm && (
        <ConfirmDialog
          title="Delete orphaned uploads"
          description={`Permanently delete ${selected.length} unattached file(s)? Each one is re-checked first; anything that became attached in the meantime is skipped.`}
          confirmLabel="Delete files"
          pending={busy}
          onConfirm={cleanup}
          onClose={() => setConfirm(false)}
        />
      )}
    </AdminPage>
  );
}

/* ============================ Announcements ============================ */

type Announcement = Models["AnnouncementDto"];

function AnnouncementEditor({ initial, onClose }: { initial: Announcement | null; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [audience, setAudience] = useState<Models["AnnouncementAudience"]>(initial?.audience ?? "ALL");
  const [names, setNames] = useState((initial?.selectedUsernames ?? []).join(", "));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      title: title.trim(),
      body: body.trim(),
      audience,
      ...(audience === "SELECTED"
        ? { recipientUsernames: [...new Set(names.split(/[\s,]+/).map((n) => n.replace(/^@/, "").trim()).filter(Boolean))] }
        : {}),
    };
    try {
      if (initial) await api("adminAnnouncementsUpdate", { params: { id: initial.id }, body: payload });
      else await api("adminAnnouncementsCreate", { body: payload });
      toast(initial ? "Draft updated." : "Draft saved. Publish it when ready.");
      await client.invalidateQueries({ queryKey: ["admin", "announcements"] });
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={initial ? "Edit draft" : "New announcement"} onClose={onClose} guardClose={() => !busy}>
      <form onSubmit={submit}>
        <label className="form-field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required data-autofocus />
        </label>
        <label className="form-field">
          <span>Message</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} required />
          <small>{body.length}/2000 · plain text</small>
        </label>
        <fieldset className="role-picker">
          <legend>Audience</legend>
          <label>
            <input type="radio" name="aud" checked={audience === "ALL"} onChange={() => setAudience("ALL")} /> Everyone with an active account
          </label>
          <label>
            <input type="radio" name="aud" checked={audience === "SELECTED"} onChange={() => setAudience("SELECTED")} /> Selected members
          </label>
        </fieldset>
        {audience === "SELECTED" && (
          <label className="form-field">
            <span>Usernames</span>
            <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={2} placeholder="alex, @sam, jordan" required />
            <small>Separate with commas or spaces. Unknown usernames are rejected.</small>
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
          <button className="button" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" />} Save draft
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Announcements() {
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const f = useUrlFilters<"status">();
  const query = compact({ status: f.get("status"), page: f.page, pageSize: 20 });
  const q = useQuery({ queryKey: ["admin", "announcements", query], queryFn: ({ signal }) => api("adminAnnouncementsList", { query, signal }), placeholderData: (p) => p });
  const [editing, setEditing] = useState<Announcement | null | "new">(null);
  const [confirm, setConfirm] = useState<{ a: Announcement; kind: "publish" | "archive" } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "publish")
        await sensitive((headers) => api("adminAnnouncementsPublish", { params: { id: confirm.a.id }, headers }));
      else await api("adminAnnouncementsArchive", { params: { id: confirm.a.id } });
      toast(confirm.kind === "publish" ? "Announcement published to inboxes." : "Announcement archived.");
      setConfirm(null);
      await client.invalidateQueries({ queryKey: ["admin", "announcements"] });
    } catch (e) {
      if (!isCancelled(e)) toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminPage
      title="Announcements"
      description="Messages delivered to members’ in-app inbox. Drafts can be edited; each announcement is published once."
      actions={
        <button className="button small" onClick={() => setEditing("new")}>
          <Plus size={15} /> New announcement
        </button>
      }
    >
      <p className="admin-note">Email and push delivery aren’t configured on this server, so announcements are delivered in-app only.</p>
      <Toolbar>
        <Select label="Status" value={f.get("status")} onChange={(v) => f.set({ status: v })} options={[["", "All"], ["DRAFT", "Drafts"], ["PUBLISHED", "Published"], ["ARCHIVED", "Archived"]]} />
      </Toolbar>
      <Panel flush>
        {q.isPending ? (
          <AdminLoading />
        ) : q.error ? (
          <AdminError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Announcements"
              rows={q.data.items}
              empty={<AdminEmpty title="No announcements yet" description="Create a draft to get started." />}
              columns={[
                {
                  key: "title",
                  header: "Announcement",
                  cell: (a) => (
                    <span className="cell-stack">
                      <strong>{a.title}</strong>
                      <span className="clamp-1">{a.body}</span>
                    </span>
                  ),
                },
                { key: "aud", header: "Audience", cell: (a) => (a.audience === "ALL" ? "Everyone" : `${fmt(a.selectedCount)} selected`) },
                { key: "status", header: "Status", cell: (a) => <Badge value={a.status} /> },
                {
                  key: "reach",
                  header: "Read",
                  className: "num",
                  cell: (a) => (a.recipientCount !== null ? `${fmt(a.readCount)} / ${fmt(a.recipientCount)}` : "—"),
                },
                { key: "by", header: "Created by", cell: (a) => `@${a.createdBy?.username ?? "—"}` },
                { key: "when", header: "Updated", cell: (a) => <TimeCell value={a.publishedAt ?? a.updatedAt} /> },
                {
                  key: "actions",
                  header: <span className="sr-only">Actions</span>,
                  cell: (a) => (
                    <span className="row-actions">
                      {a.status === "DRAFT" && (
                        <>
                          <button className="button ghost xs" onClick={() => setEditing(a)}>
                            Edit
                          </button>
                          <button className="button xs" onClick={() => setConfirm({ a, kind: "publish" })}>
                            Publish
                          </button>
                        </>
                      )}
                      {a.status !== "ARCHIVED" && (
                        <button className="button ghost xs" onClick={() => setConfirm({ a, kind: "archive" })}>
                          Archive
                        </button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(page) => f.set({ page })} />
          </>
        )}
      </Panel>
      {editing && <AnnouncementEditor initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "publish" ? "Publish announcement" : "Archive announcement"}
          tone={confirm.kind === "publish" ? "primary" : "danger"}
          confirmLabel={confirm.kind === "publish" ? "Publish now" : "Archive"}
          pending={busy}
          description={
            confirm.kind === "publish" ? (
              <>
                “{confirm.a.title}” will appear in the inbox of{" "}
                {confirm.a.audience === "ALL" ? "every active member" : `${fmt(confirm.a.selectedCount)} selected member(s)`}. This can’t be undone, but you can archive it later.
              </>
            ) : (
              <>“{confirm.a.title}” will be removed from members’ inboxes.</>
            )
          }
          onConfirm={act}
          onClose={() => setConfirm(null)}
        />
      )}
    </AdminPage>
  );
}

/* ============================ Settings ============================ */

type Settings = Models["PlatformSettingsDto"];
const FEATURE_LABELS: Record<keyof Settings["features"], [string, string]> = {
  registration: ["Registration", "New people can create accounts."],
  postCreation: ["Posting", "Members can create posts and quotes."],
  imageUploads: ["Image uploads", "Members can attach images."],
  videoUploads: ["Video uploads", "Members can attach videos (Reels)."],
  reels: ["Reels feed", "The vertical Reels experience is available."],
  comments: ["Comments", "Members can comment and reply."],
  reposts: ["Reposts", "Members can repost and quote posts."],
  search: ["Search", "People and post search is available."],
  reporting: ["Reporting", "Members can report content and accounts."],
};
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export function SettingsPage() {
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: ({ signal }) => api("adminSettingsGet", { signal }) });
  if (q.isPending) return <AdminLoading label="Loading settings" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  return <SettingsForm key={q.data.updatedAt ?? "defaults"} data={q.data} />;
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function SettingsForm({ data }: { data: Models["AdminSettingsResponseDto"] }) {
  const client = useQueryClient();
  const toast = useToast();
  const sensitive = useSensitive();
  const can = useCan();
  const editable = can("settings.update");
  const [s, setS] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState("features");
  const changed = (Object.keys(s) as (keyof Settings)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(data.settings[k]));
  const patch = <K extends keyof Settings>(section: K, value: Partial<Settings[K]>) => setS((prev) => ({ ...prev, [section]: { ...prev[section], ...value } }));
  const toggleIn = <T extends string>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = Object.fromEntries(changed.map((k) => [k, s[k]]));
      await sensitive((headers) => api("adminSettingsUpdate", { body, headers }));
      toast("Settings saved. Changes apply within 15 seconds.");
      await client.invalidateQueries({ queryKey: ["admin", "settings"] });
      await client.invalidateQueries({ queryKey: ["platform-config"] });
    } catch (err) {
      if (!isCancelled(err)) setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      title="Platform settings"
      description={data.updatedAt ? `Last changed ${dateTime(data.updatedAt)}${data.updatedBy ? ` by @${data.updatedBy}` : ""}` : "Using server defaults"}
    >
      <p className="admin-note">
        Secrets such as database, JWT, storage and email credentials live in the server environment and are never shown or editable here.
        {!editable && " Your role can view these settings but not change them."}
      </p>
      <Tabs
        label="Settings sections"
        value={section}
        onChange={setSection}
        items={[
          { value: "features", label: "Features" },
          { value: "general", label: "General & read-only mode" },
          { value: "limits", label: "Posts, comments & media" },
          { value: "moderation", label: "Reporting" },
        ]}
      />
      <form onSubmit={save} className="settings-form">
        <fieldset disabled={!editable || busy}>
          {section === "general" && (
          <Panel title="General">
            <div className="form-grid">
              <Field label="Platform name">
                <input value={s.general.platformName} maxLength={60} required onChange={(e) => patch("general", { platformName: e.target.value })} />
              </Field>
              <Field label="Support email" hint="Shown to members who need help.">
                <input type="email" value={s.general.supportEmail} maxLength={254} onChange={(e) => patch("general", { supportEmail: e.target.value })} />
              </Field>
            </div>
            <Field label="Description">
              <textarea rows={2} value={s.general.description} maxLength={300} onChange={(e) => patch("general", { description: e.target.value })} />
            </Field>
            <label className="switch-row">
              <span>
                <strong>Read-only mode</strong>
                <small>Members can browse but can’t post, comment, react or upload. Staff and sign-in keep working, so administrators can never be locked out.</small>
              </span>
              <input type="checkbox" className="switch" role="switch" checked={s.general.readOnlyMode} onChange={(e) => patch("general", { readOnlyMode: e.target.checked })} />
            </label>
            <Field label="Read-only message" hint="Shown to members while read-only mode is on.">
              <input value={s.general.maintenanceMessage} maxLength={300} onChange={(e) => patch("general", { maintenanceMessage: e.target.value })} />
            </Field>
          </Panel>
          )}

          {section === "features" && (
          <Panel title="Features">
            <div className="switch-grid">
              {(Object.keys(FEATURE_LABELS) as (keyof Settings["features"])[]).map((k) => (
                <label key={k} className="switch-row">
                  <span>
                    <strong>{FEATURE_LABELS[k][0]}</strong>
                    <small>{FEATURE_LABELS[k][1]}</small>
                  </span>
                  <input type="checkbox" className="switch" role="switch" checked={s.features[k]} onChange={(e) => patch("features", { [k]: e.target.checked })} />
                </label>
              ))}
            </div>
          </Panel>
          )}

          {section === "limits" && (
          <div className="admin-grid-2">
            <Panel title="Posts">
              <Field label="Maximum length (characters)">
                <input type="number" min={1} max={5000} required value={s.posts.maxLength} onChange={(e) => patch("posts", { maxLength: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum attachments per post">
                <input type="number" min={1} max={10} required value={s.posts.maxMedia} onChange={(e) => patch("posts", { maxMedia: Number(e.target.value) })} />
              </Field>
              <Field label="Default visibility">
                <select value={s.posts.defaultVisibility} onChange={(e) => patch("posts", { defaultVisibility: e.target.value as Settings["posts"]["defaultVisibility"] })}>
                  <option value="PUBLIC">Public</option>
                  <option value="FOLLOWERS">Followers only</option>
                </select>
              </Field>
            </Panel>
            <Panel title="Comments">
              <Field label="Maximum length (characters)">
                <input type="number" min={1} max={5000} required value={s.comments.maxLength} onChange={(e) => patch("comments", { maxLength: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum reply depth" hint="1 means replies to top-level comments only.">
                <input type="number" min={1} max={10} required value={s.comments.maxDepth} onChange={(e) => patch("comments", { maxDepth: Number(e.target.value) })} />
              </Field>
            </Panel>
            <Panel title="Media">
              <Field label="Maximum image size (MB)" hint={`Server limit: ${data.limits.maxImageMb} MB`}>
                <input type="number" min={1} max={data.limits.maxImageMb} required value={s.media.maxImageMb} onChange={(e) => patch("media", { maxImageMb: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum video size (MB)" hint={`Server limit: ${data.limits.maxVideoMb} MB`}>
                <input type="number" min={1} max={data.limits.maxVideoMb} required value={s.media.maxVideoMb} onChange={(e) => patch("media", { maxVideoMb: Number(e.target.value) })} />
              </Field>
              <fieldset className="check-group">
                <legend>Allowed image types</legend>
                {IMAGE_TYPES.map((t) => (
                  <label key={t} className="check-row">
                    <input type="checkbox" checked={s.media.allowedImageTypes.includes(t)} onChange={(e) => patch("media", { allowedImageTypes: toggleIn(s.media.allowedImageTypes, t, e.target.checked) })} />
                    {t.replace("image/", "").toUpperCase()}
                  </label>
                ))}
              </fieldset>
              <fieldset className="check-group">
                <legend>Allowed video types</legend>
                {VIDEO_TYPES.map((t) => (
                  <label key={t} className="check-row">
                    <input type="checkbox" checked={s.media.allowedVideoTypes.includes(t)} onChange={(e) => patch("media", { allowedVideoTypes: toggleIn(s.media.allowedVideoTypes, t, e.target.checked) })} />
                    {t === "video/quicktime" ? "MOV" : t.replace("video/", "").toUpperCase()}
                  </label>
                ))}
              </fieldset>
            </Panel>
          </div>
          )}

          {section === "moderation" && (
            <Panel title="Report reasons">
              <fieldset className="check-group">
                <legend>Report reasons members can choose</legend>
                {REPORT_REASONS.map((r) => (
                  <label key={r} className="check-row">
                    <input
                      type="checkbox"
                      checked={s.moderation.allowedReportReasons.includes(r)}
                      onChange={(e) => patch("moderation", { allowedReportReasons: toggleIn(s.moderation.allowedReportReasons, r, e.target.checked) })}
                    />
                    {humanize(r)}
                  </label>
                ))}
              </fieldset>
            </Panel>
          )}
        </fieldset>
        {editable && (
          <div className="settings-bar" aria-live="polite">
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : (
              <span className="muted">{changed.length ? `Unsaved changes in ${changed.map(humanize).join(", ")}` : "No unsaved changes"}</span>
            )}
            <div>
              <button type="button" className="button secondary small" disabled={!changed.length || busy} onClick={() => setS(data.settings)}>
                Discard
              </button>
              <button className="button small" disabled={!changed.length || busy}>
                {busy && <Loader2 size={15} className="spin" />} Save changes
              </button>
            </div>
          </div>
        )}
      </form>
    </AdminPage>
  );
}
