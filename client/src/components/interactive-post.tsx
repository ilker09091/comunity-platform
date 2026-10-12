"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, BarChart3, HelpCircle, Sliders, MessageCircleQuestion, Send } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { api } from "@/lib/api/client";
import { useSession, useToast } from "./providers";

/**
 * Content-tag powered interactive post widgets. Posts whose body contains
 * `[poll:...]`, `[countdown:...]`, `[quiz:...]`, `[slider:...]` or `[ask:...]`
 * render an interactive widget inline. Poll votes, quiz answers and slider ratings are stored on the
 * server (one per person) and every count shown is real.
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

/** Real results from the server (one response per person). Signed-out viewers can see but not vote. */
function useInteraction(postId: string) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["interaction", postId],
    queryFn: ({ signal }) => api("postInteractionsGet", { params: { id: postId }, signal }),
    staleTime: 15_000,
  });
  const mutation = useMutation({
    mutationFn: (value: number) => api("postInteractionsRespond", { params: { id: postId }, body: { value } }),
    onSuccess: (data) => client.setQueryData(["interaction", postId], data),
    onError: (error) => toast(error.message, true),
  });
  const respond = (value: number) => {
    if (!user) {
      toast("Katılmak için giriş yap.");
      return false;
    }
    mutation.mutate(value);
    return true;
  };
  const mine = query.data?.myResponse ?? null;
  return { data: query.data, mine, respond, pending: mutation.isPending, pendingValue: mutation.isPending ? mutation.variables : null };
}

export function PollWidget({ postId, data }: { postId: string; data: ParsedPoll }) {
  const { data: result, mine, respond, pending, pendingValue } = useInteraction(postId);
  const counts = result?.counts ?? data.options.map(() => 0);
  const total = result?.total ?? 0;
  const voted = mine !== null;
  const pick = (i: number) => {
    if (voted || pending) return;
    if (respond(i)) haptic("tap");
  };
  return (
    <div className="ipost ipost-poll">
      <header><BarChart3 size={16} /><span>Anket</span></header>
      <h4>{data.question}</h4>
      <div className="ipost-options">
        {data.options.map((opt, i) => {
          const pct = total ? Math.round(((counts[i] ?? 0) / total) * 100) : 0;
          const picked = mine === i || pendingValue === i;
          return (
            <button key={i} type="button" className={`ipost-option ${picked ? "picked" : ""} ${voted ? "voted" : ""}`} onClick={() => pick(i)} disabled={voted || pending}>
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
  const { data: result, mine, respond, pending } = useInteraction(postId);
  const answered = mine !== null;
  const pick = (i: number) => {
    if (answered || pending) return;
    if (respond(i)) haptic(i === data.correct ? "success" : "warn");
  };
  const total = result?.total ?? 0;
  const correctRate = total ? Math.round(((result?.correctCount ?? 0) / total) * 100) : 0;
  return (
    <div className="ipost ipost-quiz">
      <header><HelpCircle size={16} /><span>Quiz</span></header>
      <h4>{data.question}</h4>
      <div className="ipost-options">
        {data.options.map((opt, i) => {
          const chosen = mine === i;
          const isAnswer = answered && i === data.correct;
          const wrong = chosen && i !== data.correct;
          return (
            <button key={i} type="button" className={`ipost-option ${isAnswer ? "correct" : ""} ${wrong ? "wrong" : ""}`} onClick={() => pick(i)} disabled={answered || pending}>
              <span className="ipost-label">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered ? (
        <footer className={mine === data.correct ? "right" : "wrong"}>
          {mine === data.correct ? "✓ Doğru!" : "✗ Yanlış"} · {total} kişinin %{correctRate}&apos;i doğru bildi
        </footer>
      ) : (
        <footer>{total} kişi cevapladı</footer>
      )}
    </div>
  );
}

export function SliderWidget({ postId, data }: { postId: string; data: ParsedSlider }) {
  const { data: result, mine, respond, pending } = useInteraction(postId);
  const [value, setValue] = useState(50);
  const locked = mine !== null;
  const commit = () => {
    if (locked || pending) return;
    if (respond(value)) haptic("success");
  };
  return (
    <div className="ipost ipost-slider">
      <header><Sliders size={16} /><span>Değerlendir</span></header>
      <h4>{data.question}</h4>
      <div className="ipost-slider-row">
        <span className="ipost-emoji">{data.leftEmoji}</span>
        <input
          type="range" min={0} max={100} value={locked ? mine : value}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={(e) => { if (e.key === "Enter") commit(); }}
          disabled={locked || pending}
          aria-label={data.question}
        />
        <span className="ipost-emoji">{data.rightEmoji}</span>
      </div>
      <footer>
        {locked ? (
          <>Sen: <strong>{mine}</strong> · Ortalama: <strong>{result?.average ?? mine}</strong> · {result?.total ?? 1} kişi</>
        ) : (
          <>{result?.total ? <>Ortalama gizli · {result.total} kişi değerlendirdi</> : "İlk değerlendiren sen ol"}</>
        )}
      </footer>
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
