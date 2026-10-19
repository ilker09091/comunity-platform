"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Keyboard, Loader2, Plus, Sticker as StickerIcon, X } from "lucide-react";
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
 * On-screen keyboard tracking for the WhatsApp-style tray: the tray takes over exactly the space
 * the keyboard used, so the composer does not jump when one replaces the other.
 */
let viewportWidth = 0, fullHeight = 0;
function keyboardOverlap() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  // A rotation changes the full height; start measuring again.
  if (window.innerWidth !== viewportWidth) { viewportWidth = window.innerWidth; fullHeight = height; }
  fullHeight = Math.max(fullHeight, height);
  return Math.max(0, Math.round(fullHeight - height));
}
const KEYBOARD_KEY = "dm-keyboard-height";
function rememberedKeyboard() {
  let saved = 0;
  try { saved = Number(localStorage.getItem(KEYBOARD_KEY)) || 0; } catch { /* storage unavailable */ }
  const fallback = Math.min(340, Math.max(260, Math.round(window.innerHeight * 0.38)));
  return Math.min(Math.round(window.innerHeight * 0.6), saved >= 180 ? saved : fallback);
}
function rememberKeyboard(height: number) {
  try { localStorage.setItem(KEYBOARD_KEY, String(height)); } catch { /* storage unavailable */ }
}

/**
 * Sticker button + popover for the comment composer: the built-in pack and the viewer's own
 * stickers, which they can create from a photo or delete.
 */
