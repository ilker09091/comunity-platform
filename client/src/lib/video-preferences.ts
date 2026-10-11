"use client";
import { useSyncExternalStore } from "react";
import { videoPlayback } from "./video-playback-coordinator";
export type VideoPreferences = { startMuted: boolean };
export const VIDEO_PREFERENCES_KEY = "circle.video-preferences.v1";
const defaults: VideoPreferences = { startMuted: true };
let snapshot = defaults, initialized = false;
const listeners = new Set<() => void>();
function read() {
  try {
    const value = JSON.parse(window.localStorage.getItem(VIDEO_PREFERENCES_KEY) ?? "null");
    return typeof value?.startMuted === "boolean" ? value.startMuted : true;
  } catch { return true; }
}
export function getVideoPreferences() {
  if (typeof window !== "undefined" && !initialized) { initialized = true; snapshot = { startMuted: read() }; }
  return snapshot;
}
function publish(startMuted: boolean) {
  if (snapshot.startMuted !== startMuted) snapshot = { startMuted };
  videoPlayback.applyAudioPreference(startMuted);
  for (const notify of listeners) notify();
}
/** Only explicit user choices are persisted; autoplay recovery must never call this. */
export function setVideoStartMuted(startMuted: boolean) {
  initialized = true;
  let persisted = true;
  try { window.localStorage.setItem(VIDEO_PREFERENCES_KEY, JSON.stringify({ startMuted })); }
  catch { persisted = false; }
  publish(startMuted);
  return persisted;
}
function storageChanged(event: StorageEvent) {
  if (event.key === VIDEO_PREFERENCES_KEY || event.key === null) publish(read());
}
export function subscribeVideoPreferences(notify: () => void) {
  getVideoPreferences();
  if (!listeners.size) window.addEventListener("storage", storageChanged);
  listeners.add(notify);
  return () => { listeners.delete(notify); if (!listeners.size) window.removeEventListener("storage", storageChanged); };
}
export function useVideoPreferences() {
  return useSyncExternalStore(subscribeVideoPreferences, getVideoPreferences, () => defaults);
}
