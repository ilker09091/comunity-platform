"use client";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Clapperboard, Loader2, Maximize, Pause, Play, RotateCcw, VideoOff, Volume2, VolumeX, Volume1 } from "lucide-react";
import type { Models } from "@/lib/api/client";
import { prefersReducedData, videoPlayback, type PlaybackMode } from "@/lib/video-playback-coordinator";
import { MediaVideo, videoDiagnostic } from "./media-video";
import { getVideoPreferences, setVideoStartMuted, setVideoVolume, useVideoPreferences } from "@/lib/video-preferences";

const ERRORS: Record<number, string> = {
  1: "Playback was interrupted. Try again.", 2: "Check your connection and retry the download.",
  3: "Your browser could not decode this video.", 4: "This video source or format is unavailable.",
};
const subscribe = () => () => {};
function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
export type VideoPlayerProps = {
  media: Models["MediaDto"]; mode: PlaybackMode; active?: boolean;
  preload?: "auto" | "metadata" | "none"; label: string; openInReelsHref?: string;
  onRefreshSource?: () => Promise<unknown>;
  onAspectRatio?: (ratio: number) => void;
  onPlayback?: (kind: import("@/lib/reel-watch").PlaybackSignal, video: HTMLVideoElement) => void;
  /**
   * Reels: whether this is the reel the viewer is on (independent of dialogs pausing it). Coming back
   * after watching other reels for a while restarts it; a quick swipe back and forth resumes it.
   */
  current?: boolean;
};
/** Away longer than this → the reel starts over when the viewer returns to it. */
const REEL_RESTART_AFTER_MS = 2500;

