"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-boot";

export type ThemePreference = "system" | "light" | "dark";
const COLORS = { light: "#f5f6f8", dark: "#0d0e11" } as const;

function stored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
function resolve(preference: ThemePreference) {
  return preference === "dark" || (preference === "system" && systemDark()) ? "dark" : "light";
}
/** Applies a preference to <html> and the browser chrome colour. */
function apply(preference: ThemePreference, animate: boolean) {
  const root = document.documentElement, theme = resolve(preference);
  if (animate) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
  }
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", COLORS[theme]));
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

/** The saved preference (system/light/dark) and the theme actually shown. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, stored, () => "system" as ThemePreference);
  const theme = useSyncExternalStore(subscribe, () => resolve(stored()), () => "light" as const);
  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next);
    } catch { /* storage unavailable: still switch for this visit */ }
    apply(next, true);
    listeners.forEach((listener) => listener());
  }, []);
  return { preference, theme, setPreference };
}

/** Follows the operating system while the preference is "system", and other tabs' changes. */
export function ThemeSync() {
  useEffect(() => {
    apply(stored(), false);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const system = () => { if (stored() === "system") { apply("system", true); listeners.forEach((l) => l()); } };
    const storage = (event: StorageEvent) => { if (event.key === THEME_KEY) { apply(stored(), true); listeners.forEach((l) => l()); } };
    media.addEventListener("change", system);
    window.addEventListener("storage", storage);
    return () => { media.removeEventListener("change", system); window.removeEventListener("storage", storage); };
  }, []);
  return null;
}