export function StickerButton({
  disabled,
  onPick,
  conversation = false,
  dock,
}: {
  disabled?: boolean;
  onPick: (sticker: Sticker) => void;
  conversation?:boolean;
  dock?:HTMLElement|null;
}) {
  const [open, setOpen] = useState(false);
  /** Opens upwards when the composer sits near the bottom of the screen (e.g. Reels comments). */
  const [up, setUp] = useState(false);
  const [tab, setTab] = useState<"pack" | "mine" | "favorites">("pack");
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Sticker | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  /** Conversation tray: its full height, and how much of it the keyboard still covers. */
  const [trayHeight,setTrayHeight]=useState(0);
  const [overlap,setOverlap]=useState(0);
  const client = useQueryClient();
  const toast = useToast();
  const stickers = useStickers(open);
  const pack = stickers.data?.filter((s) => !!s.emoji) ?? [];
  const mine = stickers.data?.filter((s) => s.isOwn) ?? [];
  const favorites = stickers.data?.filter(s=>s.isFavorite)??[];
  // Learn the keyboard height while typing, so the tray can open at the same size.
  useEffect(() => {
    if (!conversation) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const covered = keyboardOverlap();
      if (covered > 150 && document.activeElement instanceof HTMLTextAreaElement) rememberKeyboard(covered);
    };
    measure();
    viewport?.addEventListener("resize", measure);
    return () => viewport?.removeEventListener("resize", measure);
  }, [conversation]);
  // While the tray is open, it grows as the keyboard slides away and shrinks as it comes back.
  useEffect(() => {
    if (!open || !conversation) return;
    const viewport = window.visualViewport;
    let closing: number | undefined;
    const update = () => {
      const covered = keyboardOverlap();
      setOverlap(covered);
      if (closing !== undefined && covered > 150) {
        rememberKeyboard(covered);
        window.clearTimeout(closing);
        setOpen(false);
      }
    };
    // Tapping the message field brings the keyboard back in place of the tray.
    const focus = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) || panel.current?.contains(target)) return;
      if (closing !== undefined) return;
      closing = window.setTimeout(() => setOpen(false), 450);
    };
    update();
    viewport?.addEventListener("resize", update);
    document.addEventListener("focusin", focus);
    return () => {
      window.clearTimeout(closing);
      viewport?.removeEventListener("resize", update);
      document.removeEventListener("focusin", focus);
    };
  }, [open, conversation]);
  useEffect(() => {
    if (!open || removing) return;
    const close = (e: PointerEvent) => {
      const target=e.target as Node;
      // The message field hands over to the keyboard through focus, without a jump.
      if (conversation && target instanceof HTMLTextAreaElement) return;
      if (!box.current?.contains(target)&&!panel.current?.contains(target)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, removing, conversation]);
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
    if(!conversation)setOpen(false);
    onPick(sticker);
  };
  const shown = tab === "pack" ? pack : tab==='mine'?mine:favorites;
  const content=<>
          <div className="sticker-tabs" role="tablist">
            {(['pack','mine','favorites'] as const).map(value=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>setTab(value)}>
              {value==='pack'?'Stickers':value==='mine'?'Your stickers':'Favorites'}
            </button>)}
          </div>
          {stickers.isPending && <p className="sticker-hint">Loading stickers...</p>}
          {stickers.error && <p className="sticker-hint" role="alert">{stickers.error.message}</p>}
          <div className="sticker-grid">
            {tab === 'mine' && <button type="button" className="sticker-create" aria-label="Create a sticker from a photo" disabled={create.isPending} onClick={()=>file.current?.click()}>
              {create.isPending?<><Loader2 size={20} className="spin"/><small>{progress??0}%</small></>:<><Plus size={22}/><small>Create</small></>}
            </button>}
            {shown.map(sticker=><div className="sticker-cell" key={sticker.id}>
              <button type="button" className="sticker-option" disabled={disabled} aria-label={`Send ${sticker.name} sticker`} onClick={()=>pick(sticker)}><StickerView sticker={sticker} size={56}/></button>
              {sticker.isOwn&&<button type="button" className="sticker-remove" aria-label={`Delete ${sticker.name} sticker`} onClick={()=>setRemoving(sticker)}><X size={12}/></button>}
            </div>)}
          </div>
          {tab==='mine'&&!mine.length&&<p className="sticker-hint">Create your own sticker from a photo. Transparent PNG or WebP images keep their background transparency.</p>}
          {tab==='favorites'&&!favorites.length&&<p className="sticker-hint">Tap the star next to a sticker in a conversation to save it here.</p>}
          <input ref={file} hidden type="file" accept="image/png,image/webp,image/jpeg,image/gif" onChange={e=>{const image=e.target.files?.[0];e.target.value='';if(image)create.mutate(image);}}/>
        </>;
  return (
    <div className="sticker-picker-anchor" ref={box}>
      <button
        type="button"
        className="comment-sticker-button"
        aria-label={conversation&&open?"Show keyboard":"Send a sticker"}
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={event=>{if(conversation)event.preventDefault();}}
        onClick={() => {
          if(conversation){
            haptic("tap");
            const field=box.current?.closest("form")?.querySelector("textarea");
            // WhatsApp: the button toggles between the sticker tray and the keyboard.
            if(open){field?.focus({preventScroll:true});if(!field)setOpen(false);return;}
            const typing=document.activeElement instanceof HTMLTextAreaElement||document.activeElement instanceof HTMLInputElement;
            const covered=keyboardOverlap();
            setTrayHeight(typing&&covered>150?covered:rememberedKeyboard());
            setOverlap(covered);
            setOpen(true);
            if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
            return;
          }
          const rect = box.current?.getBoundingClientRect();
          if (rect) setUp(window.innerHeight - rect.bottom < 360 && rect.top > 360);
          setOpen((o) => !o);
        }}
      >
        {conversation&&open?<Keyboard size={19}/>:<StickerIcon size={17} />}
      </button>
      {open && conversation&&dock?createPortal(<div ref={panel} className="dm-sticker-tray" role="region" aria-label="Stickers"
        style={{height:Math.max(0,trayHeight-overlap)}}
        onPointerDown={event=>{if(!(event.target instanceof HTMLInputElement))event.preventDefault();}}>
        <div className="dm-sticker-tray-inner" style={{height:trayHeight}}>
          <div className="dm-sticker-library">{content}</div>
        </div>
      </div>,dock):open && !conversation && (
        <div className={`sticker-picker ${up ? "up" : ""}`} role="dialog" aria-label="Stickers">{content}</div>
      )}
      {removing && (
        <ConfirmDialog
          title="Delete this sticker?"
          description="It leaves your sticker tray. Messages, comments and favorites that already use it keep showing it."
          confirmLabel="Delete sticker"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
