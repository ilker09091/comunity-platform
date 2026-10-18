"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Camera, Film, ImageIcon, Video, Globe2, Users, X, Loader2, RotateCcw, BarChart3, Clock, HelpCircle, Sliders, MessageCircleQuestion, EyeOff, Hash, AtSign, Upload, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { api, upload, type Models } from "@/lib/api/client";
import { useSession, useToast } from "./providers";
import { useFeatures } from "@/lib/platform-config";
import { ReelSound } from "./reel-sound";
import { Avatar, Modal } from "./ui";

const DEFAULT_MAX_LENGTH = 5000;
const DEFAULT_MAX_ATTACHMENTS = 4;
const DEFAULT_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif";
/**
 * Any video is accepted and compressed to MP4 on the server. Extensions cover files whose type the
 * browser can't name (MKV, AVI, WMV, camera MTS…).
 */
// Plain `video/*` opens the photo/video gallery on iOS and Android (extension lists can force a file browser).
const VIDEO_ACCEPT = "video/*";
const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|3gp|3g2|mts|m2ts|ts|mpe?g|ogv|hevc)$/i;
const isVideoFile = (file: File) => file.type.startsWith("video/") || (!file.type.startsWith("image/") && VIDEO_EXTENSION.test(file.name));
/**
 * Mobile galleries sometimes hand over videos with an empty or generic type and no extension; let
 * the server (which inspects the contents) decide instead of rejecting them here.
 */
const mightBeVideo = (file: File) =>
  isVideoFile(file) || file.type === "" || file.type === "application/octet-stream";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A post published while its video is still compressing stays hidden until the video is ready.
 * Watch for it in the background (survives closing the composer) and refresh feeds when it goes live.
 */
async function announceWhenLive(postId: string, videoIds: string[], onLive: () => void, onFailed: () => void) {
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    try {
      await api("postsGet", { params: { id: postId } });
      onLive();
      return;
    } catch {
      /* still compressing (404) or a transient error: check the videos before waiting again */
    }
    // If compression fails the server removes the post; the video itself reports FAILED.
    const states = await Promise.all(videoIds.map((id) => api("mediaGet", { params: { id } }).then((m) => m.status, () => null)));
    if (states.includes("FAILED")) {
      onFailed();
      return;
    }
  }
}
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
  /** The browser can't play this format locally (e.g. AVI/MKV); preview the optimized MP4 once ready. */
  previewFailed?: boolean;
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

type InteractiveType = "poll" | "countdown" | "quiz" | "slider" | "ask";

