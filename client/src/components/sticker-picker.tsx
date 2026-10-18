"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Sticker as StickerIcon, X } from "lucide-react";
import { api, upload, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import { ConfirmDialog } from "./ui";

type Sticker = Models["StickerDto"];

/** A sticker as shown in comments and in the picker. */
export function StickerView({ sticker, size = 96 }: { sticker: Sticker; size?: number }) {
  return sticker.emoji ? (
    <span
      className="sticker-view emoji"
      style={{ fontSize: size * 0.78, width: size, height: size }}
      role="img"
      aria-label={`${sticker.name} sticker`}
    >
      {sticker.emoji}
    </span>
  ) : (
    <img
      className="sticker-view"
      src={sticker.url ?? undefined}
      alt={`${sticker.name} sticker`}
      width={size}
      height={size}
      draggable={false}
    />
  );
}

export function useStickers(enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["stickers", user?.id],
    queryFn: ({ signal }) => api("stickersList", { signal }),
    enabled: enabled && !!user,
    staleTime: 60_000,
  });
}

/**
 * Sticker button + popover for the comment composer: the built-in pack and the viewer's own
 * stickers, which they can create from a photo or delete.
 */
export function StickerButton({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (sticker: Sticker) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Opens upwards when the composer sits near the bottom of the screen (e.g. Reels comments). */
  const [up, setUp] = useState(false);
  const [tab, setTab] = useState<"pack" | "mine">("pack");
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Sticker | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const toast = useToast();
  const stickers = useStickers(open);
  const pack = stickers.data?.filter((s) => !s.isOwn) ?? [];
  const mine = stickers.data?.filter((s) => s.isOwn) ?? [];
  useEffect(() => {
    if (!open || removing) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, removing]);
  const create = useMutation({
    mutationFn: async (image: File) => {
      setProgress(0);
      const media = (await upload(image, setProgress)) as Models["MediaDto"];
      try {
        return await api("stickersCreate", {
          body: { mediaId: media.id, name: image.name.replace(/\.[^.]+$/, "").slice(0, 40) || undefined },
        });
      } catch (e) {
        // Do not leave the uploaded photo behind when the sticker could not be created.
        void api("mediaRemove", { params: { id: media.id } }).catch(() => {});
        throw e;
      }
    },
    onSuccess: () => {
      haptic("success");
      toast("Sticker created.");
      void client.invalidateQueries({ queryKey: ["stickers"] });
    },
    onError: (e) => toast(e.message, true),
    onSettled: () => setProgress(null),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api("stickersDelete", { params: { id } }),
    onSuccess: () => {
      setRemoving(null);
      toast("Sticker deleted.");
      void client.invalidateQueries({ queryKey: ["stickers"] });
    },
    onError: (e) => toast(e.message, true),
  });
  const pick = (sticker: Sticker) => {
    haptic("tap");
    setOpen(false);
    onPick(sticker);
  };
  const shown = tab === "pack" ? pack : mine;
  return (
    <div className="sticker-picker-anchor" ref={box}>
      <button
        type="button"
        className="comment-sticker-button"
        aria-label="Send a sticker"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          const rect = box.current?.getBoundingClientRect();
          if (rect) setUp(window.innerHeight - rect.bottom < 360 && rect.top > 360);
          setOpen((o) => !o);
        }}
      >
        <StickerIcon size={17} />
      </button>
      {open && (
        <div className={`sticker-picker ${up ? "up" : ""}`} role="dialog" aria-label="Stickers">
          <div className="sticker-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "pack"} onClick={() => setTab("pack")}>
              Stickers
            </button>
            <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
              Your stickers{mine.length ? ` (${mine.length})` : ""}
            </button>
          </div>
          {stickers.isPending && <p className="sticker-hint">Loading stickers...</p>}
          {stickers.error && <p className="sticker-hint" role="alert">{stickers.error.message}</p>}
          <div className="sticker-grid">
            {tab === "mine" && (
              <button
                type="button"
                className="sticker-create"
                aria-label="Create a sticker from a photo"
                disabled={create.isPending}
                onClick={() => file.current?.click()}
              >
                {create.isPending ? (
                  <>
                    <Loader2 size={20} className="spin" />
                    <small>{progress ?? 0}%</small>
                  </>
                ) : (
                  <>
                    <Plus size={22} />
                    <small>Create</small>
                  </>
                )}
              </button>
            )}
            {shown.map((sticker) => (
              <div className="sticker-cell" key={sticker.id}>
                <button type="button" className="sticker-option" title={sticker.name} onClick={() => pick(sticker)}>
                  <StickerView sticker={sticker} size={56} />
                </button>
                {sticker.isOwn && (
                  <button
                    type="button"
                    className="sticker-remove"
                    aria-label={`Delete ${sticker.name} sticker`}
                    onClick={() => setRemoving(sticker)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {tab === "mine" && !mine.length && !create.isPending && (
            <p className="sticker-hint">Turn any photo into a sticker. PNG or WebP with a transparent background looks best.</p>
          )}
          <input
            ref={file}
            hidden
            type="file"
            accept="image/png,image/webp,image/jpeg,image/gif"
            onChange={(e) => {
              const image = e.target.files?.[0];
              e.target.value = "";
              if (image) create.mutate(image);
            }}
          />
        </div>
      )}
      {removing && (
        <ConfirmDialog
          title="Delete this sticker?"
          description="It leaves your sticker tray. Comments that already use it keep showing it."
          confirmLabel="Delete sticker"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
