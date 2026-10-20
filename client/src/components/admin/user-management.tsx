"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Laptop, LogOut, MessageSquareText, Monitor, PenLine, Smartphone, Tablet, Trash2 } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { dateTime, fmt, useCan } from "@/lib/admin";
import { useToast } from "@/components/providers";
import { ActionDialog, AdminEmpty, AdminError, AdminLoading, DataTable, Panel, StatCard, TimeCell, UserCell, errorText, useSensitive } from "./kit";
import { Modal } from "@/components/ui";

type Detail = Models["AdminUserDetailDto"];

/** "Chrome · Android" from a user agent string, plus a device icon. */
function describeDevice(agent: string | null) {
  const ua = agent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ua ? "App or other client" : "Unknown device";
  const os = /Android/.test(ua) ? "Android" : /iPad/.test(ua) ? "iPadOS" : /iPhone|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const Icon = /iPad|Tablet/.test(ua) ? Tablet : /Mobile|Android|iPhone/.test(ua) ? Smartphone : /Windows|Mac|Linux/.test(ua) ? Laptop : Monitor;
  return { label: os ? `${browser} · ${os}` : browser, Icon };
}

export function UserActivity({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["admin", "user", id, "activity"], queryFn: ({ signal }) => api("adminUsersActivity", { params: { id }, signal }) });
  if (q.isPending) return <AdminLoading label="Loading activity" />;
  if (q.error) return <AdminError error={q.error} retry={() => void q.refetch()} />;
  const a = q.data, peak = Math.max(1, ...a.postsByDay);
  const today = new Date();
  return (
    <div className="admin-activity">
      <div className="admin-stat-grid">
        <StatCard label="Messages sent" value={a.messagesSent} hint={`${fmt(a.messagesReceived)} received`} />
        <StatCard label="Conversations" value={a.conversations} />
        <StatCard label="Calls (30 days)" value={a.recentCalls} />
        <StatCard label="Active stories" value={a.activeStories} />
        <StatCard label="Likes given" value={a.likesGiven} />
        <StatCard label="Saved posts" value={a.bookmarks} />
        <StatCard label="Own stickers" value={a.stickers} />
        <StatCard label="Reports filed" value={a.reportsFiled} tone={a.reportsFiled > 20 ? "warning" : undefined} />
      </div>
      <div className="admin-grid-2">
        <Panel title="Posts in the last 14 days">
          <div className="admin-spark" role="img" aria-label={`Posts per day: ${a.postsByDay.join(", ")}`}>
            {a.postsByDay.map((count, index) => {
              const day = new Date(today.getTime() - (a.postsByDay.length - 1 - index) * 86400000);
              return (
                <span key={index} title={`${day.toLocaleDateString("en", { month: "short", day: "numeric" })}: ${count}`}>
                  <i style={{ height: `${Math.max(count ? 8 : 2, (count / peak) * 100)}%` }} />
                </span>
              );
            })}
          </div>
          <p className="admin-help">Message contents are never shown here — only counts.</p>
        </Panel>
        <Panel title={`Circles (${a.circles.length})`} flush>
          {a.circles.length ? (
            <ul className="admin-circles">
              {a.circles.map((circle) => (
                <li key={circle.id}>
                  <span className="admin-circle-mark" style={{ background: `color-mix(in srgb, ${circle.color} 16%, var(--surface))` }}>{circle.emoji}</span>
                  <span><strong>{circle.name}</strong><small>{circle.memberCount} members · joined {dateTime(circle.joinedAt).split(",")[0]}</small></span>
                  <span className="admin-badge tone-neutral">{circle.role}</span>
                </li>
              ))}
            </ul>
          ) : <AdminEmpty title="Not in any circle" />}
        </Panel>
      </div>
    </div>
  );
}

