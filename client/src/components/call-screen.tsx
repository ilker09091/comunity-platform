"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Minimize, MonitorUp, PictureInPicture2, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import type { ScreenStats } from "@/lib/call-connection";

const MIN_ZOOM = 1, MAX_ZOOM = 5, IDLE_MS = 3000;
type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };
/** Keeps the zoomed picture covering the stage: no panning past its edges. */
function clampView(view: View, width: number, height: number): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale));
  const maxX = ((scale - 1) * width) / 2, maxY = ((scale - 1) * height) / 2;
  return { scale, x: Math.max(-maxX, Math.min(maxX, view.x)), y: Math.max(-maxY, Math.min(maxY, view.y)) };
}
/** Zooms so the point under the finger/cursor stays where it is. Points are relative to the stage centre. */
function zoomView(view: View, scale: number, at: Point): View {
  return { scale, x: at.x - (scale * (at.x - view.x)) / view.scale, y: at.y - (scale * (at.y - view.y)) / view.scale };
}
type Orientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void>; unlock?: () => void };

/**
 * Discord-style viewer for the other person's screen: fills the call, zooms (wheel, pinch,
 * double-click/tap, buttons, +/-/0 keys), pans while zoomed, goes full screen (F) or
 * picture-in-picture, has its own volume for shared sound, and shows the received quality.
 * Controls fade out after a few seconds without movement.
 */
