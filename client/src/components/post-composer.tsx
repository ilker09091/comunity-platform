"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ImageIcon, Video, Globe2, Users, X, Loader2, RotateCcw } from "lucide-react";
import { api, upload, type Models } from "@/lib/api/client";
import { useSession, useToast } from "./providers";
import { useFeatures } from "@/lib/platform-config";
import { Avatar, Modal } from "./ui";

const DEFAULT_MAX_LENGTH = 5000;
const DEFAULT_MAX_ATTACHMENTS = 4;
const DEFAULT_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif";
const DEFAULT_VIDEO_TYPES = "video/mp4,video/webm,video/quicktime";
const TYPE_NAMES: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "video/mp4": "MP4",
  "video/webm": "WebM",
  "video/quicktime": "MOV",
};

type Visibility = "PUBLIC" | "FOLLOWERS";
type Attachment = {
  key: string;
  file: File;
  preview: string;
  progress: number;
  media?: Models["MediaDto"];
  error?: string;
};

function VisibilitySelect({
  value,
  onChange,
  disabled,
}: {
  value: Visibility;
  onChange: (value: Visibility) => void;
  disabled?: boolean;
}) {
  return (
    <label className="visibility-select">
      {value === "PUBLIC" ? <Globe2 size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
      <select
        aria-label="Who can see this post"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Visibility)}
      >
        <option value="PUBLIC">Everyone</option>
        <option value="FOLLOWERS">Followers</option>
      </select>
    </label>
  );
}