/** Shared ownership, autoplay recovery and controls; presentation stays context-specific. */
export default function VideoPlayerCore({ media, mode, active = true, preload = "metadata", label, openInReelsHref, onRefreshSource, onAspectRatio, onPlayback, current }: VideoPlayerProps) {
  const route = usePathname();
  const prefs = useVideoPreferences();
  const video = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null);
  const intentionalPause = useRef(false), finished = useRef(false), generation = useRef(0), position = useRef(0);
  const [sourceAllowed, setSourceAllowed] = useState(mode === "reels");
  const [selected, setSelected] = useState(false), [muted, setMuted] = useState(true);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const seekInput = useRef<HTMLInputElement>(null), timeLabel = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(true), [blocked, setBlocked] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [loading, setLoading] = useState(true), [frame, setFrame] = useState(false), [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null), [retrying, setRetrying] = useState(false);
  const [ended, setEnded] = useState(false), [duration, setDuration] = useState(0);
  const [nativeRatio, setNativeRatio] = useState<number | null>(null);
  const reducedData = useSyncExternalStore(subscribe, prefersReducedData, () => false);
  const fullscreenSupported = useSyncExternalStore(subscribe, () => !!document.fullscreenEnabled || !!(video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen, () => false);
  const attached = sourceAllowed && (!reducedData || selected || mode === "reels" && active && preload !== "none");
  const ratio = nativeRatio ?? (media.width && media.height ? media.width / media.height : 16 / 9);
  const changeMuted = (value: boolean) => setVideoStartMuted(value);
  const play = useCallback(async (manual = false) => {
    const el = video.current;
    if (!el || !videoPlayback.owns(el) || intentionalPause.current || finished.current || (!manual && reducedData)) return;
    if (!manual && !el.paused) return;
    const prefs = getVideoPreferences();
    el.muted = prefs.startMuted;
    el.volume = prefs.volume;
    setMuted(el.muted); setSoundBlocked(false);
    const run = ++generation.current;
    const failed = (reason: unknown) => {
      if (run !== generation.current || !videoPlayback.owns(el)) return;
      videoDiagnostic(el, "play-rejected", reason);
      if (reason instanceof Error && reason.name === "AbortError") return;
      setLoading(false); setPaused(true);
      if (reason instanceof Error && reason.name === "NotAllowedError") setBlocked(true); else setError(ERRORS[el.error?.code ?? 4]);
    };
    try {
      await el.play();
      if (!videoPlayback.owns(el)) { el.pause(); return; }
      if (run === generation.current) { setBlocked(false); setPaused(false); }
    } catch (reason) {
      if (run !== generation.current || !videoPlayback.owns(el)) return;
      if (reason instanceof Error && reason.name === "NotAllowedError" && !el.muted) {
        // Browser permission is temporary; preserve the user's saved sound preference.
        el.muted = true; setMuted(true); setSoundBlocked(true);
        try {
          await el.play();
          if (!videoPlayback.owns(el)) { el.pause(); return; }
          if (run === generation.current) { setBlocked(false); setPaused(false); }
        }
        catch (fallback) { failed(fallback); }
      } else failed(reason);
    }
  }, [reducedData]);
  const selectionChanged = useEffectEvent((value: boolean, manual: boolean) => {
    setSelected(value);
    if (!value) { generation.current++; video.current?.pause(); setPaused(true); }
    else if (!manual && video.current?.hasAttribute("src")) void play();
  });
  const visibilityChanged = useEffectEvent((value: number) => {
    // Manual pause survives ownership changes, modals and tab hiding; a complete viewport exit resets it.
    if (value < .01) { intentionalPause.current = false; finished.current = false; setUserPaused(false); }
  });
  const sourceChanged = useEffectEvent((value: boolean) => { if (!value && video.current) position.current = video.current.currentTime; setSourceAllowed(value); });
  const audioChanged = useEffectEvent((value: boolean) => { if (video.current) video.current.muted = value; setMuted(value); setSoundBlocked(false); });
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    audioChanged(getVideoPreferences().startMuted);
    return videoPlayback.register(el, { mode, route, requested: false, select: selectionChanged, visibility: visibilityChanged, sourcePermission: sourceChanged, audioPreference: audioChanged });
  }, [mode, route, media.id]);
  useEffect(() => { if (video.current) videoPlayback.update(video.current, active); }, [active, route, media.id]);
  useEffect(() => { const token = generation; if (attached && video.current && videoPlayback.owns(video.current)) void play(); return () => { token.current++; }; }, [attached, media.url, play]);
  const toggle = () => {
    const el = video.current;
    if (!el || error) return;
    if (!paused && !blocked && !ended) { intentionalPause.current = true; generation.current++; el.pause(); setPaused(true); setUserPaused(true); }
    else if (videoPlayback.claim(el)) {
      intentionalPause.current = false; finished.current = false;
      setUserPaused(false);
      if (ended) { el.currentTime = 0; position.current = 0; }
      setEnded(false); setBlocked(false);
      // Attach within the trusted gesture so mobile browsers retain playback permission.
      if (!el.hasAttribute("src")) { el.setAttribute("src", media.url); el.load(); }
      void play(true);
    }
  };
  const seek = (value: number) => {
    const el = video.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.max(0, Math.min(el.duration, value)); position.current = el.currentTime; updateProgress(el);
    finished.current = false; setEnded(false);
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else (video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
    } catch { /* Denial leaves inline playback usable. */ }
  };
  const retry = async () => {
    if (retrying) return;
    setRetrying(true); setError(null); setLoading(true); setStalled(false); setUserPaused(false); intentionalPause.current = false; finished.current = false;
    try { await onRefreshSource?.(); const el = video.current; if (el && videoPlayback.claim(el)) { el.load(); await play(true); } }
    catch { setError("The video could not be refreshed. Check your connection and retry."); setLoading(false); }
    finally { setRetrying(false); }
  };
  const diagnostic = (event: string) => { if (video.current) videoDiagnostic(video.current, event); };
  const updateProgress = (el: HTMLVideoElement) => {
    const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const current = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    // An empty source reports zero before metadata; keep the position saved for re-entry.
    if (total || el.readyState >= 1) position.current = current;
    if (seekInput.current) {
      seekInput.current.value = String(current);
      seekInput.current.style.setProperty("--video-progress", `${total ? Math.min(100, current / total * 100) : 0}%`);
      seekInput.current.setAttribute("aria-valuetext", `${clock(current)} of ${total ? clock(total) : "unknown duration"}`);
    }
    if (timeLabel.current) timeLabel.current.textContent = `${clock(current)} / ${total ? clock(total) : "--:--"}`;
  };
  const drawProgress = useEffectEvent((el: HTMLVideoElement) => updateProgress(el));
  const awaySince = useRef<number | null>(null);
  const returned = useEffectEvent(() => {
    const since = awaySince.current;
    awaySince.current = null;
    if (since === null || performance.now() - since < REEL_RESTART_AFTER_MS) return; // quick back-and-forth: resume
    position.current = 0;
    finished.current = false;
    setEnded(false);
    const el = video.current;
    if (el && el.currentTime > 0) {
      el.currentTime = 0;
      updateProgress(el);
    }
  });
  useEffect(() => {
    if (mode !== "reels" || current === undefined) return;
    if (current) returned();
    else awaySince.current = performance.now();
  }, [current, mode]);
  useEffect(() => {
    const el = video.current;
    if (!el || !selected || paused) return;
    // Update only the two progress DOM nodes, without rendering the carousel on each frame.
    let frameId: number;
    const draw = () => { drawProgress(el); frameId = window.requestAnimationFrame(draw); };
    frameId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frameId);
  }, [selected, paused]);
  return <div ref={container} className={`video-player video-player-${mode} ${mode === "reels" ? "reel-player" : ""} ${paused ? "is-paused" : "is-playing"}`} data-reel-tap={mode === "reels" || undefined}
    style={mode === "feed" ? { aspectRatio: ratio, maxWidth: `min(100%, calc(75dvh * ${ratio}))` } : undefined}
    onKeyDown={e => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); seek((video.current?.currentTime ?? 0) + (e.key === "ArrowLeft" ? -5 : 5)); }
      if (e.key.toLowerCase() === "m") { e.preventDefault(); e.stopPropagation(); changeMuted(!muted); }
      if (e.key.toLowerCase() === "f" && fullscreenSupported) { e.preventDefault(); void fullscreen(); }
    }}>
    <MediaVideo ref={video} className={mode === "reels" ? "reel-video" : "feed-video"} src={attached ? media.url : undefined}
      preload={attached ? selected && !reducedData ? "auto" : reducedData ? "none" : preload : "none"} muted={muted} loop={mode === "reels"} playsInline aria-label={label}
      onLoadStart={() => { setLoading(true); setFrame(false); setDuration(0); }} onLoadedData={() => setFrame(true)}
      onLoadedMetadata={e => {
        const el = e.currentTarget; diagnostic("loadedmetadata"); setError(null);
        if (Number.isFinite(el.duration)) setDuration(el.duration);
        if (el.videoWidth && el.videoHeight) { const value = el.videoWidth / el.videoHeight; setNativeRatio(value); onAspectRatio?.(value); }
        if (position.current > 0 && Number.isFinite(el.duration)) el.currentTime = Math.min(position.current, el.duration);
        updateProgress(el);
      }}
      onCanPlay={() => { setLoading(false); setStalled(false); }} onWaiting={e => { onPlayback?.("waiting", e.currentTarget); diagnostic("waiting"); setLoading(true); }}
      onStalled={e => { onPlayback?.("waiting", e.currentTarget); diagnostic("stalled"); setStalled(true); }}
      onPlaying={e => {
        if (!videoPlayback.owns(e.currentTarget) || intentionalPause.current) { e.currentTarget.pause(); return; }
        onPlayback?.("playing", e.currentTarget);
        setLoading(false); setBlocked(false); setPaused(false); setStalled(false); setEnded(false);
      }} onPause={e => { onPlayback?.("pause", e.currentTarget); setPaused(true); }} onSeeking={e => onPlayback?.("seeking", e.currentTarget)} onTimeUpdate={e => { updateProgress(e.currentTarget); onPlayback?.("tick", e.currentTarget); }} onVolumeChange={e => setMuted(e.currentTarget.muted)}
      onEnded={e => { onPlayback?.("ended", e.currentTarget); if (mode === "feed") { finished.current = true; setEnded(true); setPaused(true); } }}
      onError={() => { diagnostic("error"); setError(ERRORS[video.current?.error?.code ?? 4]); setLoading(false); }} />
    {attached && loading && !frame && !error && <div className="video-placeholder" aria-hidden="true" />}
    <button type="button" className={`video-play-surface ${mode === "reels" ? "reel-play-surface" : ""}`} tabIndex={active ? 0 : -1}
      aria-label={paused || blocked || ended ? "Play video" : "Pause video"} aria-pressed={!paused} disabled={!!error} onClick={toggle}>
      {(paused || blocked || ended) && !error && <span className="video-center video-play-indicator">{ended ? <RotateCcw size={30} /> : <Play size={30} fill="currentColor" />}</span>}
    </button>
    {selected && loading && !error && !blocked && !userPaused && !reducedData && <span className="video-center video-loading" role="status" aria-label="Loading video"><Loader2 size={28} className="spin" /></span>}
    {blocked && <span className="video-play-hint">Tap to play</span>}
    {stalled && !error && <div className="video-buffer-hint" role="status">Waiting for the connection <button type="button" disabled={retrying} onClick={() => void retry()}>Retry</button></div>}
    {error && <div className="video-error" role="alert"><VideoOff size={28} /><p>This video could not play.</p><small>{error}</small><button type="button" className="button small" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button></div>}
    <div className="video-playback-dock" data-player-controls>
      <div className="video-controls">
        <button type="button" aria-label={ended ? "Replay" : paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} onClick={toggle}>{ended ? <RotateCcw size={18} /> : paused ? <Play size={18} /> : <Pause size={18} />}</button>
        <span className="video-time" ref={timeLabel}>00:00 / --:--</span>
        {soundBlocked && <span className="video-audio-hint" role="status">Tap Unmute for sound</span>}
        <span
          className={`video-volume-wrap ${volumeOpen ? "open" : ""}`}
          onMouseEnter={() => setVolumeOpen(true)}
          onMouseLeave={() => setVolumeOpen(false)}
        >
          <button type="button" className="video-sound" aria-label={muted ? "Unmute" : "Mute"} title={soundBlocked ? "Browser muted autoplay; your sound preference is still saved" : muted ? "Unmute" : "Mute"} onClick={() => changeMuted(!muted)}>
            {muted || prefs.volume === 0 ? <VolumeX size={20} /> : prefs.volume < 0.5 ? <Volume1 size={20} /> : <Volume2 size={20} />}
          </button>
          <span className="video-volume-popover" role="presentation">
            <input
              type="range" min={0} max={1} step={0.01} value={muted ? 0 : prefs.volume}
              className="video-volume-slider"
              aria-label="Volume"
              // Firefox-only attribute for vertical sliders (not in React's input typings).
              {...{ orient: "vertical" }}
              onChange={(e) => { const v = Number(e.target.value); setVideoVolume(v); if (video.current) { video.current.volume = v; video.current.muted = v === 0; } }}
            />
          </span>
        </span>
        {mode === "feed" && openInReelsHref && <Link href={openInReelsHref} className="video-open-reels" aria-label="Open in Reels" title="Open in Reels"><Clapperboard size={19} /></Link>}
        {fullscreenSupported && <button type="button" aria-label="Fullscreen" title="Fullscreen" onClick={() => void fullscreen()}><Maximize size={19} /></button>}
      </div>
      <input ref={seekInput} className="video-seek" type="range" min={0} max={duration || 1} step={.1} defaultValue={0} disabled={!duration}
        aria-label="Seek video" aria-valuetext="00:00 of --:--" onChange={e => seek(Number(e.target.value))} />
    </div>
  </div>;
}
