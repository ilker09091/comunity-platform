"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { haptic } from "@/lib/haptics";

type Ambience = "sparkles" | "motes" | "fireflies" | "petals" | "stars" | "bubbles" | "hearts" | "fizz";
type ChatThemeMeta = {
  id: string;
  name: string;
  /** Light or dark glass over the photo, which decides text and bubble colors. */
  scheme: "light" | "dark";
  /** Your bubbles and buttons: a solid color picked from the photo. */
  accent: string | null;
  /** Average color of the photo, shown while it loads. */
  base: string | null;
  ambience: Ambience | null;
};

/**
 * Ids match the server's list; each photo lives in /public/chatthemes (`<id>.webp` plus a
 * `<id>-thumb.webp` for the picker). Aurora (Abhi Verma), Candy (Scott Goodwill) and Citrus
 * (Maxence Pira) are from Unsplash under the Unsplash License.
 */
export const CHAT_THEMES = [
  { id: "default", name: "Classic", scheme: "light", accent: null, base: null, ambience: null },
  { id: "ocean", name: "Ocean", scheme: "dark", accent: "#1098ad", base: "#0d2c5d", ambience: "sparkles" },
  { id: "sunset", name: "Sunset", scheme: "dark", accent: "#f76707", base: "#3d2c3e", ambience: "motes" },
  { id: "forest", name: "Forest", scheme: "dark", accent: "#0ca678", base: "#0d3e4e", ambience: "fireflies" },
  { id: "lavender", name: "Lavender", scheme: "light", accent: "#7950f2", base: "#d3c0e3", ambience: "petals" },
  { id: "midnight", name: "Midnight", scheme: "dark", accent: "#4c6ef5", base: "#081239", ambience: "stars" },
  { id: "candy", name: "Candy", scheme: "light", accent: "#e64980", base: "#e7d3cf", ambience: "bubbles" },
  { id: "aurora", name: "Aurora", scheme: "dark", accent: "#12b886", base: "#242739", ambience: "stars" },
  { id: "love", name: "Love", scheme: "dark", accent: "#d6336c", base: "#440349", ambience: "hearts" },
  { id: "citrus", name: "Citrus", scheme: "light", accent: "#2b8a3e", base: "#d9ba03", ambience: "fizz" },
] as const satisfies readonly ChatThemeMeta[];
export type ChatThemeId = (typeof CHAT_THEMES)[number]["id"];

export const themeMeta = (id: string): ChatThemeMeta => CHAT_THEMES.find((t) => t.id === id) ?? CHAT_THEMES[0];
export const themePhoto = (id: string) => (id === "default" ? null : `/chatthemes/${id}.webp`);
const themeThumb = (id: string) => (id === "default" ? null : `/chatthemes/${id}-thumb.webp`);

/**
 * Attributes for the chat section: the theme's colors as CSS variables, and whether the glass
 * over the photo is light or dark. A personal wallpaper is dimmed, so it always reads as dark.
 */
export function themeAttributes(id: string, wallpaperUrl: string | null) {
  const meta = themeMeta(id);
  const style: Record<string, string> = {};
  if (meta.accent) Object.assign(style, { "--chat-a": meta.accent, "--chat-b": meta.accent, "--chat-own": meta.accent });
  if (meta.base) style["--chat-canvas"] = meta.base;
  const immersive = !!wallpaperUrl || id !== "default";
  return {
    "data-chat-theme": id,
    "data-scheme": immersive ? (wallpaperUrl ? "dark" : meta.scheme) : undefined,
    "data-immersive": immersive ? "" : undefined,
    style: style as CSSProperties,
  };
}

/** Index-based "random" so particles look scattered but render the same every time. */
const scatter = (i: number, a: number, b: number) => ((i * a + b) % 97) / 97;

/**
 * The scene behind the messages: the theme photo (or your wallpaper) and a few slow particles
 * that give each theme its mood. It fades in when the theme changes.
 */
export function ThemeStage({ theme, wallpaperUrl }: { theme: string; wallpaperUrl: string | null }) {
  const meta = themeMeta(theme);
  const photo = wallpaperUrl ?? themePhoto(theme);
  if (!photo) return null;
  const ambience = wallpaperUrl ? null : meta.ambience;
  return (
    <div className="dm-theme-stage" aria-hidden="true">
      <div key={photo} className="dm-theme-photo" style={{ backgroundImage: `url("${photo}")` }} />
      <div className="dm-theme-shade" />
      {ambience && (
        <div key={theme} className={`dm-ambience ${ambience}`}>
          {Array.from({ length: 16 }, (_, i) => (
            <span
              key={i}
              style={{
                "--x": `${Math.round(scatter(i, 37, 11) * 100)}%`,
                "--y": `${Math.round(scatter(i, 53, 29) * 100)}%`,
                "--d": `${(7 + scatter(i, 17, 5) * 9).toFixed(1)}s`,
                "--delay": `${(-scatter(i, 29, 41) * 14).toFixed(1)}s`,
                "--s": (0.6 + scatter(i, 13, 7) * 0.9).toFixed(2),
              } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Telegram-style theme tray: slides up over the composer, and the chat behind it previews each
 * theme as you tap it. Nothing changes for the other person until "Apply".
 */
export function ThemeTray({
  current,
  value,
  onChange,
  onApply,
  onCancel,
}: {
  current: ChatThemeId;
  value: ChatThemeId;
  onChange: (theme: ChatThemeId) => void;
  onApply: (theme: ChatThemeId) => void;
  onCancel: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Warm the photos up so previews switch instantly.
  useEffect(() => {
    for (const theme of CHAT_THEMES) {
      const src = themePhoto(theme.id);
      if (src) new Image().src = src;
    }
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);
  const changed = value !== current;
  return (
    <div className="dm-theme-tray" role="dialog" aria-label="Chat theme">
      <div className="dm-theme-tray-head">
        <button type="button" className="dm-theme-tray-close" aria-label="Cancel" onClick={onCancel}>
          <X size={20} />
        </button>
        <strong>Chat theme</strong>
        <span />
      </div>
      <div className="dm-theme-cards" ref={list} role="radiogroup" aria-label="Themes">
        {CHAT_THEMES.map((theme) => {
          const thumb = themeThumb(theme.id);
          const selected = value === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`dm-theme-card ${selected ? "selected" : ""}`}
              data-scheme={theme.scheme}
              style={{ "--card-accent": theme.accent ?? "var(--primary)", "--card-base": theme.base ?? "var(--dm-canvas, #eef2f7)" } as CSSProperties}
              onClick={() => {
                haptic("tap");
                onChange(theme.id);
              }}
            >
              <span className="dm-theme-card-art" style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}>
                <i className="in" />
                <i className="own" />
                {selected && (
                  <b className="dm-theme-card-check">
                    <Check size={13} strokeWidth={3} />
                  </b>
                )}
              </span>
              <small>{theme.name}</small>
            </button>
          );
        })}
      </div>
      <button type="button" className="dm-theme-tray-apply" disabled={!changed} onClick={() => onApply(value)}>
        {changed ? `Apply ${themeMeta(value).name}` : "Current theme"}
      </button>
      <p className="dm-theme-tray-note">Both of you will see this theme.</p>
    </div>
  );
}