function InteractiveBuilder({ type, onInsert, onClose }: { type: InteractiveType; onInsert: (tag: string) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [correct, setCorrect] = useState(0);
  const [whenDate, setWhenDate] = useState("");
  const [whenTime, setWhenTime] = useState("12:00");
  const [label, setLabel] = useState("");
  const [leftEmoji, setLeftEmoji] = useState("😐");
  const [rightEmoji, setRightEmoji] = useState("🔥");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    try { dlg.showModal(); } catch { /* already open */ }
    return () => { try { dlg.close(); } catch { /* ignore */ } };
  }, []);

  const canSubmit = (() => {
    if (type === "countdown") return whenDate.length > 0;
    if (type === "ask") return question.trim().length > 0;
    if (type === "slider") return question.trim().length > 0;
    if (type === "poll") return question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;
    if (type === "quiz") return question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;
    return false;
  })();

  const titles: Record<InteractiveType, string> = {
    poll: "Create a poll", countdown: "Add a countdown", quiz: "Create a quiz", slider: "Rating slider", ask: "Ask me anything",
  };

  const submit = () => {
    if (!canSubmit) return;
    let tag = "";
    if (type === "poll") {
      const opts = options.map((o) => o.trim()).filter(Boolean);
      tag = `[poll:${question.trim()}|${opts.join("|")}]`;
    } else if (type === "countdown") {
      const iso = new Date(`${whenDate}T${whenTime}`).toISOString();
      tag = label.trim() ? `[countdown:${iso}|${label.trim()}]` : `[countdown:${iso}]`;
    } else if (type === "quiz") {
      const opts = options.map((o) => o.trim()).filter(Boolean);
      tag = `[quiz:${question.trim()}|${correct}|${opts.join("|")}]`;
    } else if (type === "slider") {
      tag = `[slider:${question.trim()}|${leftEmoji}|${rightEmoji}]`;
    } else if (type === "ask") {
      tag = `[ask:${question.trim()}]`;
    }
    onInsert(tag);
    onClose();
  };

  const content = (
    <dialog
      ref={dialogRef}
      className="ibuilder-dialog"
      aria-label={titles[type]}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="ibuilder-sheet">
        <header className="ibuilder-header">
          <h2>{titles[type]}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="ibuilder">
          {type !== "countdown" && (
            <label className="ibuilder-field">
              <span>{type === "ask" ? "Prompt" : "Question"}</span>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={type === "ask" ? "Ask me anything…" : "Write your question…"} maxLength={200} autoFocus />
            </label>
          )}
          {(type === "poll" || type === "quiz") && (
            <div className="ibuilder-options">
              {options.map((opt, i) => (
                <div key={i} className="ibuilder-option">
                  {type === "quiz" && (
                    <label className="ibuilder-radio" title="Correct answer">
                      <input type="radio" name="correct" checked={correct === i} onChange={() => setCorrect(i)} />
                    </label>
                  )}
                  <input value={opt} onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))} placeholder={`Option ${i + 1}`} maxLength={100} />
                  {options.length > 2 && (
                    <button type="button" className="icon-button" onClick={() => setOptions(options.filter((_, j) => j !== i))}><X size={16} /></button>
                  )}
                </div>
              ))}
              {options.length < 4 && (
                <button type="button" className="text-button" onClick={() => setOptions([...options, ""])}>+ Add option</button>
              )}
            </div>
          )}
          {type === "countdown" && (
            <>
              <label className="ibuilder-field"><span>Date</span>
                <input type="date" value={whenDate} onChange={(e) => setWhenDate(e.target.value)} autoFocus />
              </label>
              <label className="ibuilder-field"><span>Time</span>
                <input type="time" value={whenTime} onChange={(e) => setWhenTime(e.target.value)} />
              </label>
              <label className="ibuilder-field"><span>Label (optional)</span>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Album drops" maxLength={60} />
              </label>
            </>
          )}
          {type === "slider" && (
            <div className="ibuilder-emoji-row">
              <label className="ibuilder-field"><span>Left emoji</span>
                <input value={leftEmoji} onChange={(e) => setLeftEmoji(e.target.value)} maxLength={4} />
              </label>
              <label className="ibuilder-field"><span>Right emoji</span>
                <input value={rightEmoji} onChange={(e) => setRightEmoji(e.target.value)} maxLength={4} />
              </label>
            </div>
          )}
          <div className="ibuilder-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="button" disabled={!canSubmit} onClick={submit}>Add</button>
          </div>
        </div>
      </div>
    </dialog>
  );
  return createPortal(content, document.body);
}

function InteractivePicker({ onInsert, disabled }: { onInsert: (tag: string) => void; disabled?: boolean }) {
  const [active, setActive] = useState<InteractiveType | null>(null);
  const types: { id: InteractiveType; icon: typeof BarChart3; label: string }[] = [
    { id: "poll", icon: BarChart3, label: "Poll" },
    { id: "countdown", icon: Clock, label: "Countdown" },
    { id: "quiz", icon: HelpCircle, label: "Quiz" },
    { id: "slider", icon: Sliders, label: "Rating" },
    { id: "ask", icon: MessageCircleQuestion, label: "Ask me" },
  ];
  return (
    <>
      {types.map((t) => (
        <button key={t.id} type="button" onClick={() => setActive(t.id)} disabled={disabled} title={t.label}>
          <t.icon size={17} aria-hidden="true" /> {t.label}
        </button>
      ))}
      {active && <InteractiveBuilder type={active} onInsert={onInsert} onClose={() => setActive(null)} />}
    </>
  );
}

