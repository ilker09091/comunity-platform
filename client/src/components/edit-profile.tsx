"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, ImagePlus, Loader2, LockKeyhole, MapPin, Link2, Trash2 } from "lucide-react";
import { api, ApiError, upload, type Models } from "@/lib/api/client";
import { PROFILE_LIMITS, profileFields, profilePatch, validateProfile, type ProfileFields } from "@/lib/profile-editor";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, ErrorState, PageHeader } from "./ui";
import { AppHeader, MobileNav } from "./main-layout";
import ImageCropDialog from "./image-crop-dialog";

type Me = Models["MeDto"];
type ImageChange = { file: File; preview: string } | "remove" | null;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function ProfileEditorPage() {
  const { user, loading, error } = useSession();
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["profile-editor", user?.id], queryFn: ({ signal }) => api("usersGetMe", { signal }), enabled: !!user, retry: false, gcTime: 0 });
  return <><AppHeader /><main id="main-content" className="app-container profile-editor-page">
    {loading || (user && profile.isPending) ? <div className="card editor-loading" aria-busy="true"><Loader2 className="spin" size={24} />Loading your profile…</div> : error ? <div className="card"><ErrorState error={error} retry={() => void client.invalidateQueries({ queryKey: ["session"] })} /></div> : user && profile.isError ? <div className="card"><ErrorState error={profile.error} retry={() => void profile.refetch()} /></div> : user && profile.data ? <EditProfile key={user.id} user={profile.data} /> : <div className="card editor-loading"><p>Sign in to edit your profile.</p><Link className="button" href="/login?next=%2Fprofile%2Fedit">Sign in</Link></div>}
  </main><MobileNav /></>;
}