export function UserSessions({ user, canAct }: { user: Models["AdminUserRowDto"]; canAct: boolean }) {
  const can = useCan(), client = useQueryClient(), toast = useToast();
  const [target, setTarget] = useState<"all" | Models["AdminSessionDto"] | null>(null);
  const q = useQuery({ queryKey: ["admin", "user", user.id, "sessions"], queryFn: ({ signal }) => api("adminUsersSessions", { params: { id: user.id }, signal }) });
  const allowed = canAct && can("users.suspend");
  const active = q.data?.filter((s) => s.active).length ?? 0;
  return (
    <Panel title={`Devices (${active} signed in)`} flush
      action={allowed && active > 0 ? <button type="button" className="button small danger" onClick={() => setTarget("all")}><LogOut size={15} /> Sign out everywhere</button> : undefined}>
      {q.isPending ? <AdminLoading /> : q.error ? <AdminError error={q.error} retry={() => void q.refetch()} /> : (
        <DataTable caption="Sessions" rows={q.data} empty={<AdminEmpty title="No sign-ins recorded" />}
          columns={[
            { key: "device", header: "Device", cell: (s) => { const { label, Icon } = describeDevice(s.userAgent); return <span className="admin-device"><Icon size={18} /><span className="cell-stack"><strong>{label}</strong><span>{s.ipAddress ?? "IP hidden for your role"}</span></span></span>; } },
            { key: "since", header: "Signed in", cell: (s) => <TimeCell value={s.createdAt} /> },
            { key: "used", header: "Last used", cell: (s) => <TimeCell value={s.lastUsedAt} /> },
            { key: "state", header: "State", cell: (s) => s.active ? <span className="admin-badge tone-ok">Active</span>
              : <span className="muted">{s.revokedAt ? `Signed out${s.revokedReason ? ` (${s.revokedReason})` : ""}` : "Expired"}</span> },
            { key: "act", header: "", cell: (s) => allowed && s.active ? <button type="button" className="button xs secondary" onClick={() => setTarget(s)}>Sign out</button> : null },
          ]} />
      )}
      {target && (
        <ActionDialog
          title={target === "all" ? `Sign @${user.username} out everywhere` : "Sign out this device"}
          description={target === "all" ? "Every device must sign in again. Use it after a lost phone or a suspected account takeover."
            : `${describeDevice(target.userAgent).label}, last used ${dateTime(target.lastUsedAt)}.`}
          confirmLabel="Sign out" tone="danger" presets={["Lost or stolen device", "Suspected account takeover", "User request"]}
          onSubmit={async (reason) => {
            const result = target === "all"
              ? await api("adminUsersRevokeSessions", { params: { id: user.id }, body: { reason } })
              : await api("adminUsersRevokeSession", { params: { id: user.id, sessionId: target.id }, body: { reason } });
            toast(`Signed out of ${result.revoked} device${result.revoked === 1 ? "" : "s"}.`);
            await client.invalidateQueries({ queryKey: ["admin", "user", user.id] });
          }}
          onClose={() => setTarget(null)} />
      )}
    </Panel>
  );
}

