"use client";
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Models } from "@/lib/api/client";

export type AdminMe = Models["AdminMeDto"];
export type Role = Models["UserRole"];
export type Permission =
  | "users.read"
  | "users.email.read"
  | "users.update"
  | "users.warn"
  | "users.suspend"
  | "users.ban"
  | "users.roles.manage"
  | "admins.manage"
  | "posts.read"
  | "posts.moderate"
  | "comments.moderate"
  | "reels.moderate"
  | "media.manage"
  | "reports.read"
  | "reports.resolve"
  | "notifications.broadcast"
  | "analytics.read"
  | "settings.read"
  | "settings.update"
  | "audit.read"
  | "system.read";

export const STAFF_ROLES: Role[] = ["SUPPORT", "MODERATOR", "ADMIN", "SUPER_ADMIN"];
export const isStaff = (role?: Role | null) => !!role && STAFF_ROLES.includes(role);

/** The signed-in staff member. Permissions are enforced by the API; this only shapes the UI. */
export function useAdminMe(enabled = true) {
  return useQuery({
    queryKey: ["admin", "me"],
    queryFn: ({ signal }) => api("adminCoreMe", { signal }),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
export function useCan() {
  const me = useAdminMe();
  return useCallback(
    (...permissions: Permission[]) => !!me.data && permissions.every((p) => me.data.permissions.includes(p)),
    [me.data],
  );
}

/* ---------- Step-up (re-authentication) ---------- */

let stepUp: { token: string; expiresAt: number } | null = null;
/** In-memory only: never persisted, cleared on reload or rejection. */
export function currentStepUpToken() {
  if (stepUp && stepUp.expiresAt - 15_000 > Date.now()) return stepUp.token;
  stepUp = null;
  return null;
}
export function storeStepUp(token: string, expiresAt: string) {
  stepUp = { token, expiresAt: new Date(expiresAt).getTime() };
}
export function clearStepUp() {
  stepUp = null;
}
export const isStepUpError = (e: unknown) => e instanceof ApiError && e.code === "STEP_UP_REQUIRED";
export const stepUpHeaders = (): Record<string, string> => {
  const token = currentStepUpToken();
  return token ? { "X-Step-Up-Token": token } : {};
};

/* ---------- URL-backed filter state ---------- */

export function useUrlFilters<K extends string>(defaults: Partial<Record<K, string>> = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (key: K) => params.get(key) ?? defaults[key] ?? "";
  const set = (patch: Partial<Record<K | "page", string | number | null | undefined>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "" || v === defaults[k as K]) next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  const page = Math.max(1, Number(params.get("page")) || 1);
  return { get, set, page, params };
}
/** Drops empty values so they never reach the query string. */
export function compact<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null)) as {
    [K in keyof T]?: Exclude<T[K], "" | null>;
  };
}

/* ---------- Formatting ---------- */

const nf = new Intl.NumberFormat("en");
export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : nf.format(n));
export function compactNumber(n: number) {
  return Math.abs(n) >= 1000 ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : String(n);
}
export function bytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}
export function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en", { dateStyle: "medium" });
}
export function duration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function uptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(" ");
}
export const humanize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[_.]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

export const REPORT_REASONS: Models["ReportReason"][] = [
  "SPAM",
  "HARASSMENT",
  "HATE_SPEECH",
  "VIOLENCE",
  "NUDITY",
  "SELF_HARM",
  "MISINFORMATION",
  "IMPERSONATION",
  "INTELLECTUAL_PROPERTY",
  "OTHER",
];

/** Date range presets used by analytics filters (UTC day boundaries). */
export function rangeFor(preset: string): { from: string; to: string; interval: "day" | "week" | "month" } {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[preset] ?? 30;
  const start = new Date(end.getTime() - days * 86_400_000);
  return { from: start.toISOString(), to: end.toISOString(), interval: days > 120 ? "week" : "day" };
}
