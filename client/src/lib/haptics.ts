"use client";

/** Short tactile pulses for key interactions on supporting devices. */
const PATTERNS = {
  tap: 10,
  success: [12, 40, 12],
  warn: [20, 40, 20, 40, 20],
  error: [50, 80, 50],
} as const;

export function haptic(kind: keyof typeof PATTERNS = "tap") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const pattern = PATTERNS[kind];
  try { navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]); } catch { /* iOS Safari rejects quietly */ }
}
