"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Keyboard, Loader2, Plus, Search, Sticker as StickerIcon, X } from "lucide-react";
import { api, upload, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import { ConfirmDialog } from "./ui";

type Sticker = Models["StickerDto"];
export type Gif = Models["GifDto"];

/** A sent GIF: a looping silent video when GIPHY offers one (lighter), else the animated image. */
export function GifView({ gif, className = "", maxWidth = 240 }: { gif: Gif; className?: string; maxWidth?: number }) {
  const [failed,setFailed]=useState<string|null>(null);
  const ratio = gif.width && gif.height ? `${gif.width}/${gif.height}` : undefined;
  return gif.mp4&&failed!==gif.mp4 ? (
    <video className={`gif-view ${className}`} src={gif.mp4} poster={gif.previewUrl} autoPlay loop muted playsInline
      aria-label={gif.title} style={{ aspectRatio: ratio, maxWidth }} onError={()=>setFailed(gif.mp4)} />
  ) : (
    <img className={`gif-view ${className}`} src={gif.url} alt={gif.title} style={{ aspectRatio: ratio, maxWidth }} loading="lazy" />
  );
}

/** GIPHY search (trending when empty), shown as a tab of the sticker tray. */
function GifPanel({ onPick, disabled }: { onPick: (gif: Gif) => void; disabled?: boolean }) {
  const [search, setSearch] = useState(""), [term, setTerm] = useState("");
  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const gifs = useInfiniteQuery({
    queryKey: ["gifs", term],
    queryFn: ({ pageParam, signal }) => api("gifsList", { query: { q: term || undefined, offset: pageParam }, signal }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 5 * 60_000,
  });
  const items = [...new Map((gifs.data?.pages.flatMap((page) => page.items) ?? []).map(gif=>[gif.id,gif])).values()];
  const enabled = gifs.data?.pages[0]?.enabled ?? true;
  // Loads more when the end comes into view, whichever element scrolls (tray or popover).
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = gifs;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);
  return (
    <div className="gif-panel">
      <label className="gif-search"><Search size={15} aria-hidden="true" />
        <input value={search} maxLength={50} placeholder="Search GIFs" aria-label="Search GIFs" onChange={(e) => setSearch(e.target.value)} />
      </label>
      {!enabled ? <p className="sticker-hint">GIFs aren’t set up on this server yet.</p>
        : gifs.isPending ? <p className="sticker-hint">Loading GIFs…</p>
        : gifs.error ? <div className="sticker-hint" role="alert"><p>{gifs.error.message}</p><button type="button" className="button secondary small" onClick={()=>void gifs.refetch()}>Retry GIFs</button></div>
        : items.length ? (
          <div className="gif-grid">
            {items.map((gif) => (
              <button type="button" key={gif.id} className="gif-option" disabled={disabled} aria-label={`Send GIF: ${gif.title}`} onClick={() => onPick(gif)}
                style={{ aspectRatio: `${gif.width}/${gif.height}` }}>
                <img src={gif.previewUrl} alt="" loading="lazy" />
              </button>
            ))}
            <div ref={sentinel} className="gif-sentinel" aria-hidden="true" />
            {isFetchingNextPage&&<span role="status" className="sticker-hint">Loading more GIFs…</span>}
          </div>
        ) : <p className="sticker-hint">No GIFs found. Try another word.</p>}
      {enabled && <small className="gif-credit">Powered by GIPHY</small>}
    </div>
  );
}

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
  onGif,
}: {
  disabled?: boolean;
  onPick: (sticker: Sticker) => void;
  conversation?:boolean;
  dock?:HTMLElement|null;
  /** Adds a GIFs tab (GIPHY search) that sends the chosen GIF. */
  onGif?: (gif: Gif) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Opens upwards when the composer sits near the bottom of the screen (e.g. Reels comments). */
  const [up, setUp] = useState(false);
  const [tab, setTab] = useState<"pack" | "mine" | "favorites" | "gifs">("pack");
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Sticker | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  const pointerActivated=useRef(false);
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
    // On click, not pointerdown: closing the tray moves the chat, and doing it mid-press would
    // make the press land elsewhere (e.g. a message's Reply button would lose its click).
    const close = (e: MouseEvent) => {
      const target=e.target as Node;
      // The message field hands over to the keyboard through focus, without a jump.
      if (conversation && target instanceof HTMLTextAreaElement) return;
      if (!box.current?.contains(target)&&!panel.current?.contains(target)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", close);
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
            {(onGif?(['pack','gifs','mine','favorites'] as const):(['pack','mine','favorites'] as const)).map(value=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>setTab(value)}>
              {value==='pack'?'Stickers':value==='gifs'?'GIFs':value==='mine'?'Yours':'Favorites'}
            </button>)}
          </div>
          {tab==='gifs'&&onGif?<GifPanel disabled={disabled} onPick={gif=>{haptic("tap");if(!conversation)setOpen(false);onGif(gif);}}/>:<>
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
          {tab==='mine'&&!mine.length&&<p className="sticker-hint">Create your own sticker from a photo or GIF. Transparent PNG/WebP keep their transparency; GIFs stay animated.</p>}
          {tab==='favorites'&&!favorites.length&&<p className="sticker-hint">Tap the star next to a sticker in a conversation to save it here.</p>}
          </>}
          <input ref={file} hidden type="file" accept="image/png,image/webp,image/jpeg,image/gif" onChange={e=>{const image=e.target.files?.[0];e.target.value='';if(image)create.mutate(image);}}/>
        </>;
  const toggleConversation=(button:HTMLButtonElement)=>{
    haptic('tap');
    const field=box.current?.closest('form')?.querySelector('textarea');
    if(open){setOpen(false);field?.focus({preventScroll:true});return;}
    const covered=keyboardOverlap();
    if(covered>150)rememberKeyboard(covered);
    setTrayHeight(covered>150?covered:rememberedKeyboard());
    setOverlap(covered);
    // Hand focus away from the editable field during the tap itself.
    field?.blur();
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    button.focus({preventScroll:true});
    setOpen(true);
  };
  return (
    <div className="sticker-picker-anchor" ref={box}>
      <button
        type="button"
        className="comment-sticker-button"
        aria-label={conversation&&open?"Show keyboard":"Send a sticker"}
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={event=>{
          if(!conversation||event.button!==0)return;
          event.preventDefault();
          pointerActivated.current=true;
          toggleConversation(event.currentTarget);
        }}
        onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')pointerActivated.current=false;}}
        onClick={event => {
          if(conversation){
            if(pointerActivated.current){pointerActivated.current=false;return;}
            toggleConversation(event.currentTarget);
            return;
          }
          const rect = box.current?.getBoundingClientRect();
          if (rect) setUp(window.innerHeight - rect.bottom < 360 && rect.top > 360);
          setOpen((o) => !o);
        }}
      >
        {conversation&&open?<Keyboard size={21}/>:<StickerIcon size={20} strokeWidth={1.75} />}
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