export function ScreenStage({ stream, name, status, audio, stats, sinkId }: {
  stream: MediaStream; name: string; status: string; audio: boolean;
  stats: () => Promise<ScreenStats | null>; sinkId?: string | null;
}) {
  const root = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), sound = useRef<HTMLAudioElement>(null);
  const [view, setView] = useState<View>(RESET);
  const [fullscreen, setFullscreen] = useState(false), [pip, setPip] = useState(false);
  // Only mounted during a call in the browser, never server-rendered.
  const [canPip] = useState(() => typeof document !== "undefined" && !!document.pictureInPictureEnabled);
  const [idle, setIdle] = useState(false);
  const [volume, setVolume] = useState(1), [muted, setMuted] = useState(false);
  const [info, setInfo] = useState<ScreenStats | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; mid: Point; view: View } | null>(null);
  const drag = useRef<{ start: Point; view: View } | null>(null);
  const tap = useRef<{ time: number; at: Point } | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);

  const box = () => root.current?.getBoundingClientRect();
  const local = (clientX: number, clientY: number): Point => {
    const rect = box();
    return rect ? { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 } : { x: 0, y: 0 };
  };
  const apply = (next: (view: View) => View) => {
    const rect = box();
    if (rect) setView(current => clampView(next(current), rect.width, rect.height));
  };
  const zoomAt = (scale: (current: number) => number, at: Point = { x: 0, y: 0 }) =>
    apply(current => zoomView(current, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale(current.scale))), at));
  const toggleZoom = (at: Point) => apply(current => (current.scale > 1 ? RESET : zoomView(current, 2.5, at)));

  // A new share starts unzoomed.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = new MediaStream(stream.getVideoTracks());
    void element.play().catch(() => {});
    setView(RESET);
    return () => { element.srcObject = null; };
  }, [stream]);
  useEffect(() => {
    const element = sound.current;
    if (!element) return;
    const tracks = stream.getAudioTracks();
    element.srcObject = tracks.length ? new MediaStream(tracks) : null;
    if (tracks.length) void element.play().catch(() => {});
    return () => { element.srcObject = null; };
  }, [stream, audio]);
  useEffect(() => {
    const element = sound.current;
    if (!element) return;
    element.volume = volume;
    element.muted = muted;
    if (sinkId && "setSinkId" in element) void element.setSinkId(sinkId).catch(() => {});
  }, [volume, muted, sinkId, audio]);
  useEffect(() => {
    let cancelled = false;
    const read = () => void stats().then(value => { if (!cancelled) setInfo(value); });
    read();
    const timer = setInterval(read, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [stats]);
  useEffect(() => {
    const element = video.current;
    const enter = () => setPip(true), leave = () => setPip(false);
    element?.addEventListener("enterpictureinpicture", enter);
    element?.addEventListener("leavepictureinpicture", leave);
    const change = () => {
      const on = !!document.fullscreenElement && !!root.current && document.fullscreenElement.contains(root.current);
      setFullscreen(on);
      if (!on) try { (screen.orientation as Orientation).unlock?.(); } catch { /* unsupported */ }
    };
    document.addEventListener("fullscreenchange", change);
    return () => {
      element?.removeEventListener("enterpictureinpicture", enter);
      element?.removeEventListener("leavepictureinpicture", leave);
      document.removeEventListener("fullscreenchange", change);
      if (document.pictureInPictureElement === element) void document.exitPictureInPicture().catch(() => {});
    };
  }, []);
  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest(".screen-toolbar")) return;
      event.preventDefault();
      const at = local(event.clientX, event.clientY);
      zoomAt(scale => scale * Math.exp(-event.deltaY * 0.0015), at);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });
  // Controls (here and the call's own buttons) fade out while the screen is being watched.
  const wake = () => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    return () => window.clearTimeout(idleTimer.current);
  }, []);
  useEffect(() => {
    const stage = root.current?.closest(".call-stage");
    stage?.classList.toggle("screen-idle", idle);
    return () => stage?.classList.remove("screen-idle");
  }, [idle]);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    // The whole call goes full screen, so its buttons and camera tiles stay reachable.
    const target = root.current?.closest<HTMLElement>(".call-stage") ?? root.current;
    if (target?.requestFullscreen) {
      try {
        await target.requestFullscreen({ navigationUI: "hide" });
        const element = video.current;
        if (element && element.videoWidth > element.videoHeight) await (screen.orientation as Orientation).lock?.("landscape");
      } catch { /* the orientation lock is best effort */ }
      return;
    }
    // iPhone Safari only allows the video element itself to go full screen.
    (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };
  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch { /* the browser declined */ }
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    wake();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      drag.current = null;
      pinch.current = {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1,
        mid: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, view,
      };
    } else if (points.length === 1) drag.current = { start: points[0], view };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    wake();
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    const points = [...pointers.current.values()];
    const gesture = pinch.current;
    if (gesture && points.length >= 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (gesture.view.scale * distance) / gesture.distance));
      const zoomed = zoomView(gesture.view, scale, gesture.mid);
      apply(() => ({ scale, x: zoomed.x + mid.x - gesture.mid.x, y: zoomed.y + mid.y - gesture.mid.y }));
    } else if (drag.current && drag.current.view.scale > 1) {
      const { start, view: from } = drag.current, at = points[0];
      apply(() => ({ ...from, x: from.x + at.x - start.x, y: from.y + at.y - start.y }));
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const at = pointers.current.get(event.pointerId);
    const start = drag.current?.start;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
    // Mouse uses dblclick; a quick second tap on touch toggles zoom.
    if (event.pointerType !== "touch" || !at || !start || Math.hypot(at.x - start.x, at.y - start.y) > 10) return;
    const now = Date.now(), last = tap.current;
    if (last && now - last.time < 300 && Math.hypot(at.x - last.at.x, at.y - last.at.y) < 40) { tap.current = null; toggleZoom(at); }
    else tap.current = { time: now, at };
  };
  const key = (event: React.KeyboardEvent) => {
    wake();
    if (event.key === "f" || event.key === "F") { event.preventDefault(); void toggleFullscreen(); }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(scale => scale * 1.25); }
    else if (event.key === "-") { event.preventDefault(); zoomAt(scale => scale / 1.25); }
    else if (event.key === "0") { event.preventDefault(); setView(RESET); }
  };

  return (
    <div ref={root} className={`screen-stage ${idle ? "idle" : ""} ${view.scale > 1 ? "zoomed" : ""}`} tabIndex={0}
      role="region" aria-label={`${name}'s screen`} onKeyDown={key} onPointerMove={wake}>
      <div className="screen-surface" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={event => toggleZoom(local(event.clientX, event.clientY))}>
        <video ref={video} className="screen-video" autoPlay playsInline muted
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
        {pip && <p className="screen-pip-note">Playing in picture-in-picture</p>}
      </div>
      <audio ref={sound} autoPlay hidden />
      <div className="screen-topbar">
        <span className="screen-live">Live</span>
        <span className="screen-title"><MonitorUp size={15} aria-hidden="true" /><span>{name}&apos;s screen</span></span>
        <span className="screen-status">{status}</span>
        {info && <span className="screen-info" title="Received quality">{info.width}×{info.height} · {info.fps} FPS</span>}
      </div>
      <div className="screen-toolbar" role="toolbar" aria-label="Screen view controls">
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={view.scale <= MIN_ZOOM} onClick={() => zoomAt(scale => scale / 1.25)}><ZoomOut size={18} /></button>
        <button type="button" className="screen-zoom-level" aria-label="Fit to screen" title="Fit (0)" onClick={() => setView(RESET)}>{Math.round(view.scale * 100)}%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={view.scale >= MAX_ZOOM} onClick={() => zoomAt(scale => scale * 1.25)}><ZoomIn size={18} /></button>
        {audio && <span className="screen-volume">
          <button type="button" aria-label={muted ? "Unmute screen sound" : "Mute screen sound"} aria-pressed={muted} onClick={() => setMuted(value => !value)}>
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input type="range" min={0} max={100} value={muted ? 0 : Math.round(volume * 100)} aria-label="Screen sound volume"
            onChange={event => { setVolume(Number(event.target.value) / 100); setMuted(false); }} />
        </span>}
        {canPip && <button type="button" aria-label={pip ? "Exit picture-in-picture" : "Picture-in-picture"} aria-pressed={pip} title="Picture-in-picture" onClick={() => void togglePip()}><PictureInPicture2 size={18} /></button>}
        <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>
    </div>
  );
}
