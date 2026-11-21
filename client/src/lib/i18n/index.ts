"use client";
/**
 * Language: English (the source) or Turkish. Turkish is applied by a translator that rewrites
 * the interface text on the page (see components/translator.tsx); user content is never touched.
 */
import { useSyncExternalStore } from "react";
import { TR1 } from "./tr-1";
import { TR2 } from "./tr-2";
import { TR3 } from "./tr-3";
import { TR_PATTERNS, TR_REGEX } from "./tr-patterns";

export type Lang = "en" | "tr";
export const LANG_KEY = "circle-lang";

function stored(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const value = localStorage.getItem(LANG_KEY);
    if (value === "tr" || value === "en") return value;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export const getLang = stored;

/** Switches language. The page reloads so every screen starts fresh in the new language. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  window.location.reload();
}

const subscribe = (fn: () => void) => {
  const onStorage = (e: StorageEvent) => { if (e.key === LANG_KEY) fn(); };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, stored, () => "en");
}

/* ---------------------------------------------------------------------------------------------- */

const DICT = new Map<string, string>();
for (const part of [TR1, TR2, TR3]) for (const [en, tr] of Object.entries(part)) DICT.set(en.trim(), tr);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = TR_PATTERNS.map(([en, tr]) => ({
  re: new RegExp(`^${en.split("{}").map(escape).join("(.+?)")}$`),
  tr,
}));

function translateCore(core: string, depth = 0): string | null {
  const exact = DICT.get(core);
  if (exact !== undefined) return exact;
  for (const [re, fn] of TR_REGEX) {
    const m = core.match(re);
    if (m) return fn(...m);
  }
  if (depth > 0) return null;
  for (const p of PATTERNS) {
    const m = core.match(p.re);
    if (m) return p.tr.replace(/\{(\d)\}/g, (_, i) => {
      const part = m[Number(i) + 1] ?? "";
      return translateCore(part.trim(), depth + 1) ?? part;
    });
  }
  return null;
}

/** Turkish for one piece of interface text, or null when there is none. Keeps surrounding spaces. */
export function toTurkish(text: string): string | null {
  const core = text.trim();
  if (!core || !/[A-Za-z]/.test(core)) return null;
  const out = translateCore(core);
  if (out === null || out === core) return null;
  const start = text.indexOf(core);
  return text.slice(0, start) + out + text.slice(start + core.length);
}
