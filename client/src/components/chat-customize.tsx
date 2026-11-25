"use client";
import { api, upload, type Models } from "@/lib/api/client";
import { compressImage } from "@/lib/compress-image";
import { haptic } from "@/lib/haptics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, ImagePlus, Loader2, Palette, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { MESSAGE_SOUNDS, peerSound, previewSound, setPeerSound, type MessageSound } from "./app-bridge";
import { themeMeta } from "./chat-themes";
import { useSession, useToast } from "./providers";
import { Avatar, Modal } from "./ui";

type Peer = Models["MessagePeerDto"];

/**
 * Telegram-style settings for one chat: a private nickname, the shared theme, your own
 * wallpaper and a notification sound for this person.
 */
export function ChatCustomize({
  peer,
  nickname,
  wallpaperUrl,
  themeName,
  themeId,
  onTheme,
  onClose,
}: {
  peer: Peer;
  nickname: string | null;
  wallpaperUrl: string | null;
  themeName: string;
  themeId: string;
  onTheme?: () => void;
  onClose: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [name, setName] = useState(nickname ?? "");
  const [sound, setSound] = useState<MessageSound>(() => peerSound(peer.id));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const statusKey = ["messages", user?.id, "status", peer.id];
  const applyPrefs = (prefs: Models["ChatPrefsResultDto"]) => {
    client.setQueryData<Models["MessageStatusDto"]>(statusKey, (d) => d && { ...d, ...prefs });
    void client.invalidateQueries({ queryKey: ["messages", user?.id, "conversations"] });
  };
  const save = useMutation({
    mutationFn: (body: { nickname?: string | null; wallpaperMediaId?: string | null }) =>
      api("messagesSetPrefs", { params: { id: peer.id }, body }),
    onSuccess: applyPrefs,
    onError: (e) => toast(e.message, true),
  });
  const pickWallpaper = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choose a photo.", true);
    setUploading(true);
    try {
      let media = (await upload(await compressImage(file), () => {})) as Models["MediaDto"];
      while (media.status === "PROCESSING") {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        media = await api("mediaGet", { params: { id: media.id } });
      }
      if (media.status !== "READY") throw new Error("This photo could not be processed.");
      const uploaded = media;
      const prefs = await api("messagesSetPrefs", { params: { id: peer.id }, body: { wallpaperMediaId: uploaded.id } }).catch((e) => {
        void api("mediaRemove", { params: { id: uploaded.id } }).catch(() => {});
        throw e;
      });
      applyPrefs(prefs);
      haptic("success");
      toast("Wallpaper set.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed.", true);
    } finally {
      setUploading(false);
    }
  };
  const trimmed = name.trim();
  const nameChanged = trimmed !== (nickname ?? "");
  const saveName = () => {
    if (!nameChanged || save.isPending) return;
    save.mutate({ nickname: trimmed || null }, { onSuccess: () => toast(trimmed ? "Nickname saved." : "Nickname removed.") });
  };
  const accent = themeMeta(themeId).accent ?? "var(--primary)";
  return (
    <Modal
      title="Customize"
      className="dm-customize-sheet"
      onClose={onClose}
      headerActions={
        nameChanged ? (
          <button type="button" className="dm-set-done" disabled={save.isPending} onClick={saveName}>
            {save.isPending ? <Loader2 size={16} className="spin" /> : "Save"}
          </button>
        ) : undefined
      }
    >
      <div className="dm-set">
        <div className="dm-set-hero">
          <Avatar user={peer} size={84} />
          <strong>{trimmed || peer.displayName}</strong>
          <span>@{peer.username}</span>
        </div>

        <h3 className="dm-set-label">Nickname</h3>
        <form className="dm-set-group" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
          <input
            className="dm-set-input"
            value={name}
            maxLength={40}
            placeholder={peer.displayName}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nickname"
            enterKeyHint="done"
          />
        </form>
        <p className="dm-set-note">Only you see this name, in your chats and here.</p>

        <h3 className="dm-set-label">Appearance</h3>
        <div className="dm-set-group">
          {onTheme && (
            <button type="button" className="dm-set-item" onClick={onTheme}>
              <span className="dm-set-icon" style={{ background: accent }}><Palette size={17} /></span>
              <span className="dm-set-text"><strong>Chat theme</strong></span>
              <span className="dm-set-value">{themeName}</span>
              <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
            </button>
          )}
          <button type="button" className="dm-set-item" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <span className="dm-set-icon" style={{ background: "#1c7ed6" }}><ImagePlus size={17} /></span>
            <span className="dm-set-text"><strong>Wallpaper</strong></span>
            <span className="dm-set-value">{uploading ? "Uploading…" : wallpaperUrl ? "Your photo" : "Theme"}</span>
            {uploading ? <Loader2 size={17} className="spin dm-set-chevron" /> : <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />}
          </button>
          {wallpaperUrl && (
            <button type="button" className="dm-set-item danger" disabled={uploading || save.isPending}
              onClick={() => save.mutate({ wallpaperMediaId: null }, { onSuccess: () => toast("Wallpaper removed.") })}>
              <span className="dm-set-icon" style={{ background: "#fa5252" }}><Trash2 size={17} /></span>
              <span className="dm-set-text"><strong>Remove wallpaper</strong></span>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pickWallpaper(e.target.files?.[0]); e.target.value = ""; }} />
        <p className="dm-set-note">Both of you see the theme. Your wallpaper is only visible to you.</p>

        <h3 className="dm-set-label">Notification sound</h3>
        <div className="dm-set-group" role="radiogroup" aria-label="Notification sound">
          {(Object.keys(MESSAGE_SOUNDS) as MessageSound[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={sound === id}
              className="dm-set-item"
              onClick={() => {
                setSound(id);
                setPeerSound(peer.id, id);
                previewSound(id);
              }}
            >
              <span className="dm-set-text"><strong>{MESSAGE_SOUNDS[id].name}</strong></span>
              {sound === id && <Check size={18} strokeWidth={2.6} className="dm-set-check" style={{ color: accent }} />}
            </button>
          ))}
        </div>
        <p className="dm-set-note">Plays for {trimmed || peer.displayName}&apos;s messages on this device while Circle is open.</p>
      </div>
    </Modal>
  );
}