export default function PostComposer({
  quoteId,
  onDone,
  modalOpen,
  onModalClose,
  mode = 'post',
}: {
  quoteId?: string;
  onDone?: () => void;
  modalOpen?: boolean;
  onModalClose?: () => void;
  mode?: 'post'|'reel';
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [content, setContent] = useState("");
  const { config, on, canWrite } = useFeatures();
  const [visibility, setVisibility] = useState<Visibility>(config?.defaultVisibility ?? "PUBLIC");
  // Limits and allowed types follow the admin-configured platform settings.
  const MAX_LENGTH = config?.postMaxLength ?? DEFAULT_MAX_LENGTH;
  const MAX_ATTACHMENTS = config?.postMaxMedia ?? DEFAULT_MAX_ATTACHMENTS;
  const IMAGE_TYPES = mode==='post' && on("imageUploads") ? (config?.allowedImageTypes.join(",") ?? DEFAULT_IMAGE_TYPES) : "";
  const VIDEO_TYPES = mode==='reel' && on("videoUploads") ? (config?.allowedVideoTypes.join(",") ?? DEFAULT_VIDEO_TYPES) : "";
  const imageMb = Math.floor((config?.maxImageBytes ?? 10 * 1048576) / 1048576);
  const videoMb = Math.floor((config?.maxVideoBytes ?? 100 * 1048576) / 1048576);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [open, setOpen] = useState(false);
  // Separate inputs for the page and the modal: a modal <dialog> makes the page inert.
  const cardInput = useRef<HTMLInputElement>(null);
  const editorInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const values = urls.current;
    return () => {
      for (const url of values) URL.revokeObjectURL(url);
    };
  }, []);

  const update = (key: string, patch: Partial<Attachment>) =>
    setAttachments((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const sendAttachment = async (item: Attachment) => {
    update(item.key, { error: undefined, progress: 0 });
    try {
      const media = (await upload(item.file, (progress) => update(item.key, { progress }))) as Models["MediaDto"];
      if (media.type !== (mode==='reel'?'VIDEO':'IMAGE')) {
        await api('mediaRemove',{params:{id:media.id}});
        throw new Error(mode==='reel'?'Choose a video for your Reel.':'Use Create Reel to publish a video.');
      }
      update(item.key, { media, progress: 100 });
    } catch (error) {
      update(item.key, { error: error instanceof Error ? error.message : "Upload failed." });
    }
  };

  const select = (files: FileList | null) => {
    if (!files || !user) return;
    const selected: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (attachments.length + selected.length >= MAX_ATTACHMENTS) {
        toast(`You can attach up to ${MAX_ATTACHMENTS} images or videos.`, true);
        break;
      }
      const video = !!VIDEO_TYPES && VIDEO_TYPES.split(",").includes(file.type);
      if (!video && !(IMAGE_TYPES && IMAGE_TYPES.split(",").includes(file.type))) {
        const allowed = [IMAGE_TYPES, VIDEO_TYPES].join(",").split(",").filter(Boolean).map((t) => TYPE_NAMES[t] ?? t);
        toast(allowed.length ? `Choose a ${allowed.join(", ")} file.` : "Uploads are currently turned off.", true);
        continue;
      }
      if (file.size > (video ? videoMb : imageMb) * 1024 * 1024) {
        toast(`${file.name} exceeds the ${video ? videoMb : imageMb} MB limit.`, true);
        continue;
      }
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      selected.push({ key: crypto.randomUUID(), file, preview, progress: 0 });
    }
    setAttachments((prev) => [...prev, ...selected]);
    selected.forEach((item) => void sendAttachment(item));
    for (const ref of [cardInput, editorInput]) if (ref.current) ref.current.value = "";
    if (selected.length) setOpen(true);
  };

  const pick = (accept: string, inEditor: boolean) => {
    const target = (inEditor ? editorInput : cardInput).current;
    if (!target) return;
    target.accept = accept;
    target.click();
  };

  const remove = (item: Attachment) => {
    setAttachments((prev) => prev.filter((a) => a.key !== item.key));
    URL.revokeObjectURL(item.preview);
    urls.current.delete(item.preview);
    if (item.media) void api("mediaRemove", { params: { id: item.media.id } }).catch(() => {});
  };

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        content: content.trim() || undefined,
        mediaIds: attachments.map((a) => a.media!.id),
        visibility,
      };
      return quoteId ? api("repostsQuote", { params: { id: quoteId }, body }) : api("postsCreate", { body });
    },
    onSuccess: () => {
      setContent("");
      for (const item of attachments) {
        URL.revokeObjectURL(item.preview);
        urls.current.delete(item.preview);
      }
      setAttachments([]);
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "suggestions" });
      toast(quoteId ? "Your quote has been shared." : "Your post is live.");
      setOpen(false);
      onModalClose?.();
      onDone?.();
    },
  });

  const uploading = attachments.some((a) => !a.media && !a.error);
  const failed = attachments.some((a) => a.error);
  const tooLong = content.length > MAX_LENGTH;
  const ready =
    !!user && (mode==='reel'?attachments.length>0:!!content.trim() || attachments.length > 0) && !uploading && !failed && !tooLong && !mutation.isPending;
  const busy = mutation.isPending;

  const editor = (
    <form
      className="composer-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) mutation.mutate();
      }}
    >
      <div className="composer-editor-top">
        <Avatar user={user} size={40} />
        <div className="composer-editor-meta">
          <strong>{user?.displayName}</strong>
          <VisibilitySelect value={visibility} onChange={setVisibility} disabled={busy} />
        </div>
      </div>
      <label className="sr-only" htmlFor={quoteId ? `quote-${quoteId}` : "composer-text"}>
        Post content
      </label>
      <textarea
        id={quoteId ? `quote-${quoteId}` : "composer-text"}
        className="composer-textarea"
        placeholder={quoteId ? "Add your thoughts…" : "Share something…"}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={quoteId ? 3 : 5}
        disabled={busy}
        data-autofocus
        aria-invalid={tooLong}
        aria-describedby="composer-count"
      />
      {attachments.length > 0 && (
        <div className={`attachment-grid count-${attachments.length}`}>
          {attachments.map((item) => (
            <div className="attachment" key={item.key}>
              {item.file.type.startsWith("video/") ? (
                <video src={item.preview} muted playsInline preload="metadata" />
              ) : (
                <img src={item.preview} alt={item.file.name} />
              )}
              <button
                type="button"
                className="attachment-remove"
                aria-label={`Remove ${item.file.name}`}
                onClick={() => remove(item)}
                disabled={busy}
              >
                <X size={14} />
              </button>
              {!item.media && !item.error && (
                <div className="upload-progress" aria-live="polite">
                  <progress value={item.progress} max={100} aria-label={`Uploading ${item.file.name}`} />
                  <span>{item.progress}%</span>
                </div>
              )}
              {item.error && (
                <div className="upload-error" role="alert">
                  <span>{item.error}</span>
                  <button type="button" onClick={() => void sendAttachment(item)}>
                    <RotateCcw size={13} /> Retry
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mutation.isError && (
        <p className="inline-error" role="alert">
          {mutation.error.message}
        </p>
      )}
      <div className="composer-editor-bottom">
        <div className="composer-tools">
          {IMAGE_TYPES && (
            <button
              type="button"
              onClick={() => pick(IMAGE_TYPES, true)}
              disabled={busy || attachments.length >= MAX_ATTACHMENTS}
            >
              <ImageIcon size={17} className="tool-image" aria-hidden="true" /> Image
            </button>
          )}
          {VIDEO_TYPES && (
            <button
              type="button"
              onClick={() => pick(VIDEO_TYPES, true)}
              disabled={busy || attachments.length >= MAX_ATTACHMENTS}
            >
              <Video size={17} className="tool-video" aria-hidden="true" /> Video
            </button>
          )}
        </div>
        <span id="composer-count" className={`character-count ${tooLong ? "over" : ""}`}>
          {content.length > 0 && `${content.length.toLocaleString("en")} / ${MAX_LENGTH.toLocaleString("en")}`}
        </span>
        <button className="button" disabled={!ready}>
          {busy && <Loader2 size={15} className="spin" />}
          {busy ? "Posting…" : uploading ? "Uploading…" : quoteId ? "Quote" : mode==='reel'?'Publish Reel':"Post"}
        </button>
      </div>
      <input
        type="file"
        ref={editorInput}
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => select(e.target.files)}
      />
    </form>
  );

  const unavailable = !canWrite("postCreation") ? (
    <p className="composer-disabled" role="status">
      {config?.readOnlyMode ? config.maintenanceMessage || "Circle is in read-only mode right now." : "Posting is temporarily unavailable."}
    </p>
  ) : null;
  if (unavailable && (modalOpen !== undefined || quoteId))
    return modalOpen === false ? null : quoteId ? unavailable : (
      <Modal title="Create post" onClose={() => onModalClose?.()}>
        <div className="composer-modal-body">{unavailable}</div>
      </Modal>
    );

  if (modalOpen !== undefined) return modalOpen ? <Modal title={mode==='reel'?'Create Reel':'Create post'} onClose={() => !busy && onModalClose?.()}><div className="composer-modal-body">{user ? editor : <Link href="/login" className="button">Sign in to publish</Link>}</div></Modal> : null;

  if (quoteId)
    return (
      <div className="composer-modal-body">{editor}</div>
    );

  if (user && unavailable) return <section className="card composer-card">{unavailable}</section>;

  if (!user)
    return (
      <section className="card composer-card">
        <div className="composer-top">
          <Avatar size={40} />
          <Link href="/login" className="composer-trigger">
            Sign in to share something…
          </Link>
        </div>
      </section>
    );

  return (
    <>
      <section className="card composer-card" aria-label="Create a post">
        <div className="composer-top">
          <Avatar user={user} size={40} />
          <button type="button" className="composer-trigger" onClick={() => setOpen(true)}>
            {content.trim() ? content.trim().slice(0, 80) : "Share something…"}
          </button>
        </div>
        <div className="composer-bottom">
          <div className="composer-tools">
            {IMAGE_TYPES && (
              <button type="button" onClick={() => pick(IMAGE_TYPES, false)}>
                <ImageIcon size={17} className="tool-image" aria-hidden="true" /> Image
              </button>
            )}
            {VIDEO_TYPES && (
              <button type="button" onClick={() => pick(VIDEO_TYPES, false)}>
                <Video size={17} className="tool-video" aria-hidden="true" /> Video
              </button>
            )}
            {mode==='post' && on('reels') && <Link href="/reels?create=1" className="composer-create-reel"><Video size={17}/>Create Reel</Link>}
          </div>
          <VisibilitySelect value={visibility} onChange={setVisibility} />
        </div>
        <input
          type="file"
          ref={cardInput}
          multiple
          hidden
          tabIndex={-1}
          onChange={(e) => select(e.target.files)}
        />
      </section>
      {open && (
        <Modal title="Create post" onClose={() => !busy && setOpen(false)}>
          <div className="composer-modal-body">{editor}</div>
        </Modal>
      )}
    </>
  );
}