export default function PostComposer({
  quoteId,
  onDone,
  modalOpen,
  onModalClose,
  mode = 'post',
  initialFiles,
}: {
  quoteId?: string;
  onDone?: () => void;
  modalOpen?: boolean;
  onModalClose?: () => void;
  mode?: 'post'|'reel';
  /** Files picked before the composer opened (the mobile + button opens the gallery first). */
  initialFiles?: File[];
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
  const VIDEO_TYPES = mode==='reel' && on("videoUploads") ? VIDEO_ACCEPT : "";
  const imageMb = Math.floor((config?.maxImageBytes ?? 10 * 1048576) / 1048576);
  const videoMb = Math.floor((config?.maxVideoBytes ?? 2048 * 1048576) / 1048576);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [open, setOpen] = useState(false);
  // Separate inputs for the page and the modal: a modal <dialog> makes the page inert.
  const cardInput = useRef<HTMLInputElement>(null);
  const editorInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  /** Attachments still in the composer; status polling stops for the rest. */
  const live = useRef(new Set<string>());

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
      let media = (await upload(item.file, (progress) => update(item.key, { progress }))) as Models["MediaDto"];
      if (media.type !== (mode==='reel'?'VIDEO':'IMAGE')) {
        await api('mediaRemove',{params:{id:media.id}});
        throw new Error(mode==='reel'?'Choose a video for your Reel.':'Use Create Reel to publish a video.');
      }
      update(item.key, { media, progress: 100 });
      // Videos are compressed on the server; wait until the optimized MP4 is ready to publish.
      while (media.status === "PROCESSING" && live.current.has(item.key)) {
        await sleep(1500);
        media = await api("mediaGet", { params: { id: media.id } });
        update(item.key, { media });
      }
      if (media.status === "FAILED") {
        update(item.key, { media: undefined });
        throw new Error("This video couldn’t be processed. Try another file.");
      }
    } catch (error) {
      update(item.key, { error: error instanceof Error ? error.message : "Upload failed." });
    }
  };

  const select = (files: FileList | File[] | null) => {
    if (!files || !user) return;
    const selected: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (attachments.length + selected.length >= MAX_ATTACHMENTS) {
        toast(`You can attach up to ${MAX_ATTACHMENTS} images or videos.`, true);
        break;
      }
      const video = !!VIDEO_TYPES && mightBeVideo(file);
      if (!video && !(IMAGE_TYPES && IMAGE_TYPES.split(",").includes(file.type))) {
        if (VIDEO_TYPES) toast("Choose a video file.", true);
        else {
          const allowed = IMAGE_TYPES.split(",").filter(Boolean).map((t) => TYPE_NAMES[t] ?? t);
          toast(allowed.length ? `Choose a ${allowed.join(", ")} file.` : "Uploads are currently turned off.", true);
        }
        continue;
      }
      if (file.size > (video ? videoMb : imageMb) * 1024 * 1024) {
        const limit = video ? videoMb : imageMb;
        toast(`${file.name} exceeds the ${limit >= 1024 ? `${Math.round(limit / 102.4) / 10} GB` : `${limit} MB`} limit.`, true);
        continue;
      }
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      const key = crypto.randomUUID();
      live.current.add(key);
      selected.push({ key, file, preview, progress: 0 });
    }
    setAttachments((prev) => [...prev, ...selected]);
    selected.forEach((item) => void sendAttachment(item));
    for (const ref of [cardInput, editorInput]) if (ref.current) ref.current.value = "";
    if (selected.length) setOpen(true);
  };

  /** `camera`: open the phone camera directly (the browser asks for camera permission). */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !initialFiles?.length || !user) return;
    seeded.current = true;
    select(initialFiles);
  }, [initialFiles, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (accept: string, inEditor: boolean, camera = false) => {
    const target = (inEditor ? editorInput : cardInput).current;
    if (!target) return;
    target.accept = accept;
    if (camera) target.setAttribute("capture", "environment");
    else target.removeAttribute("capture");
    target.click();
  };

  const remove = (item: Attachment) => {
    live.current.delete(item.key);
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
    onSuccess: (post) => {
      const stillCompressing = attachments.some((a) => a.media?.status === "PROCESSING");
      const compressingIds = attachments.flatMap((a) => (a.media?.status === "PROCESSING" ? [a.media.id] : []));
      live.current.clear();
      setContent("");
      for (const item of attachments) {
        URL.revokeObjectURL(item.preview);
        urls.current.delete(item.preview);
      }
      setAttachments([]);
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "suggestions" });
      if (stillCompressing) {
        toast(mode === "reel" ? "Your Reel is processing and will be live in a few seconds." : "Your post is processing and will be live in a few seconds.");
        void announceWhenLive(
          post.id,
          compressingIds,
          () => {
            void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "suggestions" });
            toast(mode === "reel" ? "Your Reel is live 🎉" : "Your post is live 🎉");
          },
          () => toast("We couldn't process your video, so the post wasn't published. Please try another video.", true),
        );
      } else toast(quoteId ? "Your quote has been shared." : "Your post is live.");
      setOpen(false);
      onModalClose?.();
      onDone?.();
    },
  });

  // Publishing only waits for the upload itself; compression continues on the server.
  const uploading = attachments.some((a) => !a.error && !a.media);
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
              {mode === 'reel' || isVideoFile(item.file) ? (
                item.previewFailed && item.media?.status !== "READY" ? (
                  <div className="attachment-placeholder">
                    <Film size={26} aria-hidden="true" />
                    <span>{item.file.name}</span>
                    <small>Preview after optimizing</small>
                  </div>
                ) : (
                  <video
                    src={item.previewFailed && item.media?.status === "READY" ? item.media.url : item.preview}
                    muted
                    playsInline
                    preload="metadata"
                    onError={() => update(item.key, { previewFailed: true })}
                  />
                )
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
              {item.media?.status === "PROCESSING" && !item.error && (
                <div className="upload-progress optimizing" aria-live="polite">
                  <Loader2 size={13} className="spin" aria-hidden="true" />
                  <progress
                    value={item.media.processingProgress ?? undefined}
                    max={100}
                    aria-label={`Optimizing ${item.file.name}`}
                  />
                  <span>{item.media.processingProgress !== null ? `Optimizing ${item.media.processingProgress}%` : "Optimizing…"}</span>
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
          {VIDEO_TYPES && (
            <button
              type="button"
              onClick={() => pick("video/*", true, true)}
              disabled={busy || attachments.length >= MAX_ATTACHMENTS}
            >
              <Camera size={17} className="tool-video" aria-hidden="true" /> Camera
            </button>
          )}
          <InteractivePicker disabled={busy} onInsert={(tag) => setContent((c) => (c ? `${c}\n${tag}` : tag))} />
          <button type="button" onClick={() => setContent((c) => (c ? `${c} #spoiler` : "#spoiler "))} disabled={busy} title="Spoiler">
            <EyeOff size={17} aria-hidden="true" /> Spoiler
          </button>
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

  /**
   * TikTok-style Reel flow: pick a video first, then a "Post" screen with the caption on the left and
   * the cover on the right. Nothing is focused automatically, so the phone keyboard stays closed.
   */
  const reel = attachments[0];
  const [coverMuted, setCoverMuted] = useState(true);
  const insert = (text: string) => setContent((c) => (c && !/\s$/.test(c) ? `${c} ${text}` : `${c}${text}`));
  const reelEditor = (
    <form
      className={`reel-composer ${reel ? "has-video" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) mutation.mutate();
      }}
    >
      {!reel ? (
        <div className="reel-pick">
          <span className="reel-pick-icon" aria-hidden="true">
            <Upload size={34} />
          </span>
          <h3>Upload a video</h3>
          <p>Share a Reel with your followers. Any video format works, up to {videoMb >= 1024 ? `${Math.floor(videoMb / 1024)} GB` : `${videoMb} MB`}.</p>
          <button type="button" className="reel-primary" onClick={() => pick(VIDEO_TYPES || "video/*", true)} disabled={!VIDEO_TYPES}>
            Select video
          </button>
          <button type="button" className="reel-secondary" onClick={() => pick("video/*", true, true)} disabled={!VIDEO_TYPES}>
            <Camera size={18} aria-hidden="true" /> Record
          </button>
          {!VIDEO_TYPES && <p className="inline-error">Video uploads are turned off right now.</p>}
        </div>
      ) : (
        <>
          <div className="reel-post-top">
            <div className="rc-caption">
              <label className="sr-only" htmlFor="reel-caption">
                Caption
              </label>
              <textarea
                id="reel-caption"
                placeholder="Describe your Reel… add #hashtags and @mentions"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                disabled={busy}
                aria-invalid={tooLong}
              />
              <div className="reel-chips">
                <button type="button" onClick={() => insert("#")} disabled={busy}>
                  <Hash size={15} aria-hidden="true" /> Hashtags
                </button>
                <button type="button" onClick={() => insert("@")} disabled={busy}>
                  <AtSign size={15} aria-hidden="true" /> Mention
                </button>
              </div>
            </div>
            <div className="reel-cover">
              {reel.previewFailed && reel.media?.status !== "READY" ? (
                <div className="attachment-placeholder">
                  <Film size={26} aria-hidden="true" />
                  <small>Preview after optimizing</small>
                </div>
              ) : (
                <video
                  src={reel.previewFailed && reel.media?.status === "READY" ? reel.media.url : reel.preview}
                  muted={coverMuted}
                  playsInline
                  autoPlay
                  loop
                  preload="metadata"
                  onError={() => update(reel.key, { previewFailed: true })}
                />
              )}
              {!reel.media && !reel.error && (
                <span className="reel-cover-status" aria-live="polite">
                  <Loader2 size={14} className="spin" aria-hidden="true" /> {reel.progress}%
                </span>
              )}
              {reel.media?.status === "PROCESSING" && !reel.error && (
                <span className="reel-cover-status" aria-live="polite">
                  <Loader2 size={14} className="spin" aria-hidden="true" />
                  {reel.media.processingProgress !== null ? `${reel.media.processingProgress}%` : "Optimizing"}
                </span>
              )}
              <button
                type="button"
                className="reel-cover-sound"
                aria-label={coverMuted ? "Play with sound" : "Mute preview"}
                onClick={() => setCoverMuted((m) => !m)}
              >
                {coverMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              <button
                type="button"
                className="reel-cover-change"
                onClick={() => {
                  remove(reel);
                  pick(VIDEO_TYPES || "video/*", true);
                }}
                disabled={busy}
              >
                <RefreshCw size={13} aria-hidden="true" /> Change
              </button>
            </div>
          </div>
          {reel.error && (
            <div className="upload-error rc-error" role="alert">
              <span>{reel.error}</span>
              <button type="button" onClick={() => void sendAttachment(reel)}>
                <RotateCcw size={13} /> Retry
              </button>
            </div>
          )}
          <div className="reel-settings">
            <ReelSound
              media={reel.media}
              disabled={busy || !!reel.error}
              onApplied={(media) => {
                // The server rewrote the file with the new sound: preview the real result.
                update(reel.key, { media, preview: media.url, previewFailed: false });
                setCoverMuted(false);
              }}
            />
            <div className="reel-setting">
              <span>Who can watch</span>
              <VisibilitySelect value={visibility} onChange={setVisibility} disabled={busy} />
            </div>
            <button
              type="button"
              className="reel-setting"
              aria-pressed={/#spoiler\b/i.test(content)}
              onClick={() => setContent((c) => (/#spoiler\b/i.test(c) ? c.replace(/\s*#spoiler\b/gi, "") : c ? `${c} #spoiler` : "#spoiler"))}
              disabled={busy}
            >
              <span>
                <EyeOff size={16} aria-hidden="true" /> Spoiler cover
              </span>
              <span className={`reel-switch ${/#spoiler\b/i.test(content) ? "on" : ""}`} aria-hidden="true" />
            </button>
            {content.length > 0 && (
              <span className={`character-count ${tooLong ? "over" : ""}`}>
                {content.length.toLocaleString("en")} / {MAX_LENGTH.toLocaleString("en")}
              </span>
            )}
          </div>
          {mutation.isError && (
            <p className="inline-error" role="alert">
              {mutation.error.message}
            </p>
          )}
          <div className="rc-actions">
            <button type="button" className="reel-secondary" onClick={() => remove(reel)} disabled={busy}>
              Discard
            </button>
            <button type="submit" className="reel-primary" disabled={!ready}>
              {busy && <Loader2 size={15} className="spin" />}
              {busy ? "Posting…" : uploading ? "Uploading…" : "Post"}
            </button>
          </div>
        </>
      )}
      <input
        type="file"
        ref={editorInput}
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

  if (modalOpen !== undefined)
    return modalOpen ? (
      <Modal
        title={mode === "reel" ? "New Reel" : "Create post"}
        className={!user ? "auth-prompt-dialog" : mode === "reel" ? "reel-composer-modal" : ""}
        onClose={() => !busy && onModalClose?.()}
      >
        <div className="composer-modal-body">{user ? (mode === "reel" ? reelEditor : editor) : <GuestPrompt reel={mode === "reel"} />}</div>
      </Modal>
    ) : null;

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
            {VIDEO_TYPES && (
              <button type="button" onClick={() => pick("video/*", false, true)}>
                <Camera size={17} className="tool-video" aria-hidden="true" /> Kamera
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

/** Shown instead of the editor to visitors without an account. */
function GuestPrompt({ reel }: { reel: boolean }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const next = query ? `${pathname}?${query}` : pathname;
  return (
    <div className="auth-prompt">
      <span className="auth-prompt-icon" aria-hidden="true">
        {reel ? <Video size={26} /> : <ImageIcon size={26} />}
      </span>
      <h3>{reel ? "Share your Reels on Circle" : "Share your moments on Circle"}</h3>
      <p>Sign in or create a free account to publish {reel ? "videos" : "posts"}, follow people and join the conversation.</p>
      <div className="auth-prompt-actions">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="button">
          Sign in
        </Link>
        <Link href="/register" className="button secondary">
          Create account
        </Link>
      </div>
    </div>
  );
}
