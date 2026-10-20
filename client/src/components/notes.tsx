"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Music2, Pause, Play, Plus, Send, Trash2, X } from "lucide-react";
import { api, ApiError, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { clipToWav } from "@/lib/audio-clip";
import { useSession, useToast } from "./providers";
import { Avatar, Modal, relativeTime } from "./ui";

type Note = Models["NoteDto"];
const CLIP_SECONDS = 15;
const MAX_TEXT = 60;

const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Plays a note's 15 s clip; only one note plays at a time. */
function useClipPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
    setProgress(0);
  };
  const play = (id: string, url: string) => {
    audio.current?.pause();
    const el = new Audio(url);
    el.preload = "auto";
    el.ontimeupdate = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
    el.onended = () => {
      setPlaying(null);
      setProgress(0);
    };
    audio.current = el;
    setPlaying(id);
    setBlocked(false);
    void el.play().catch((e: unknown) => {
      if (audio.current !== el) return;
      setPlaying(null);
      // Autoplay can be refused without a tap; the play button still works.
      setBlocked(e instanceof Error && e.name === "NotAllowedError");
    });
  };
  const toggle = (id: string, url: string) => (playing === id ? stop() : play(id, url));
  return { playing, progress, blocked, play, toggle };
}

/** Instagram-style notes row above the inbox: your note first, then people you follow. */
export function NotesTray() {
  const { user } = useSession();
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<Note | null>(null);
  const notes = useQuery({
    queryKey: ["notes", user?.id],
    queryFn: ({ signal }) => api("notesList", { signal }),
    enabled: !!user,
    refetchInterval: 60_000,
  });
  if (!user) return null;
  const mine = notes.data?.find((n) => n.isOwn);
  const others = notes.data?.filter((n) => !n.isOwn) ?? [];
  return (
    <div className="notes-tray" aria-label="Notes">
      <button
        type="button"
        className="note-tile own"
        onClick={() => (mine ? setViewing(mine) : setComposing(true))}
      >
        <NoteBubble note={mine} placeholder="Share a note" />
        <span className="note-avatar">
          <Avatar user={user} size={64} />
          {!mine && (
            <span className="note-add" aria-hidden="true">
              <Plus size={14} />
            </span>
          )}
        </span>
        <span className="note-name">Your note</span>
      </button>
      {others.map((note) => (
        <button type="button" key={note.id} className="note-tile" onClick={() => setViewing(note)}>
          <NoteBubble note={note} />
          <span className="note-avatar">
            <Avatar user={note.author} size={64} />
            {note.audioUrl && (
              <span className="note-has-song" aria-label="Has a song">
                <Music2 size={11} />
              </span>
            )}
          </span>
          <span className="note-name">{note.author.username}</span>
        </button>
      ))}
      {composing && <NoteComposer onClose={() => setComposing(false)} />}
      {viewing && (
        <NoteSheet
          note={viewing}
          onClose={() => setViewing(null)}
          onReplace={() => {
            setViewing(null);
            setComposing(true);
          }}
        />
      )}
    </div>
  );
}

function NoteBubble({ note, placeholder }: { note?: Note; placeholder?: string }) {
  if (!note) return <span className="note-bubble empty">{placeholder}</span>;
  return (
    <span className="note-bubble">
      {note.songTitle && (
        <span className="note-song">
          <Music2 size={11} />
          <span>{note.songTitle}</span>
        </span>
      )}
      {note.text && <span className="note-text">{note.text}</span>}
    </span>
  );
}

