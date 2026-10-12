"use client";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, BarChart3, HelpCircle, Sliders, MessageCircleQuestion, Send } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { api } from "@/lib/api/client";
import { useToast } from "./providers";

/**
 * Content-tag powered interactive post widgets. Posts whose body contains
 * `[poll:...]`, `[countdown:...]`, `[quiz:...]`, `[slider:...]` or `[ask:...]`
 * render an interactive widget inline. Votes/responses live in localStorage
 * for now (per-post, per-browser). Server persistence lands in a follow-up.
 */

type ParsedPoll = { kind: "poll"; question: string; options: string[] };
type ParsedCountdown = { kind: "countdown"; endsAt: string; label?: string };
type ParsedQuiz = { kind: "quiz"; question: string; correct: number; options: string[] };
type ParsedSlider = { kind: "slider"; question: string; leftEmoji: string; rightEmoji: string };
type ParsedAsk = { kind: "ask"; prompt: string };
export type Interactive = ParsedPoll | ParsedCountdown | ParsedQuiz | ParsedSlider | ParsedAsk;

const TAG = /\[(poll|countdown|quiz|slider|ask):([^\]]+)\]/i;

export function parseInteractive(text: string | null | undefined): { before: string; widget: Interactive | null; after: string } {
  if (!text) return { before: "", widget: null, after: "" };
  const match = TAG.exec(text);
  if (!match) return { before: text, widget: null, after: "" };
  const [full, kind, body] = match;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + full.length);
  const parts = body.split("|").map((p) => p.trim());
  try {
    const parsed = (() => {
      const k = kind.toLowerCase();
      if (k === "poll") {
        const [q, ...opts] = parts;
        if (!q || opts.length < 2 || opts.length > 4) return null;
        return { kind: "poll" as const, question: q.replace(/\?*$/, "?"), options: opts };
      }
      if (k === "countdown") {
        const [when, label] = parts;
        if (!when || isNaN(Date.parse(when))) return null;
        return { kind: "countdown" as const, endsAt: when, label: label || undefined };
      }
      if (k === "quiz") {
        const [q, correct, ...opts] = parts;
        const idx = Number(correct);
        if (!q || !opts.length || !Number.isInteger(idx) || idx < 0 || idx >= opts.length) return null;
        return { kind: "quiz" as const, question: q.replace(/\?*$/, "?"), correct: idx, options: opts };
      }
      if (k === "slider") {
        const [q, l = "😐", r = "🔥"] = parts;
        if (!q) return null;
        return { kind: "slider" as const, question: q, leftEmoji: l, rightEmoji: r };
      }
      if (k === "ask") {
        return { kind: "ask" as const, prompt: parts.join(" | ") || "Bana soru sor" };
      }
      return null;
    })();
    return { before, widget: parsed, after };
  } catch {
    return { before: text, widget: null, after: "" };
  }
}

function store<T>(key: string, read: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : read; } catch { return read; }
}
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or private mode */ } }

export function PollWidget({ postId, data }: { postId: string; data: ParsedPoll }) {
  const key = `poll:${postId}`;
  const [state, setState] = useState<{ picked: number | null; counts: number[] }>(() =>
    store(key, { picked: null, counts: data.options.map(() => Math.floor(Math.random() * 40) + 5) }),
  );
  const total = state.counts.reduce((a, b) => a + b, 0);
  const pick = (i: number) => {
    if (state.picked !== null) return;
    haptic("tap");
    const counts = state.counts.map((c, j) => (j === i ? c + 1 : c));
    const next = { picked: i, counts };
    setState(next); save(key, next);
  };
  return (
    <div className="ipost ipost-poll">
      <header><BarChart3 size={16} /><span>Anket</span></header>
      <h4>{data.question}</h4>
      <div className="ipost-options">
        {data.options.map((opt, i) => {
          const pct = total ? Math.round((state.counts[i] / total) * 100) : 0;
          const picked = state.picked === i;
          const voted = state.picked !== null;
          return (
            <button key={i} type="button" className={`ipost-option ${picked ? "picked" : ""} ${voted ? "voted" : ""}`} onClick={() => pick(i)} disabled={voted}>
              <span className="ipost-fill" style={{ width: voted ? `${pct}%` : "0%" }} />
              <span className="ipost-label">{opt}</span>
              {voted && <span className="ipost-pct">{pct}%</span>}
            </button>
          );
        })}
      </div>
      <footer>{total} oy</footer>
    </div>
  );
}