export function UserNotes({ id }: { id: string }) {
  const can = useCan(), client = useQueryClient(), toast = useToast();
  const [body, setBody] = useState("");
  const q = useQuery({ queryKey: ["admin", "user", id, "notes"], queryFn: ({ signal }) => api("adminUsersNotes", { params: { id }, signal }) });
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "user", id, "notes"] });
  const add = useMutation({
    mutationFn: () => api("adminUsersAddNote", { params: { id }, body: { body: body.trim() } }),
    onSuccess: () => { setBody(""); void refresh(); },
    onError: (error) => toast(errorText(error)),
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => api("adminUsersDeleteNote", { params: { id, noteId } }),
    onSuccess: () => void refresh(),
    onError: (error) => toast(errorText(error)),
  });
  return (
    <Panel title="Staff notes">
      <p className="admin-help">Only the team sees these. Use them to hand over context between moderators.</p>
      {can("users.warn") && (
        <form className="admin-note-form" onSubmit={(event) => { event.preventDefault(); if (body.trim().length >= 2) add.mutate(); }}>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={3} placeholder="e.g. Verified the account owner by email on 12 Oct." />
          <button type="submit" className="button small" disabled={body.trim().length < 2 || add.isPending}><MessageSquareText size={15} /> Add note</button>
        </form>
      )}
      {q.isPending ? <AdminLoading /> : q.error ? <AdminError error={q.error} retry={() => void q.refetch()} /> : q.data.length ? (
        <ul className="admin-notes">
          {q.data.map((note) => (
            <li key={note.id}>
              <UserCell user={note.author} sub={<TimeCell value={note.createdAt} />} />
              <p>{note.body}</p>
              {note.canDelete && <button type="button" className="icon-button" aria-label="Delete note" disabled={remove.isPending} onClick={() => remove.mutate(note.id)}><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
      ) : <AdminEmpty title="No notes yet" />}
    </Panel>
  );
}

/** Staff clean-up of a profile: name, username, bio, links, privacy and photos. */
export function EditProfileButton({ detail, canAct }: { detail: Detail; canAct: boolean }) {
  const can = useCan(), client = useQueryClient(), toast = useToast();
  const [open, setOpen] = useState(false);
  const u = detail.user;
  const [fields, setFields] = useState({ displayName: u.displayName, username: u.username, bio: detail.bio ?? "", location: detail.location ?? "",
    website: detail.website ?? "", isPrivate: detail.isPrivate, removeAvatar: false, removeCover: false });
  if (!canAct || !can("users.update")) return null;
  const set = (patch: Partial<typeof fields>) => setFields((value) => ({ ...value, ...patch }));
  return (
    <>
      <button type="button" className="button small secondary" onClick={() => setOpen(true)}><PenLine size={15} /> Edit profile</button>
      {open && (
        <ActionDialog title={`Edit @${u.username}`} confirmLabel="Save changes"
          description={<>Changes are applied at once and recorded with the previous values. <Link href={`/profile/${u.username}`} className="inline-link">View profile</Link></>}
          presets={["Offensive name or bio", "Impersonation", "Spam links", "User request"]}
          extra={
            <div className="admin-profile-form">
              <div className="form-grid">
                <label className="form-field"><span>Display name</span><input value={fields.displayName} maxLength={50} onChange={(e) => set({ displayName: e.target.value })} /></label>
                <label className="form-field"><span>Username</span><input value={fields.username} maxLength={30} spellCheck={false} onChange={(e) => set({ username: e.target.value })} /></label>
              </div>
              <label className="form-field"><span>Bio</span><textarea rows={2} value={fields.bio} maxLength={300} onChange={(e) => set({ bio: e.target.value })} /></label>
              <div className="form-grid">
                <label className="form-field"><span>Location</span><input value={fields.location} maxLength={100} onChange={(e) => set({ location: e.target.value })} /></label>
                <label className="form-field"><span>Website</span><input value={fields.website} maxLength={200} inputMode="url" onChange={(e) => set({ website: e.target.value })} /></label>
              </div>
              <div className="admin-checks">
                <label><input type="checkbox" checked={fields.isPrivate} onChange={(e) => set({ isPrivate: e.target.checked })} /> Private account</label>
                <label><input type="checkbox" checked={fields.removeAvatar} disabled={!u.avatarUrl} onChange={(e) => set({ removeAvatar: e.target.checked })} /> Remove profile photo</label>
                <label><input type="checkbox" checked={fields.removeCover} disabled={!detail.coverUrl} onChange={(e) => set({ removeCover: e.target.checked })} /> Remove cover image</label>
              </div>
            </div>
          }
          onSubmit={async (reason) => {
            const result = await api("adminUsersUpdateProfile", {
              params: { id: u.id },
              body: { reason, displayName: fields.displayName.trim(), username: fields.username.trim(), bio: fields.bio.trim() || null,
                location: fields.location.trim() || null, website: fields.website.trim() || null, isPrivate: fields.isPrivate,
                removeAvatar: fields.removeAvatar, removeCover: fields.removeCover },
            });
            toast(result.changed.length ? `Updated: ${result.changed.join(", ")}.` : "Nothing changed.");
            await client.invalidateQueries({ queryKey: ["admin"] });
          }}
          onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** Sets a new password (generated and shown once, or typed by staff) and signs every device out. */
export function ResetPasswordButton({ user, canAct }: { user: Models["AdminUserRowDto"]; canAct: boolean }) {
  const can = useCan(), client = useQueryClient(), toast = useToast(), sensitive = useSensitive();
  const [open, setOpen] = useState(false), [mode, setMode] = useState<"generate" | "manual">("generate");
  const [password, setPassword] = useState(""), [result, setResult] = useState<string | null>(null);
  if (!canAct || !can("users.update")) return null;
  const strong = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/.test(password);
  return (
    <>
      <button type="button" className="button small secondary" onClick={() => { setOpen(true); setPassword(""); setMode("generate"); }}><KeyRound size={15} /> Reset password</button>
      {open && (
        <ActionDialog title={`Reset @${user.username}'s password`} confirmLabel="Reset password" tone="danger"
          description="The old password stops working and the account is signed out on every device. Share a new password only over a channel you trust."
          presets={["Locked out of the account", "Suspected account takeover", "User request (identity verified)"]}
          extra={
            <div className="admin-password-mode">
              <div className="segmented" role="radiogroup" aria-label="New password">
                <button type="button" role="radio" aria-checked={mode === "generate"} className={mode === "generate" ? "active" : ""} onClick={() => setMode("generate")}>Generate one</button>
                <button type="button" role="radio" aria-checked={mode === "manual"} className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>Set it myself</button>
              </div>
              {mode === "manual" && (
                <label className="form-field">
                  <span>New password <small>· 8+ characters with a letter and a digit</small></span>
                  <input type="text" value={password} autoComplete="new-password" spellCheck={false} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!password && !strong} />
                </label>
              )}
            </div>
          }
          onSubmit={async (reason) => {
            if (mode === "manual" && !strong) throw new Error("Use at least 8 characters with a letter and a digit.");
            const response = await sensitive((headers) => api("adminUsersResetPassword", {
              params: { id: user.id }, body: { reason, ...(mode === "manual" ? { password } : {}) }, headers,
            }));
            toast(`Password reset. Signed out of ${response.revokedSessions} device${response.revokedSessions === 1 ? "" : "s"}.`);
            setResult(response.temporaryPassword);
            await client.invalidateQueries({ queryKey: ["admin", "user", user.id] });
          }}
          onClose={() => setOpen(false)} />
      )}
      {result && (
        <Modal title="New password" onClose={() => setResult(null)} className="confirm-dialog">
          <div className="admin-temp-password">
            <p>Give this to <strong>@{user.username}</strong> privately. It is shown only once.</p>
            <button type="button" className="admin-temp-password-value" onClick={() => void navigator.clipboard.writeText(result).then(() => toast("Password copied."), () => toast("Couldn’t copy."))}>
              <code>{result}</code><Copy size={16} />
            </button>
            <div className="dialog-actions"><button type="button" className="button" onClick={() => setResult(null)}>Done</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