function NoteSheet({
  note,
  onClose,
  onReplace,
}: {
  note: Note;
  onClose: () => void;
  onReplace: () => void;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const player = useClipPlayer();
  const [reply, setReply] = useState("");
  const { play } = player;
  // Opening a note with a song starts the song, like Instagram (the tap that opened it allows audio).
  useEffect(() => {
    if (note.audioUrl) play(note.id, note.audioUrl);
  }, [note.id, note.audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = useMutation({
    mutationFn: () => api("notesDelete"),
    onSuccess: () => {
      toast("Note deleted.");
      void client.invalidateQueries({ queryKey: ["notes"] });
      onClose();
    },
    onError: (e) => toast(e.message, true),
  });
  const send = useMutation({
    mutationFn: () => api("notesReply", { params: { id: note.id }, body: { content: reply.trim() } }),
    onSuccess: () => {
      haptic("success");
      toast(`Sent to ${note.author.username}.`);
      void client.invalidateQueries({ queryKey: ["messages"] });
      onClose();
      router.push(`/messages?to=${encodeURIComponent(note.author.username)}`);
    },
    onError: (e) => toast(e.message, true),
  });
  return (
    <Modal title={note.isOwn ? "Your note" : `${note.author.username}'s note`} onClose={onClose} className="note-sheet">
      <div className="note-sheet-body">
        <Link href={`/profile/${note.author.username}`} className="note-sheet-author" onClick={onClose}>
          <Avatar user={note.author} size={72} />
        </Link>
        <div className="note-bubble large">
          {note.text && <span className="note-text">{note.text}</span>}
        </div>
        {note.audioUrl && (
          <button
            type="button"
            className={`note-song-player ${player.playing === note.id ? "playing" : ""}`}
            aria-label={`${player.playing === note.id ? "Pause" : "Play"} ${note.songTitle || "song"}`}
            onClick={() => player.toggle(note.id, note.audioUrl!)}
          >
            {player.playing === note.id ? <Pause size={18} /> : <Play size={18} />}
            <span className="note-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{note.songTitle || "Song"}</span>
            <small>{Math.round((note.audioDurationMs ?? 0) / 1000)}s</small>
            <span
              className="note-song-progress"
              style={{ transform: `scaleX(${player.playing === note.id ? player.progress : 0})` }}
              aria-hidden="true"
            />
          </button>
        )}
        {player.blocked && <small className="note-time">Tap the song to listen.</small>}
        <small className="note-time">Shared {relativeTime(note.createdAt)} · visible for 24 hours</small>
        {note.isOwn ? (
          <div className="note-sheet-actions">
            <button type="button" className="button secondary" onClick={onReplace}>
              Leave a new note
            </button>
            <button
              type="button"
              className="button secondary danger-text"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 size={16} /> Delete note
            </button>
          </div>
        ) : (
          <form
            className="note-reply"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim() && !send.isPending) send.mutate();
            }}
          >
            <input
              aria-label={`Reply to ${note.author.username}`}
              placeholder={`Reply to ${note.author.username}...`}
              maxLength={1500}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              data-autofocus
            />
            <button type="submit" className="dm-icon" aria-label="Send reply" onPointerDown={event=>event.preventDefault()} disabled={!reply.trim() || send.isPending}>
              <Send size={20} />
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

/** Write a note and optionally pick a 15 s part of a song from the device. */
function NoteComposer({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const { user } = useSession();
  const [text, setText] = useState("");
  const [song, setSong] = useState<{ file: File; url: string; duration: number } | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (song) URL.revokeObjectURL(song.url);
  }, [song]);
  const clip = song ? Math.min(CLIP_SECONDS, song.duration) : 0;
  const maxStart = song ? Math.max(0, song.duration - clip) : 0;
  const share = useMutation({
    mutationFn: async () => {
      let audioId: string | undefined;
      if (song) {
        // Cut the chosen 15 s in the browser so only a small file is uploaded (whole songs can hit
        // upload proxies' size limits). Browsers that can't decode it send the original instead.
        let file: File = song.file;
        let startMs = Math.round(start * 1000);
        try {
          file = await clipToWav(song.file, start, clip);
          startMs = 0;
        } catch {
          /* fall back to the original file */
        }
        const form = new FormData();
        form.append("startMs", String(startMs));
        form.append("file", file);
        try {
          audioId = (await api("notesUploadAudio", { body: form as never })).id;
        } catch (e) {
          if (e instanceof ApiError && e.status === 413)
            throw new Error("This song is too large to upload. Try a shorter file or an MP3.");
          throw e;
        }
      }
      return api("notesCreate", {
        body: { text: text.trim() || undefined, audioId, songTitle: song ? title.trim() || undefined : undefined },
      });
    },
    onSuccess: () => {
      haptic("success");
      toast("Your note is shared for 24 hours.");
      void client.invalidateQueries({ queryKey: ["notes"] });
      onClose();
    },
    onError: (e) => toast(e.message, true),
  });
  const choose = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(file.name))
      return toast("Choose a song or another audio file.", true);
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
        URL.revokeObjectURL(url);
        return toast("This audio file can't be played here. Try an MP3 or M4A.", true);
      }
      setSong((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { file, url, duration: probe.duration };
      });
      setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 80));
      setStart(0);
      setPosition(0);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      toast("This audio file can't be played here. Try an MP3 or M4A.", true);
    };
    probe.src = url;
  };
  const togglePreview = () => {
    const el = audio.current;
    if (!el || !song) return;
    if (previewing) {
      el.pause();
      setPreviewing(false);
      return;
    }
    el.currentTime = start;
    void el.play().then(() => setPreviewing(true), () => setPreviewing(false));
  };
  const moveStart = (value: number) => {
    setStart(value);
    const el = audio.current;
    if (el && previewing) el.currentTime = value;
  };
  return (
    <Modal
      title="New note"
      onClose={onClose}
      guardClose={() => !share.isPending}
      className="note-composer"
    >
      <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault();
          if ((text.trim() || song) && !share.isPending) share.mutate();
        }}
      >
        <div className="note-preview">
          <span className="note-bubble large">
            {song && (
              <span className="note-song">
                <Music2 size={12} />
                <span>{title || "Song"}</span>
              </span>
            )}
            <textarea
              aria-label="Note"
              placeholder="Share a thought..."
              maxLength={MAX_TEXT}
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
              data-autofocus
            />
          </span>
          {user && <Avatar user={user} size={72} />}
          <small className="note-count">
            {text.length}/{MAX_TEXT}
          </small>
        </div>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            choose(file);
          }}
        />
        {!song ? (
          <button type="button" className="note-add-music" onClick={() => fileInput.current?.click()}>
            <Music2 size={18} /> Add music from your device
          </button>
        ) : (
          <div className="note-music">
            <div className="note-music-head">
              <Music2 size={16} />
              <input
                aria-label="Song title"
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Song title"
              />
              <button
                type="button"
                className="dm-icon"
                aria-label="Remove music"
                onClick={() => {
                  audio.current?.pause();
                  setPreviewing(false);
                  setSong(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
            <audio
              ref={audio}
              src={song.url}
              preload="auto"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setPosition(t);
                // Preview loops just the chosen 15 seconds.
                if (t >= start + clip) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = start;
                  setPreviewing(false);
                }
              }}
              onPause={() => setPreviewing(false)}
            />
            <div className="note-track" aria-hidden="true">
              <span
                className="note-window"
                style={{ left: `${(start / song.duration) * 100}%`, width: `${(clip / song.duration) * 100}%` }}
              />
              {previewing && (
                <span className="note-playhead" style={{ left: `${(position / song.duration) * 100}%` }} />
              )}
            </div>
            <input
              type="range"
              className="note-range"
              aria-label="Clip start"
              min={0}
              max={maxStart}
              step={0.25}
              value={start}
              disabled={maxStart === 0}
              onChange={(e) => moveStart(Number(e.target.value))}
            />
            <div className="note-music-foot">
              <button type="button" className="note-preview-play" onClick={togglePreview}>
                {previewing ? <Pause size={16} /> : <Play size={16} />}
                {previewing ? "Pause" : "Preview"}
              </button>
              <span>
                {mmss(start)} – {mmss(start + clip)} <small>of {mmss(song.duration)}</small>
              </span>
            </div>
            <p className="note-hint">Drag to choose which {Math.round(clip)} seconds play with your note.</p>
          </div>
        )}
        <p className="note-hint">Your followers can see your note for 24 hours.</p>
        <button className="button" type="submit" disabled={(!text.trim() && !song) || share.isPending}>
          {share.isPending ? (song ? "Uploading music..." : "Sharing...") : "Share"}
        </button>
      </form>
    </Modal>
  );
}