export function CountdownWidget({ data }: { data: ParsedCountdown }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const end = Date.parse(data.endsAt);
  const diff = Math.max(0, end - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const done = diff === 0;
  return (
    <div className={`ipost ipost-countdown ${done ? "done" : ""}`}>
      <header><Clock size={16} /><span>{data.label || "Geri sayım"}</span></header>
      {done ? <h4 className="ipost-done">Vakti geldi 🎉</h4> : (
        <div className="ipost-timer">
          <span><strong>{d}</strong><small>gün</small></span>
          <span><strong>{String(h).padStart(2, "0")}</strong><small>saat</small></span>
          <span><strong>{String(m).padStart(2, "0")}</strong><small>dk</small></span>
          <span><strong>{String(s).padStart(2, "0")}</strong><small>sn</small></span>
        </div>
      )}
    </div>
  );
}

export function QuizWidget({ postId, data }: { postId: string; data: ParsedQuiz }) {
  const key = `quiz:${postId}`;
  const [picked, setPicked] = useState<number | null>(() => store(key, null as number | null));
  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i); save(key, i);
    haptic(i === data.correct ? "success" : "warn");
  };
  return (
    <div className="ipost ipost-quiz">
      <header><HelpCircle size={16} /><span>Quiz</span></header>
      <h4>{data.question}</h4>
      <div className="ipost-options">
        {data.options.map((opt, i) => {
          const chosen = picked === i;
          const isAnswer = picked !== null && i === data.correct;
          const wrong = chosen && i !== data.correct;
          return (
            <button key={i} type="button" className={`ipost-option ${isAnswer ? "correct" : ""} ${wrong ? "wrong" : ""}`} onClick={() => pick(i)} disabled={picked !== null}>
              <span className="ipost-label">{opt}</span>
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <footer className={picked === data.correct ? "right" : "wrong"}>
          {picked === data.correct ? "✓ Doğru!" : "✗ Yanlış"}
        </footer>
      )}
    </div>
  );
}

export function SliderWidget({ postId, data }: { postId: string; data: ParsedSlider }) {
  const key = `slider:${postId}`;
  const [value, setValue] = useState<number>(() => store(key, 50));
  const [locked, setLocked] = useState<boolean>(() => store(`${key}:locked`, false));
  const average = 50 + Math.sin((postId.length * 7) % 100) * 20;
  const commit = () => {
    setLocked(true); save(key, value); save(`${key}:locked`, true); haptic("success");
  };
  return (
    <div className="ipost ipost-slider">
      <header><Sliders size={16} /><span>Değerlendir</span></header>
      <h4>{data.question}</h4>
      <div className="ipost-slider-row">
        <span className="ipost-emoji">{data.leftEmoji}</span>
        <input
          type="range" min={0} max={100} value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={() => !locked && commit()}
          disabled={locked}
        />
        <span className="ipost-emoji">{data.rightEmoji}</span>
      </div>
      {locked && (
        <footer>
          Sen: <strong>{value}</strong> · Ortalama: <strong>{Math.round(average)}</strong>
        </footer>
      )}
    </div>
  );
}

export function AskWidget({ postId, data }: { postId: string; data: ParsedAsk }) {
  const [text, setText] = useState("");
  const toast = useToast();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api("commentsCreate", { params: { id: postId }, body: { content: text.trim() } }),
    onSuccess: () => {
      setText("");
      haptic("success");
      toast("Sorun gönderildi ✓ Yorumlarda görünecek.");
      void client.invalidateQueries({ queryKey: ["comments"] });
      void client.invalidateQueries({ queryKey: ["posts"] });
      void client.invalidateQueries({ queryKey: ["post"] });
    },
    onError: (error) => toast(error.message, true),
  });
  const send = () => { if (text.trim() && !mutation.isPending) mutation.mutate(); };
  return (
    <div className="ipost ipost-ask">
      <header><MessageCircleQuestion size={16} /><span>Soru sor</span></header>
      <h4>{data.prompt}</h4>
      <div className="ipost-ask-row">
        <input
          type="text"
          placeholder="Sorunu yaz…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          maxLength={280}
          disabled={mutation.isPending}
        />
        <button type="button" className="ipost-ask-send" onClick={send} disabled={!text.trim() || mutation.isPending} aria-label="Gönder">
          <Send size={16} />
        </button>
      </div>
      <footer>Cevaplar bu postun yorumlarına düşer. Herkes görebilir.</footer>
    </div>
  );
}

export function InteractiveWidget({ postId, widget }: { postId: string; widget: Interactive }) {
  if (widget.kind === "poll") return <PollWidget postId={postId} data={widget} />;
  if (widget.kind === "countdown") return <CountdownWidget data={widget} />;
  if (widget.kind === "quiz") return <QuizWidget postId={postId} data={widget} />;
  if (widget.kind === "slider") return <SliderWidget postId={postId} data={widget} />;
  if (widget.kind === "ask") return <AskWidget postId={postId} data={widget} />;
  return null;
}
