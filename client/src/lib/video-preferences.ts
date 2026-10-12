"use client";
import { useSyncExternalStore } from "react";
import { videoPlayback } from "./video-playback-coordinator";
export type VideoPreferences = { startMuted: boolean; volume: number };
export const VIDEO_PREFERENCES_KEY = "circle.video-preferences.v1";
const defaults: VideoPreferences = { startMuted: true, volume: 1 };
let snapshot = defaults, initialized = false;
const listeners = new Set<() => void>();
function read(): VideoPreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(VIDEO_PREFERENCES_KEY) ?? "null");
    const startMuted = typeof value?.startMuted === "boolean" ? value.startMuted : true;
    const volume = typeof value?.volume === "number" && value.volume >= 0 && value.volume <= 1 ? value.volume : 1;
    return { startMuted, volume };
  } catch { return defaults; }
}
export function getVideoPreferences() {
  if (typeof window !== "undefined" && !initialized) { initialized = true; snapshot = read(); }
  return snapshot;
}
function persist(prefs: VideoPreferences) {
  try { window.localStorage.setItem(VIDEO_PREFERENCES_KEY, JSON.stringify(prefs)); return true; }
  catch { return false; }
}
function publish(prefs: VideoPreferences) {
  snapshot = prefs;
  videoPlayback.applyAudioPreference(prefs.startMuted, prefs.volume);
  for (const notify of listeners) notify();
}
export function setVideoStartMuted(startMuted: boolean) {
  initialized = true;
  const next = { ...snapshot, startMuted };
  const persisted = persist(next);
  publish(next);
  return persisted;
}
export function setVideoVolume(volume: number) {
  initialized = true;
  const clamped = Math.max(0, Math.min(1, volume));
  const next = { ...snapshot, volume: clamped, startMuted: clamped === 0 };
  const persisted = persist(next);
  publish(next);
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
