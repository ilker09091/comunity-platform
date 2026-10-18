"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Music2, Pause, Play, X } from "lucide-react";
import { api, ApiError, type Models } from "@/lib/api/client";
import { clipToWav } from "@/lib/audio-clip";
import { haptic } from "@/lib/haptics";
import { useToast } from "./providers";

/** Longest music clip sent to the server; it loops for longer videos. */
const MAX_CLIP_SECONDS = 60;
/** Mono 32 kHz keeps a minute of music around 4 MB before the server re-encodes it to AAC. */
const CLIP_RATE = 32_000;

const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * "Add sound" for the Reel composer: pick a song — or a video to take its sound from — choose the
 * part that plays, optionally keep the original sound under it, and apply it to the uploaded video.
 */
export function ReelSound({
  media,
  disabled,
  onApplied,
}: {
  media: Models["MediaDto"] | undefined;
  disabled?: boolean;
  onApplied: (media: Models["MediaDto"], title: string) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<{ file: File; url: string; duration: number; video: boolean } | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(0);
  const [mix, setMix] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [applied, setApplied] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.url);
  }, [source]);
  const videoSeconds = media?.durationMs ? media.durationMs / 1000 : MAX_CLIP_SECONDS;
  const clip = source ? Math.min(MAX_CLIP_SECONDS, videoSeconds, source.duration) : 0;
  const maxStart = source ? Math.max(0, source.duration - clip) : 0;
  const ready = media?.status === "READY";
  const apply = useMutation({
    mutationFn: async () => {
      if (!source || !media) throw new Error("Choose a sound first.");
      let file: File;
      try {
        file = await clipToWav(source.file, start, clip, CLIP_RATE);
      } catch {
        throw new Error("This file's sound can't be read here. Try an MP3, M4A or MP4.");
      }
      const form = new FormData();
      form.append("mix", String(mix));
      form.append("file", file);
      try {
        return await api("mediaSoundtrack", { params: { id: media.id }, body: form as never });
      } catch (e) {
        if (e instanceof ApiError && e.status === 413) throw new Error("This sound is too long to upload. Choose a shorter part.");
        throw e;
      }
    },
    onSuccess: (updated) => {
      haptic("success");
      const name = title.trim() || "Sound";
      setApplied(name);
      player.current?.pause();
      setOpen(false);
      onApplied(updated, name);
      toast(`"${name}" added to your Reel.`);
    },
    onError: (e) => toast(e.message, true),
  });
  const choose = (file?: File) => {
    if (!file) return;
    const video = file.type.startsWith("video/");
    if (!video && !file.type.startsWith("audio/") && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|mp4|mov|webm)$/i.test(file.name))
      return toast("Choose a song or a video.", true);
    const url = URL.createObjectURL(file);
    const probe = document.createElement(video ? "video" : "audio");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
        URL.revokeObjectURL(url);
        return toast("This file can't be played here. Try an MP3, M4A or MP4.", true);
      }
      setSource({ file, url, duration: probe.duration, video });
      setTitle(video ? `Sound from ${file.name.replace(/\.[^.]+$/, "")}`.slice(0, 80) : file.name.replace(/\.[^.]+$/, "").slice(0, 80));
      setStart(0);
      setPosition(0);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      toast("This file can't be played here. Try an MP3, M4A or MP4.", true);
    };
    probe.src = url;
  };
  const togglePreview = () => {
    const el = player.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    el.currentTime = start;
    void el.play().then(() => setPlaying(true), () => setPlaying(false));
  };
  return (
    <div className="reel-sound">
      <button
        type="button"
        className="reel-setting"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span>
          <Music2 size={16} aria-hidden="true" /> {applied ? applied : "Add sound"}
        </span>
        <small>{applied ? "Change" : "From a song or another video"}</small>
      </button>
      {open && (
        <div className="reel-sound-panel">
          <input
            ref={input}
            type="file"
            hidden
            accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              choose(file);
            }}
          />
          {!source ? (
            <button type="button" className="reel-secondary" onClick={() => input.current?.click()}>
              <Music2 size={17} aria-hidden="true" /> Choose a song or video
            </button>
          ) : (
            <>
              <div className="reel-sound-head">
                <Music2 size={16} aria-hidden="true" />
                <input aria-label="Sound title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove sound"
                  onClick={() => {
                    player.current?.pause();
                    setSource(null);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <audio
                ref={player}
                src={source.url}
                preload="auto"
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  setPosition(t);
                  if (t >= start + clip) {
                    e.currentTarget.pause();
                    e.currentTarget.currentTime = start;
                  }
                }}
                onPause={() => setPlaying(false)}
              />
              <div className="note-track reel-sound-track" aria-hidden="true">
                <span
                  className="note-window"
                  style={{ left: `${(start / source.duration) * 100}%`, width: `${(clip / source.duration) * 100}%` }}
                />
                {playing && <span className="note-playhead" style={{ left: `${(position / source.duration) * 100}%` }} />}
              </div>
              <input
                type="range"
                className="note-range"
                aria-label="Sound start"
                min={0}
                max={maxStart}
                step={0.25}
                value={start}
                disabled={maxStart === 0}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setStart(value);
                  if (playing && player.current) player.current.currentTime = value;
                }}
              />
              <div className="note-music-foot">
                <button type="button" className="note-preview-play" onClick={togglePreview}>
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                  {playing ? "Pause" : "Preview"}
                </button>
                <span>
                  {mmss(start)} – {mmss(start + clip)} <small>of {mmss(source.duration)}</small>
                </span>
              </div>
              <button type="button" className="reel-setting" aria-pressed={mix} onClick={() => setMix((m) => !m)}>
                <span>Keep original sound</span>
                <span className={`reel-switch ${mix ? "on" : ""}`} aria-hidden="true" />
              </button>
              {!ready && <p className="reel-sound-hint">Waiting for your video to finish processing…</p>}
              <button
                type="button"
                className="reel-primary"
                disabled={!ready || apply.isPending}
                onClick={() => apply.mutate()}
              >
                {apply.isPending && <Loader2 size={15} className="spin" />}
                {apply.isPending ? "Adding sound…" : "Use this sound"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