export default function EditProfile({ user }: { user: Me }) {
  const router = useRouter(), toast = useToast(), client = useQueryClient();
  const [baseline, setBaseline] = useState(user);
  const [fields, setFields] = useState<ProfileFields>(() => profileFields(user));
  const [isPrivate, setPrivate] = useState(user.isPrivate);
  const [avatar, setAvatar] = useState<ImageChange>(null), [cover, setCover] = useState<ImageChange>(null);
  const [cropping, setCropping] = useState<{ file: File; kind: "avatar" | "cover" } | null>(null);
  const [progress, setProgress] = useState<{ label: string; percent: number } | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const previews = useRef(new Set<string>());
  const leaving = useRef(false);
  const original = profileFields(baseline);
  const patch = profilePatch(fields, original, isPrivate, baseline.isPrivate);
  const dirty = Object.keys(patch).length > 0 || avatar !== null || cover !== null;
  const errors = validateProfile(fields), valid = Object.keys(errors).length === 0;

  const reconcile = (me: Me) => {
    setBaseline(me); client.setQueryData(["session"], me);
    // Remove stale names/photos throughout feeds and profile/follow views.
    for (const key of ["profile", "post", "posts", "suggestions", "notifications", "connections", "comments", "users", "follow-requests", "unread"])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const replaceImage = (kind: "avatar" | "cover", next: ImageChange) => {
    const previous = kind === "avatar" ? avatar : cover;
    if (previous && previous !== "remove") { URL.revokeObjectURL(previous.preview); previews.current.delete(previous.preview); }
    (kind === "avatar" ? setAvatar : setCover)(next);
  };
  const save = useMutation({
    mutationFn: async () => {
      let latest = baseline;
      // These API operations are independent, not transactional. Reconcile each successful
      // stage so a later failure never causes already-uploaded photos to be sent twice.
      for (const [kind, change, setOp, removeOp] of [["avatar", avatar, "usersSetAvatar", "usersRemoveAvatar"], ["cover", cover, "usersSetCover", "usersRemoveCover"]] as const) {
        if (!change) continue;
        if (change === "remove") latest = await api(removeOp);
        else { setProgress({ label: kind, percent: 0 }); latest = await upload(change.file, (percent) => setProgress({ label: kind, percent }), setOp) as Me; }
        reconcile(latest); replaceImage(kind, null); setProgress(null);
      }
      if (Object.keys(patch).length) { latest = await api("usersUpdateMe", { body: patch }); reconcile(latest); }
      return latest;
    },
    onSuccess: (me) => {
      setFields(profileFields(me)); setPrivate(me.isPrivate); leaving.current = true;
      toast("Profile updated."); router.push(`/profile/${me.username}`);
    },
    onError: () => setProgress(null),
  });
  useEffect(() => {
    const urls = previews.current;
    return () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);
  useEffect(() => {
    if (!dirty && !save.isPending) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigation = (event: MouseEvent) => {
      if (leaving.current || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.href === window.location.href || url.protocol !== "http:" && url.protocol !== "https:") return;
      event.preventDefault(); event.stopPropagation();
      if (!save.isPending) setLeaveTo(url.href);
    };
    const back = (event: PopStateEvent) => {
      if (leaving.current || window.location.pathname === "/profile/edit") return;
      if (save.isPending || !window.confirm("Discard your unsaved profile changes?")) {
        event.stopImmediatePropagation(); window.history.go(1);
      } else leaving.current = true;
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigation, true); window.addEventListener("popstate", back, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigation, true); window.removeEventListener("popstate", back, true); };
  }, [dirty, save.isPending]);

  const pick = (file: File | undefined, kind: "avatar" | "cover") => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return toast("Choose a JPEG, PNG, WebP or GIF image.", true);
    if (!file.size || file.size > 10 * 1024 * 1024) return toast("Choose an image between 1 byte and 10 MB.", true);
    setCropping({ file, kind });
  };
  const serverErrors = save.error instanceof ApiError ? save.error.details : [];
  const fieldError = (key: keyof ProfileFields) => serverErrors.find((detail) => detail.field === key)?.message ?? (touched || fields[key] !== original[key] ? errors[key] : undefined);
  const input = (key: keyof ProfileFields, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => <label className="form-field"><span>{label}<small>{fields[key].length}/{PROFILE_LIMITS[key]}</small></span><input value={fields[key]} maxLength={PROFILE_LIMITS[key]} onChange={(event) => setFields((previous) => ({ ...previous, [key]: event.target.value }))} disabled={save.isPending} aria-invalid={!!fieldError(key)} {...props} />{fieldError(key) && <span className="field-error">{fieldError(key)}</span>}</label>;
  const avatarUser = { displayName: fields.displayName || baseline.displayName, avatarUrl: avatar === "remove" ? null : avatar ? avatar.preview : baseline.avatarUrl };
  const coverUrl = cover === "remove" ? null : cover ? cover.preview : baseline.coverUrl;
  const cancel = () => { const destination = `/profile/${baseline.username}`; if (dirty) setLeaveTo(destination); else router.push(destination); };

  return <>
    <PageHeader title="Make it yours" description="A familiar face. A little about you. Your corner of Circle." action={<button className="text-button" type="button" disabled={save.isPending} onClick={cancel}><ArrowLeft size={16} />Back to profile</button>} />
    <div className="profile-editor-grid">
    <form className="card profile-editor-form" onSubmit={(event) => { event.preventDefault(); setTouched(true); if (valid && dirty && !save.isPending) save.mutate(); }}>
      <section className="editor-section"><div className="editor-section-heading"><span className="editor-step">01</span><div><h2>Profile appearance</h2><p>Choose a photo and a cover that feel like you.</p></div></div>
      <div className="edit-media"><div className="edit-cover">{coverUrl ? <img src={coverUrl} alt="Cover preview" /> : <div className="cover-art" aria-hidden="true" />}<div className="edit-cover-actions"><label className="chip-button"><ImagePlus size={15} />{coverUrl ? "Change cover" : "Add cover"}<input type="file" className="sr-only" accept={IMAGE_TYPES.join(",")} disabled={save.isPending} onChange={(event) => { pick(event.target.files?.[0], "cover"); event.target.value = ""; }} /></label>{coverUrl && <button type="button" className="chip-button" aria-label="Remove cover" disabled={save.isPending} onClick={() => replaceImage("cover", baseline.coverUrl ? "remove" : null)}><Trash2 size={15} /></button>}</div></div>
      <div className="edit-avatar"><Avatar user={avatarUser} size={92} /><label className="edit-avatar-button" aria-label="Change profile photo"><Camera size={16} /><input type="file" className="sr-only" accept={IMAGE_TYPES.join(",")} disabled={save.isPending} onChange={(event) => { pick(event.target.files?.[0], "avatar"); event.target.value = ""; }} /></label>{avatarUser.avatarUrl && <button type="button" className="text-button muted" disabled={save.isPending} onClick={() => replaceImage("avatar", baseline.avatarUrl ? "remove" : null)}>Remove photo</button>}</div></div>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span className="editor-step">02</span><div><h2>A little about you</h2><p>Help your people find and get to know you.</p></div></div><div className="form-grid">{input("displayName", "Display name", { required: true })}{input("username", "Username", { autoCapitalize: "none", spellCheck: false })}</div><label className="form-field"><span>Biography<small>{fields.bio.length}/{PROFILE_LIMITS.bio}</small></span><textarea rows={4} value={fields.bio} maxLength={PROFILE_LIMITS.bio} placeholder="What makes you, you?" disabled={save.isPending} aria-invalid={!!fieldError("bio")} onChange={(event) => setFields((previous) => ({ ...previous, bio: event.target.value }))} />{fieldError("bio") && <span className="field-error">{fieldError("bio")}</span>}</label><div className="form-grid">{input("location", "Location", { placeholder: "City, country" })}{input("website", "Website", { type: "url", inputMode: "url", placeholder: "https://" })}</div></section>
      <section className="editor-section"><div className="editor-section-heading"><span className="editor-step">03</span><div><h2>Who can see your profile?</h2><p>You decide who gets a closer look.</p></div></div><label className="editor-privacy"><div><strong><LockKeyhole size={16} />Private profile</strong><p>Only approved followers can see your posts. Switching to public approves pending follow requests.</p></div><input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} disabled={save.isPending} /></label></section>
      {progress && <div className="settings-progress" aria-live="polite"><progress value={progress.percent} max={100} /><span>Uploading {progress.label} · {progress.percent}%</span></div>}
      {save.isError && <p className="form-error" role="alert">{save.error.message} Any photos already saved are reflected in the preview. You can retry the remaining changes.</p>}
      <footer className="editor-save"><span aria-live="polite">{save.isPending ? "Saving your profile…" : dirty ? "You have unsaved changes" : "All changes saved"}</span><div><button type="button" className="button secondary" disabled={save.isPending} onClick={cancel}>Cancel</button><button className="button" disabled={!dirty || save.isPending}>{save.isPending && <Loader2 size={15} className="spin" />}{save.isPending ? "Saving…" : "Save changes"}</button></div></footer>
    </form>
    <aside className="editor-preview"><div className="editor-preview-label">LIVE PREVIEW <span>Only you can see your edits</span></div><div className="card editor-preview-card"><div className="editor-preview-cover">{coverUrl ? <img src={coverUrl} alt="Live cover preview" /> : <div className="cover-art" />}</div><div className="editor-preview-body"><Avatar user={avatarUser} size={86} /><h2>{fields.displayName || "Your name"}{isPrivate && <LockKeyhole size={15} />}</h2><p className="profile-handle">@{fields.username || "username"}</p><p className="editor-preview-bio">{fields.bio || "Your story starts here."}</p>{fields.location && <p><MapPin size={14} />{fields.location}</p>}{fields.website && <p><Link2 size={14} />{fields.website}</p>}<div className="editor-preview-tabs"><span>Posts</span><span>Reposts</span></div></div></div><p className="editor-preview-note">Photos are cropped before upload. Your preview updates as you edit; changes go live when you save.</p></aside>
    </div>
    {cropping && <ImageCropDialog key={cropping.kind + cropping.file.lastModified} {...cropping} onClose={() => setCropping(null)} onApply={(file) => { const preview = URL.createObjectURL(file); previews.current.add(preview); replaceImage(cropping.kind, { file, preview }); setCropping(null); }} />}
    {leaveTo && <ConfirmDialog title="Discard changes?" description="Your unsaved profile edits will be lost." confirmLabel="Discard and leave" onClose={() => setLeaveTo(null)} onConfirm={() => { leaving.current = true; const url = new URL(leaveTo, window.location.origin); if (url.origin === window.location.origin) router.push(url.pathname + url.search + url.hash); else window.location.assign(url.href); }} />}
  </>;
}
