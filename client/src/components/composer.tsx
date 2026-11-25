"use client";
import { api, upload, type Models } from "@/lib/api/client";
import { compressImage } from "@/lib/compress-image";
import { haptic } from "@/lib/haptics";
import { useMediaAttachment } from "@/lib/use-media-attachment";
import { Check, CircleAlert, Paperclip, Pencil, Plus, Reply, SendHorizontal, Sparkles, Video, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ImageViewer } from "./image-viewer";
import { useSession, useToast } from "./providers";
import { StickerButton } from "./sticker-picker";
import { VoiceRecorder } from "./voice-message";

import { attachmentLabel, Message, QuoteSummary } from "./message-item";
import { AlbumDraft, CSS_AUTOSIZE, Draft, MAX_ALBUM, nextLocalId, replyKind, replyThumb } from "./thread-shared";

/**
 * Telegram-style composer: one rounded field (emoji/sticker tray, text, attach) and a round
 * button that morphs between microphone and send. It owns the draft text, so typing re-renders
 * only the composer and never the message list.
 */
export function Composer({
  peer,
  canMessage,
  awaiting,
  callsBusy,
  fieldRef,
  stickerDock,
  voiceActive,
  onVoiceActiveChange,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onJumpTo,
  onSaveEdit,
  onSend,
  onSendAudio,
  onTogether,
}: {
  peer: Models["MessagePeerDto"];
  canMessage: boolean;
  awaiting: boolean;
  callsBusy: boolean;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  stickerDock: HTMLDivElement | null;
  voiceActive: boolean;
  onVoiceActiveChange: (active: boolean) => void;
  replyTo: Message | null;
  editing: Message | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onJumpTo: (id: string) => void;
  onSaveEdit: (message: Message, content: string) => void;
  onSend: (draft: Draft, preview: Partial<Message>, options?: { noReply?: boolean }) => void;
  onSendAudio: (audioId: string) => Promise<unknown>;
  /** Opens gestures and mini games. */
  onTogether?: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const [text, setText] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const attachment = useMediaAttachment();
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  // Editing a message puts its text in the field; finishing or cancelling empties it.
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    setText(editing?.content ?? "");
  }
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || CSS_AUTOSIZE) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, fieldRef]);
  // Stop showing "typing..." to them when leaving the conversation.
  useEffect(
    () => () => {
      if (typingSent.current) void api("messagesStopTyping", { params: { id: peer.id } }).catch(() => {});
    },
    [peer.id],
  );
  const signalTyping = (value: string) => {
    const now = Date.now();
    if (value.trim() && now - typingSent.current > 3000) {
      typingSent.current = now;
      void api("messagesTyping", { params: { id: peer.id } }).catch(() => {});
    } else if (!value.trim() && typingSent.current) {
      typingSent.current = 0;
      void api("messagesStopTyping", { params: { id: peer.id } }).catch(() => {});
    }
  };
  /** Several photos/videos picked at once upload in parallel and are sent as one album. */
  const [album, setAlbum] = useState<AlbumDraft[]>([]);
  const albumRef = useRef<AlbumDraft[]>([]);
  const removedKeys = useRef(new Set<string>());
  useEffect(() => {
    albumRef.current = album;
  }, [album]);
  useEffect(
    () => () => {
      for (const item of albumRef.current) {
        URL.revokeObjectURL(item.preview);
        if (item.media) void api("mediaRemove", { params: { id: item.media.id } }).catch(() => {});
      }
    },
    [],
  );
  const patchAlbum = (key: string, patch: Partial<AlbumDraft>) =>
    setAlbum((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const uploadAlbumItem = async (item: AlbumDraft) => {
    try {
      const file = await compressImage(item.file);
      if (removedKeys.current.has(item.key)) return;
      let uploaded = (await upload(file, (progress) => patchAlbum(item.key, { progress }))) as Models["MediaDto"];
      if (removedKeys.current.has(item.key)) {
        void api("mediaRemove", { params: { id: uploaded.id } }).catch(() => {});
        return;
      }
      patchAlbum(item.key, { media: uploaded, progress: 100 });
      while (uploaded.status === "PROCESSING") {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (removedKeys.current.has(item.key)) return;
        uploaded = await api("mediaGet", { params: { id: uploaded.id } });
        patchAlbum(item.key, { media: uploaded });
      }
      if (uploaded.status === "FAILED") patchAlbum(item.key, { error: "Processing failed" });
    } catch (e) {
      patchAlbum(item.key, { error: e instanceof Error ? e.message : "Upload failed" });
    }
  };
  const addToAlbum = (files: File[]) => {
    const room = MAX_ALBUM - album.length;
    if (files.length > room) toast(`You can send up to ${MAX_ALBUM} photos and videos at once.`, true);
    const items: AlbumDraft[] = files.slice(0, Math.max(0, room)).map((file) => ({
      key: nextLocalId(),
      file,
      preview: URL.createObjectURL(file),
      type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      progress: 0,
      media: null,
      error: null,
    }));
    if (!items.length) return;
    setAlbum((list) => [...list, ...items]);
    void (async () => {
      for (let i = 0; i < items.length; i += 2) await Promise.all(items.slice(i, i + 2).map(uploadAlbumItem));
    })();
  };
  const removeFromAlbum = (key: string) => {
    const item = album.find((x) => x.key === key);
    removedKeys.current.add(key);
    if (item) URL.revokeObjectURL(item.preview);
    if (item?.media) void api("mediaRemove", { params: { id: item.media.id } }).catch(() => {});
    setAlbum((list) => list.filter((x) => x.key !== key));
  };
  const albumReady = album.length > 0 && album.every((item) => item.media?.status === "READY" && !item.error);
  const media = editing ? null : attachment.media;
  const hasText = !!text.trim();
  const canSend = canMessage && !voiceActive && !attachment.busy && !attachment.error && (album.length ? albumReady : hasText || !!media);
  const showSend = hasText || !!media || !!editing || callsBusy || album.length > 0;
  const submit = () => {
    if (editing) {
      const value = text.trim();
      if (value && value !== editing.content) onSaveEdit(editing, value);
      else if (!value) return;
      else onCancelEdit();
      return;
    }
    if (!canSend) return;
    if (album.length) {
      const caption = text.trim() || undefined;
      album.forEach((item, i) => {
        const last = i === album.length - 1;
        onSend(
          { mediaId: item.media!.id, content: last ? caption : undefined },
          { media: item.media!, content: last ? (caption ?? null) : null },
          { noReply: i > 0 },
        );
        URL.revokeObjectURL(item.preview);
      });
      setAlbum([]);
      setText("");
      typingSent.current = 0;
      fieldRef.current?.focus({ preventScroll: true });
      return;
    }
    const content = text.trim() || undefined;
    onSend(
      { content, mediaId: media?.id, viewOnce: media ? viewOnce : undefined },
      {
        content: content ?? null,
        ...(media ? (viewOnce ? { viewOnce: true, viewOnceType: media.type } : { media }) : {}),
      },
    );
    // Clear at once (like Telegram) and keep the keyboard open for the next message.
    setText("");
    typingSent.current = 0;
    if (media) {
      attachment.attached();
      setViewOnce(false);
      setPreviewOpen(false);
    }
    fieldRef.current?.focus({ preventScroll: true });
  };
  const insertEmoji = (emoji: string) => {
    const el = fieldRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, 2000);
    setText(next);
    signalTyping(next);
    requestAnimationFrame(() => el?.setSelectionRange(start + emoji.length, start + emoji.length));
  };
  const previewSrc = attachment.previewUrl ?? media?.url;
  const embedMessage = editing ?? replyTo;
  const embed = embedMessage && {
    kind: editing ? ("edit" as const) : ("reply" as const),
    key: `${editing ? "edit" : "reply"}-${embedMessage.id}`,
    message: embedMessage,
    title: editing ? "Edit message" : `Reply to ${embedMessage.senderId === user?.id ? "yourself" : peer.displayName}`,
    quoteKind: editing ? ("TEXT" as const) : replyKind(embedMessage),
    text: editing
      ? embedMessage.content
      : embedMessage.viewOnce ? null : embedMessage.content || embedMessage.sticker?.emoji || attachmentLabel(embedMessage),
    thumb: editing ? null : replyThumb(embedMessage),
  };
  return (
    <form
      className="dm-composer tg-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {awaiting && <p className="dm-notice">Message request sent. You can send more once {peer.displayName} accepts.</p>}
      {!canMessage && !awaiting && (
        <p className="dm-notice">
          {peer.isBlocking ? "You blocked this account. Unblock it to send messages." : "Follow this private account before sending a message."}
        </p>
      )}
      {!editing && previewSrc && (
        <div className="dm-attachment dm-attachment-preview">
          <div className="dm-draft-media">
            {(media?.type ?? attachment.previewType) === "IMAGE" ? (
              <button type="button" aria-label="Enlarge photo preview" onClick={() => setPreviewOpen(true)}>
                <img src={previewSrc} alt="Photo preview before sending" />
              </button>
            ) : (
              <video src={previewSrc} controls playsInline preload="metadata" aria-label="Video preview before sending" />
            )}
          </div>
          {previewOpen && <ImageViewer src={previewSrc} alt="Photo preview" onClose={() => setPreviewOpen(false)} />}
          <div className="dm-draft-details">
            <span>
              {attachment.uploading
                ? `Uploading… ${attachment.progress}%`
                : media?.status === "READY"
                  ? `${media.type === "IMAGE" ? "Photo" : "Video"} ready to send`
                  : "Processing video..."}
            </span>
            <button
              type="button"
              className={`dm-once-toggle ${viewOnce ? "on" : ""}`}
              aria-pressed={viewOnce}
              aria-label="View once"
              disabled={!media}
              title={viewOnce ? "View once: on" : "View once: off"}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                haptic("tap");
                setViewOnce((v) => !v);
              }}
            >
              1
            </button>
            <button
              type="button"
              className="dm-icon"
              aria-label="Remove attachment"
              onClick={() => {
                attachment.clear();
                setViewOnce(false);
                setPreviewOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          {attachment.uploading && (
            <span className="dm-upload-bar" role="progressbar" aria-valuenow={attachment.progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${(attachment.progress ?? 0) / 100})` }} />
            </span>
          )}
        </div>
      )}
      {!editing && album.length > 0 && (
        <div className="dm-album-draft">
          <div className="dm-album-draft-strip">
            {album.map((item) => {
              const pending = !item.error && item.media?.status !== "READY";
              return (
                <div key={item.key} className={`dm-album-draft-item ${item.error ? "error" : ""} ${pending ? "pending" : ""}`}>
                  {item.type === "VIDEO" ? <video src={item.preview} muted playsInline preload="metadata" /> : <img src={item.preview} alt="" />}
                  {pending && (
                    <span className="dm-album-progress" style={{ "--p": `${item.media ? 100 : item.progress}%` } as CSSProperties} aria-label={`Uploading ${item.progress}%`} />
                  )}
                  {item.error && <span className="dm-album-error" title={item.error}><CircleAlert size={18} /></span>}
                  {item.type === "VIDEO" && <span className="dm-album-kind"><Video size={12} /></span>}
                  <button type="button" className="dm-album-remove" aria-label="Remove" onPointerDown={(e) => e.preventDefault()} onClick={() => removeFromAlbum(item.key)}>
                    <X size={12} strokeWidth={3} />
                  </button>
                </div>
              );
            })}
            {album.length < MAX_ALBUM && (
              <button type="button" className="dm-album-add" aria-label="Add more photos or videos" onPointerDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>
                <Plus size={22} />
              </button>
            )}
          </div>
          <small>
            {album.length} {album.length === 1 ? "item" : "items"} ·{" "}
            {album.some((item) => item.error) ? "Remove the failed item to send" : albumReady ? "Add a caption or send" : "Uploading…"}
          </small>
        </div>
      )}
      {viewOnce && media && <p className="dm-notice">They can open it once. It disappears after it&apos;s viewed.</p>}
      {attachment.error && (
        <p className="dm-notice error" role="alert">
          {attachment.error}
        </p>
      )}
      <div className="dm-compose-row tg-row">
        <div className={`tg-field ${embed ? "has-embed" : ""}`}>
          {embed && (
            <div className={`tg-embed ${embed.kind}`} key={embed.key}>
              <span className="tg-embed-icon" aria-hidden="true">
                {embed.kind === "edit" ? <Pencil size={18} /> : <Reply size={20} />}
              </span>
              <button
                type="button"
                className="tg-embed-body"
                title="Show message"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onJumpTo(embed.message.id)}
              >
                {embed.thumb && <img className="tg-embed-thumb" src={embed.thumb} alt="" />}
                <span className="tg-embed-text">
                  <strong>{embed.title}</strong>
                  <span className="tg-embed-preview">
                    <QuoteSummary kind={embed.quoteKind} text={embed.text} durationMs={embed.message.audioDurationMs} />
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="tg-embed-close"
                aria-label={embed.kind === "edit" ? "Cancel edit" : "Cancel reply"}
                onPointerDown={(e) => e.preventDefault()}
                onClick={embed.kind === "edit" ? onCancelEdit : onCancelReply}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="tg-field-row">
          <StickerButton
            conversation
            dock={stickerDock}
            disabled={!canMessage || voiceActive}
            onEmoji={insertEmoji}
            onPick={(sticker) => onSend({ stickerId: sticker.id }, { sticker, hasSticker: true })}
            onGif={(gif) => onSend({ gifId: gif.id }, { gif })}
          />
          <textarea
            ref={fieldRef}
            aria-label="Message"
            placeholder="Message"
            maxLength={2000}
            value={text}
            // Never disabled while sending: disabling would blur it and close the phone keyboard.
            disabled={!canMessage}
            onChange={(e) => {
              setText(e.target.value);
              signalTyping(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onCancelReply();
                if (editing) onCancelEdit();
              }
              // Enter sends on devices with a keyboard; Shift+Enter keeps a new line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
          />
          {!editing && onTogether && !hasText && !album.length && !media && (
            <button
              type="button"
              className="dm-icon tg-together"
              aria-label="Gestures and games"
              title="Gestures and games"
              disabled={!canMessage || voiceActive}
              onPointerDown={(e) => e.preventDefault()}
              onClick={onTogether}
            >
              <Sparkles size={21} />
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="dm-icon tg-attach"
              aria-label="Attach photo or video"
              title="Photo or video"
              disabled={!canMessage || attachment.busy || voiceActive || !!media || album.length >= MAX_ALBUM}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={22} />
            </button>
          )}
          </div>
        </div>
        <div className={`tg-action ${showSend ? "is-send" : "is-mic"}`}>
          <button
            type="submit"
            className={`tg-send ${editing ? "is-edit" : ""}`}
            aria-label={editing ? "Save edit" : "Send message"}
            aria-hidden={!showSend || undefined}
            tabIndex={showSend ? undefined : -1}
            disabled={editing ? !text.trim() : !canSend}
            // Keep focus in the textarea so the phone keyboard stays open after sending.
            onPointerDown={(e) => e.preventDefault()}
          >
            {editing ? <Check size={22} strokeWidth={2.6} /> : <SendHorizontal size={21} strokeWidth={2.2} />}
          </button>
          {!callsBusy && (
            <VoiceRecorder
              buttonClassName="tg-mic"
              hidden={showSend}
              disabled={!canMessage || attachment.busy || !!media || showSend || album.length > 0}
              onActiveChange={onVoiceActiveChange}
              onSend={onSendAudio}
            />
          )}
        </div>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/*"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!files.length) return;
            if (album.length || files.length > 1) addToAlbum(files);
            else void attachment.select(files[0]);
          }}
        />
      </div>
    </form>
  );
}
