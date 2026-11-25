"use client";
/**
 * Third batch of chat games: Love Map, Question of the Day, Who's More Likely, Bucket List,
 * Color Word, Emoji Riddle, Sudoku Duel, Word Search, Pişti, Coin Toss, Spin the Wheel, Dama,
 * Tavla and Chess. The server sends what the viewer may see in `game.view`
 * (server/src/modules/social/games-third.ts `thirdView`).
 */
import { useState, type CSSProperties, type FormEvent } from "react";
import { Check, Loader2, RotateCcw, Send } from "lucide-react";
import type { Models } from "@/lib/api/client";
import { useSession } from "./providers";
import { Avatar } from "./ui";
import { LineInput, Scores, Waiting, type ExtraMove } from "./chat-games-more";

type Game = Models["ChatGameDto"];
type Peer = Models["MessagePeerDto"];

export const THIRD_KINDS = ["lovemap", "daily", "whomore", "bucket", "colorword", "emoji", "sudoku", "wordsearch", "pisti", "coin", "wheel", "dama", "tavla", "chess"] as const;
type ThirdKind = (typeof THIRD_KINDS)[number];
export const isThirdKind = (kind: Game["kind"]): kind is ThirdKind => (THIRD_KINDS as readonly string[]).includes(kind);
/** No turns: both play whenever they like. */
const FREE = new Set<string>(["daily", "whomore", "bucket", "sudoku", "wordsearch"]);

type LoveView = { scores: number[]; total: number; rounds: { asker: number; question: string | null; guess: string | null; right: boolean | null; answer: string | null }[] };
type DailyView = { question: string; mine: string | null; theirs: string | null; answered: boolean[] };
type WhoView = { round: number; total: number; prompt: string | null; rounds: { prompt: string; picked: number[] }[] };
type BucketView = { items: { text: string; by: number; done: boolean; doneBy: number | null }[]; max: number; closedBy: number | null; done: number };
type ColorView = {
  scores: number[]; total: number; tries: number; length: number;
  rounds: { setter: number; ready: boolean; guesses: { word: string; marks: number[] }[]; solved: boolean | null; word: string | null }[];
};
type EmojiView = { scores: number[]; total: number; tries: number; rounds: { teller: number; clue: string | null; guesses: string[]; solved: boolean | null; answer: string | null }[] };
type SudokuView = { puzzle: number[]; board: number[]; conflicts: number[]; progress: number[]; holes: number };
type SearchView = { size: number; grid: string[]; words: { word: string; by: number | null; cells: number[] }[]; scores: number[] };
type PistiView = {
  hand: string[]; theirCards: number; top: string | null; under: string | null; pile: number; deck: number;
  taken: number[]; pistis: number[]; scores: number[]; last: { player: number; card: string; took: boolean; pisti: number } | null;
};
type CoinView = { stake: string | null; call: "a" | "b" | null; result: "a" | "b" | null };
type WheelView = { options: string[] | null; result: number | null };
type DamaView = { board: number[]; toMove: number; last: number[] | null; captured: number[]; moves: number[][] };
type TavlaStep = { from: number; to: number; die: number };
type TavlaView = {
  points: number[]; bar: number[]; off: number[]; dice: number[]; rolled: number[]; toMove: number; played: TavlaStep[];
  log: { player: number; rolled: number[]; steps: TavlaStep[]; blocked: boolean }[]; canUndo: boolean; steps: TavlaStep[]; mars: boolean;
};
type ChessView = {
  board: string[]; toMove: number; last: [number, number] | null; moves: string[]; end: string | null; check: boolean;
  legal: string[]; lastText: string | null; captured: string[][];
};

const view = <T,>(game: Game) => (game.view ?? {}) as T;
const first = (name: string) => name.split(" ")[0];

/* -------------------------------------------------------------------------------------------- */
/* Turn logic and status lines for GameCard                                                      */

export function thirdSimultaneous(game: Game) {
  return FREE.has(game.kind);
}
/** In the free games, whether the viewer has nothing to do until the other one moves. */
export function thirdAnswered(game: Game, me: number) {
  if (game.kind === "whomore") return !!game.myChoice;
  if (game.kind === "daily") return !!view<DailyView>(game).answered?.[me];
  return false;
}
export function thirdPeerAnswered(game: Game, me: number) {
  if (game.kind === "whomore") return game.peerReady;
  if (game.kind === "daily") return !!view<DailyView>(game).answered?.[1 - me];
  return false;
}

export function thirdStatus(game: Game, me: number, peerName: string, myTurn: boolean): string {
  switch (game.kind) {
    case "lovemap": {
      const r = view<LoveView>(game).rounds?.at(-1);
      if (!r) break;
      if (r.question === null) return r.asker === me ? "Ask a question about you" : `${peerName} is writing a question…`;
      if (r.guess === null) return r.asker === me ? `${peerName} is guessing…` : "Guess the answer";
      return r.asker === me ? "Was the guess right?" : `${peerName} is checking your guess…`;
    }
    case "daily":
      return thirdAnswered(game, me) ? `Waiting for ${peerName}…` : thirdPeerAnswered(game, me) ? `${peerName} answered — your turn` : "Answer today's question";
    case "whomore":
      return game.myChoice ? `Waiting for ${peerName}…` : game.peerReady ? `${peerName} answered — your turn` : `Question ${game.round + 1} of ${game.totalRounds}`;
    case "bucket":
      return `${view<BucketView>(game).items?.length ?? 0} things on our list`;
    case "colorword": {
      const r = view<ColorView>(game).rounds?.at(-1);
      if (r && !r.ready) return r.setter === me ? "Choose a secret word" : `${peerName} is choosing a word…`;
      return r?.setter === me ? `${peerName} is guessing your word` : "Guess the word";
    }
    case "emoji": {
      const r = view<EmojiView>(game).rounds?.at(-1);
      if (r && r.clue === null) return r.teller === me ? "Write an emoji riddle" : `${peerName} is writing a riddle…`;
      return r?.teller === me ? `${peerName} is guessing…` : "What is it?";
    }
    case "sudoku":
      return "First to solve it wins";
    case "wordsearch":
      return "Find the words before they do";
    case "coin":
      return view<CoinView>(game).stake === null ? (myTurn ? "What is it for?" : `${peerName} is writing…`) : myTurn ? "Heads or tails?" : `${peerName} is calling it…`;
    case "wheel":
      return view<WheelView>(game).options === null ? (myTurn ? "Write the options" : `${peerName} is writing the options…`) : myTurn ? "Spin the wheel!" : `${peerName} is spinning…`;
    case "chess":
      if (view<ChessView>(game).check) return myTurn ? "Check! Your move" : `Check! ${peerName}'s move`;
      break;
  }
  return myTurn ? "Your turn" : `${peerName}'s turn`;
}

export function thirdDone(game: Game, me: number, peerName: string): string {
  switch (game.kind) {
    case "daily": return "You both answered 💬";
    case "whomore": {
      const same = view<WhoView>(game).rounds?.filter((r) => r.picked[0] === r.picked[1]).length ?? 0;
      return `You agreed on ${same} of ${view<WhoView>(game).rounds?.length ?? 0}`;
    }
    case "bucket": return `${view<BucketView>(game).done ?? 0} done, list closed ✨`;
    case "wheel": {
      const v = view<WheelView>(game);
      return v.options && v.result !== null ? `The wheel says: ${v.options[v.result]}` : "Spun!";
    }
    default: return me >= 0 ? `Well played, ${peerName}` : "Well played 💞";
  }
}

/** Chess and Tavla add why it ended. */
export function thirdEndNote(game: Game) {
  if (game.kind === "chess") {
    const end = view<ChessView>(game).end;
    return end === "mate" ? "Checkmate" : end === "stalemate" ? "Stalemate" : end === "fifty" ? "50 moves without a capture" : end === "repetition" ? "Same position three times" : end === "material" ? "Not enough pieces to win" : null;
  }
  if (game.kind === "tavla" && view<TavlaView>(game).mars) return "Mars! 🎉";
  return null;
}

/* -------------------------------------------------------------------------------------------- */

type BoardProps = { game: Game; me: number; peer: Peer; playable: boolean; busy: boolean; onMove: (move: ExtraMove) => void };

export function ThirdBoard(props: BoardProps) {
  switch (props.game.kind) {
    case "lovemap": return <LoveMap {...props} />;
    case "daily": return <Daily {...props} />;
    case "whomore": return <WhoMore {...props} />;
    case "bucket": return <Bucket {...props} />;
    case "colorword": return <ColorWord {...props} />;
    case "emoji": return <EmojiRiddle {...props} />;
    case "sudoku": return <Sudoku {...props} />;
    case "wordsearch": return <WordSearch {...props} />;
    case "pisti": return <Pisti {...props} />;
    case "coin": return <Coin {...props} />;
    case "wheel": return <Wheel {...props} />;
    case "dama": return <Dama {...props} />;
    case "tavla": return <Tavla {...props} />;
    case "chess": return <Chess {...props} />;
    default: return null;
  }
}

/** Two inputs sent as two lines (a question and its answer, a clue and its answer…). */
function PairInput({ a, b, cta, busy, maxA, maxB, initialA = "", onSend }: {
  a: string; b: string; cta: string; busy: boolean; maxA: number; maxB: number; initialA?: string; onSend: (text: string) => void;
}) {
  const [one, setOne] = useState(initialA);
  const [two, setTwo] = useState("");
  const ready = one.trim() && two.trim() && !busy;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSend(`${one.trim().replace(/\n/g, " ")}\n${two.trim().replace(/\n/g, " ")}`);
  };
  return (
    <form className="dm-xg-pair" onSubmit={submit}>
      <input value={one} maxLength={maxA} placeholder={a} aria-label={a} onChange={(e) => setOne(e.target.value)} />
      <input value={two} maxLength={maxB} placeholder={b} aria-label={b} onChange={(e) => setTwo(e.target.value)} />
      <button type="submit" className="dm-talk-send" disabled={!ready}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {cta}</button>
    </form>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Love map                                                                                      */

const LOVE_IDEAS = ["Where did we first meet?", "What is my favorite food?", "What am I most afraid of?", "What was my childhood dream job?", "Which song do I sing the most?", "What's my go-to coffee order?"];

function LoveMap({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<LoveView>(game);
  const [idea, setIdea] = useState(0);
  const peerName = first(peer.displayName);
  const rounds = v.rounds ?? [];
  const r = rounds.at(-1);
  const active = game.status === "active";
  const past = rounds.filter((x) => x.right !== null);
  return (
    <div className="dm-love">
      <Scores game={game} me={me} peer={peer} label={`round ${Math.min(rounds.length, v.total)} of ${v.total}`} />
      {active && r && r.question === null && (
        r.asker === me ? (
          playable && (
            <>
              <p className="dm-xg-note">{`Ask something about you and write the answer. ${peerName} only sees the question.`}</p>
              <div className="dm-xg-chips">
                {LOVE_IDEAS.map((q, i) => <button key={q} type="button" className={idea === i + 1 ? "on" : ""} onClick={() => setIdea(i + 1)}>{q}</button>)}
              </div>
              <PairInput key={idea} a="Your question" b="The answer (secret)" cta="Ask" busy={busy} maxA={140} maxB={100}
                initialA={idea ? LOVE_IDEAS[idea - 1] : ""} onSend={(text) => onMove({ action: "prompt", text })} />
            </>
          )
        ) : <Waiting text={`${peerName} is writing a question about themselves…`} />
      )}
      {active && r?.question && (
        <>
          <p className="dm-nhie-card" translate="no">{r.question}</p>
          {r.guess === null ? (
            r.asker === me
              ? <><p className="dm-xg-note small">{"Your answer: "}<b translate="no">{r.answer}</b></p><Waiting text={`${peerName} is guessing…`} /></>
              : playable && <LineInput placeholder="Your guess" cta="Guess" busy={busy} max={100} onSend={(text) => onMove({ action: "reply", text })} />
          ) : (
            <div className="dm-love-judge">
              <span><small>{r.asker === me ? `${peerName}'s guess` : "Your guess"}</small><b translate="no">{r.guess}</b></span>
              {r.answer && <span><small>The answer</small><b translate="no">{r.answer}</b></span>}
              {r.asker === me && playable ? (
                <div className="dm-love-buttons">
                  <button type="button" className="yes" disabled={busy} onClick={() => onMove({ action: "judge", cell: 1 })}>✓ Right</button>
                  <button type="button" className="no" disabled={busy} onClick={() => onMove({ action: "judge", cell: 0 })}>✗ Wrong</button>
                </div>
              ) : r.asker !== me && <Waiting text={`${peerName} is checking your guess…`} />}
            </div>
          )}
        </>
      )}
      {past.length > 0 && (
        <ul className="dm-xg-history">
          {(active ? past.slice(-2) : past).map((x, i) => (
            <li key={i} className={x.right ? "right" : "wrong"}>
              <b translate="no">{x.question}</b>
              <span translate="no">{x.right ? "✓" : "✗"} {x.guess} · {x.answer}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Question of the day                                                                           */

function Daily({ game, me, peer, busy, onMove }: BoardProps) {
  const v = view<DailyView>(game);
  const { user } = useSession();
  const peerName = first(peer.displayName);
  return (
    <div className="dm-daily">
      <p className="dm-nhie-card">{v.question}</p>
      {v.mine === null ? (
        game.status === "active" && <LineInput placeholder="Your answer" cta="Answer" busy={busy} max={300} onSend={(text) => onMove({ action: "answer", text })} />
      ) : (
        <ul className="dm-daily-answers">
          <li className="mine"><Avatar user={user ?? peer} size={22} /><span translate="no">{v.mine}</span></li>
          {v.theirs !== null
            ? <li><Avatar user={peer} size={22} /><span translate="no">{v.theirs}</span></li>
            : <li className="wait"><Avatar user={peer} size={22} /><span>{v.answered?.[1 - me] ? "Answered, hidden until you answer" : `${peerName} hasn't answered yet`}</span></li>}
        </ul>
      )}
      {v.mine === null && v.answered?.[1 - me] && <p className="dm-xg-note small">{`${peerName} answered. Answer to see it.`}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Who's more likely                                                                             */

function WhoMore({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<WhoView>(game);
  const { user } = useSession();
  const peerName = first(peer.displayName);
  const rounds = v.rounds ?? [];
  const active = game.status === "active";
  const face = (p: number) => <Avatar user={p === me ? (user ?? peer) : peer} size={20} />;
  return (
    <div className="dm-nhie">
      <div className="dm-tot-progress" aria-hidden="true">
        {Array.from({ length: v.total ?? 0 }, (_, i) => <i key={i} className={rounds[i] ? (rounds[i].picked[0] === rounds[i].picked[1] ? "same" : "diff") : i === v.round ? "now" : ""} />)}
      </div>
      {active && v.prompt && (
        <>
          <p className="dm-nhie-card">{v.prompt}</p>
          <div className="dm-nhie-options" role="group" aria-label="Who?">
            <button type="button" className={game.myChoice === "a" ? "picked" : ""} disabled={!playable} onClick={() => onMove({ choice: "a" })}>
              <Avatar user={user ?? peer} size={22} /> {"Me"}
            </button>
            <button type="button" className={game.myChoice === "b" ? "picked" : ""} disabled={!playable} onClick={() => onMove({ choice: "b" })}>
              <Avatar user={peer} size={22} /> <span translate="no">{peerName}</span>
            </button>
          </div>
        </>
      )}
      {rounds.length > 0 && (
        <ul className="dm-nhie-results">
          {(active ? rounds.slice(-1) : rounds).map((r, i) => (
            <li key={i} className={r.picked[0] === r.picked[1] ? "same" : ""}>
              <p>{r.prompt}</p>
              <span className="dm-who-picks">{"You:"} {face(r.picked[me])} · <span translate="no">{peerName}</span>: {face(r.picked[1 - me])} {r.picked[0] === r.picked[1] ? "💞" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Bucket list                                                                                   */

function Bucket({ game, me, peer, busy, onMove }: BoardProps) {
  const v = view<BucketView>(game);
  const { user } = useSession();
  const items = v.items ?? [];
  const active = game.status === "active";
  return (
    <div className="dm-bucket">
      {items.length === 0 && <p className="dm-xg-note">Things you want to do together, one day. Either of you can add and tick them off.</p>}
      <ul className="dm-bucket-list">
        {items.map((item, i) => (
          <li key={i} className={item.done ? "done" : ""}>
            <button type="button" disabled={!active || busy} aria-pressed={item.done} aria-label={item.done ? "Mark as not done" : "Mark as done"} onClick={() => onMove({ action: "toggle", cell: i })}>
              {item.done ? <Check size={14} strokeWidth={3} /> : null}
            </button>
            <span translate="no">{item.text}</span>
            <Avatar user={item.by === me ? (user ?? peer) : peer} size={18} />
          </li>
        ))}
      </ul>
      {active && (
        <>
          {items.length < (v.max ?? 40) && <LineInput placeholder="Add something we should do" cta="Add" busy={busy} max={80} onSend={(text) => onMove({ action: "add", text })} />}
          {items.length > 0 && <button type="button" className="dm-talk-chance" disabled={busy} onClick={() => onMove({ action: "close" })}>✨ Close the list</button>}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Color word                                                                                    */

const lettersOnly = (n: number) => (s: string) => [...s.replace(/[^\p{L}]/gu, "").toLocaleUpperCase("tr")].slice(0, n).join("");

function ColorWord({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<ColorView>(game);
  const peerName = first(peer.displayName);
  const r = v.rounds?.at(-1);
  const active = game.status === "active";
  const len = v.length ?? 5;
  if (!r) return null;
  const setter = r.setter === me;
  return (
    <div className="dm-color">
      <Scores game={game} me={me} peer={peer} label={`round ${Math.min(v.rounds.length, v.total)} of ${v.total}`} />
      {active && !r.ready ? (
        setter
          ? playable && <><p className="dm-xg-note">{`Pick a ${len}-letter word. ${peerName} has ${v.tries} tries: green is the right place, yellow is in the word.`}</p>
            <LineInput placeholder="Secret word" cta="Hide it" busy={busy} max={len} transform={lettersOnly(len)} onSend={(text) => onMove({ action: "prompt", text })} /></>
          : <Waiting text={`${peerName} is choosing a word…`} />
      ) : (
        <>
          <div className="dm-color-grid" translate="no" style={{ "--n": len } as CSSProperties}>
            {Array.from({ length: v.tries }, (_, row) => {
              const g = r.guesses[row];
              return Array.from({ length: len }, (_, i) => (
                <span key={`${row}-${i}`} className={g ? `m${g.marks[i]}` : ""} style={{ "--i": i } as CSSProperties}>{g ? [...g.word][i] : ""}</span>
              ));
            })}
          </div>
          {active && !setter && playable && (
            <LineInput placeholder={`${len}-letter guess`} cta="Guess" busy={busy} max={len} transform={lettersOnly(len)} onSend={(text) => onMove({ action: "guess", text })} />
          )}
          {active && setter && <p className="dm-xg-note small">{"Your word: "}<b translate="no">{r.word}</b></p>}
        </>
      )}
      {v.rounds.filter((x) => x.solved !== null).map((x, i) => (
        <p key={i} className="dm-xg-note small"><b translate="no">{x.word}</b> {x.solved ? `found in ${x.guesses.length}` : "not found"}</p>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Emoji riddle                                                                                  */

function EmojiRiddle({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<EmojiView>(game);
  const peerName = first(peer.displayName);
  const r = v.rounds?.at(-1);
  const active = game.status === "active";
  if (!r) return null;
  const teller = r.teller === me;
  return (
    <div className="dm-emoji">
      <Scores game={game} me={me} peer={peer} label={`round ${Math.min(v.rounds.length, v.total)} of ${v.total}`} />
      {active && r.clue === null ? (
        teller
          ? playable && <><p className="dm-xg-note">Describe a film, song, place or saying with emojis only.</p>
            <PairInput a="Emojis (e.g. 🦁👑)" b="The answer (secret)" cta="Send" busy={busy} maxA={40} maxB={60} onSend={(text) => onMove({ action: "prompt", text })} /></>
          : <Waiting text={`${peerName} is writing a riddle…`} />
      ) : (
        <>
          {r.clue && <p className="dm-emoji-clue" translate="no">{r.clue}</p>}
          {r.guesses.length > 0 && (
            <div className="dm-emoji-guesses" translate="no">{r.guesses.map((g, i) => <span key={i}>{g}</span>)}</div>
          )}
          {active && !teller && playable && (
            <>
              <LineInput placeholder={`Your guess (${v.tries - r.guesses.length} left)`} cta="Guess" busy={busy} max={60} onSend={(text) => onMove({ action: "guess", text })} />
              <button type="button" className="dm-talk-chance" disabled={busy} onClick={() => onMove({ action: "pass" })}>🏳️ I give up</button>
            </>
          )}
          {active && teller && <p className="dm-xg-note small">{"The answer: "}<b translate="no">{r.answer}</b></p>}
        </>
      )}
      {v.rounds.filter((x) => x.solved !== null).slice(active ? -1 : undefined).map((x, i) => (
        <p key={i} className="dm-xg-note small"><span translate="no">{x.clue} = {x.answer}</span> {x.solved ? "solved ✓" : "not solved"}</p>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Sudoku duel                                                                                   */

function Sudoku({ game, me, peer, busy, onMove }: BoardProps) {
  const v = view<SudokuView>(game);
  const { user } = useSession();
  const [sel, setSel] = useState<number | null>(null);
  const active = game.status === "active";
  const conflicts = new Set(v.conflicts ?? []);
  const holes = v.holes || 1;
  const set = (n: number) => { if (sel !== null) onMove({ action: "set", cell: sel, text: String(n) }); };
  const peerCell = (p: number) => Math.round(((v.progress?.[p] ?? 0) / holes) * 100);
  return (
    <div className="dm-sudoku">
      {[me, 1 - me].map((p) => (
        <div key={p} className={`dm-pig-player ${p === me ? "mine" : "theirs"}`}>
          <Avatar user={p === me ? (user ?? peer) : peer} size={20} />
          <span className="dm-pig-bar"><i style={{ width: `${peerCell(p)}%` }} /></span>
          <b>{peerCell(p)}%</b>
        </div>
      ))}
      <div className="dm-sudoku-grid" role="grid" aria-label="Sudoku">
        {(v.board ?? []).map((n, i) => {
          const given = !!v.puzzle?.[i];
          const peerOf = sel !== null && (Math.floor(sel / 9) === Math.floor(i / 9) || sel % 9 === i % 9);
          return (
            <button key={i} type="button" disabled={!active || given}
              className={`${given ? "given" : ""} ${sel === i ? "sel" : ""} ${peerOf ? "line" : ""} ${conflicts.has(i) ? "bad" : ""} ${sel !== null && n && v.board[sel] === n ? "same" : ""}`}
              aria-label={`Row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}${n ? `: ${n}` : ""}`}
              onClick={() => setSel(i)}>
              {n || ""}
            </button>
          );
        })}
      </div>
      {active && (
        <div className="dm-sudoku-pad" role="group" aria-label="Numbers">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} type="button" disabled={sel === null || busy} onClick={() => set(n)}>{n}</button>)}
          <button type="button" className="clear" disabled={sel === null || busy} onClick={() => set(0)} aria-label="Clear">⌫</button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Word search                                                                                   */

function WordSearch({ game, me, busy, onMove }: BoardProps) {
  const v = view<SearchView>(game);
  const [start, setStart] = useState<number | null>(null);
  const n = v.size ?? 9;
  const owner = new Map<number, string>();
  for (const w of v.words ?? []) for (const c of w.cells) owner.set(c, w.by === me ? "mine" : w.by === null ? "missed" : "theirs");
  const active = game.status === "active";
  const tap = (cell: number) => {
    if (!active || busy) return;
    if (start === null) return setStart(cell);
    if (start === cell) return setStart(null);
    onMove({ cell: start * 100 + cell });
    setStart(null);
  };
  return (
    <div className="dm-search">
      <div className="dm-search-grid" translate="no" role="grid" aria-label="Letters" style={{ "--n": n } as CSSProperties}>
        {(v.grid ?? []).map((ch, i) => (
          <button key={i} type="button" className={`${owner.get(i) ?? ""} ${start === i ? "start" : ""}`} disabled={!active} onClick={() => tap(i)}>{ch}</button>
        ))}
      </div>
      <p className="dm-xg-note small">Tap the first letter of a word, then the last one.</p>
      <div className="dm-search-words" translate="no">
        {(v.words ?? []).map((w) => <span key={w.word} className={w.by === null ? "" : w.by === me ? "mine" : "theirs"}>{w.word}</span>)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Pişti                                                                                         */

const red = (card: string) => card.endsWith("♥") || card.endsWith("♦");
function Card({ card, small, back, onClick, disabled }: { card?: string | null; small?: boolean; back?: boolean; onClick?: () => void; disabled?: boolean }) {
  const cls = `dm-card-p ${small ? "small" : ""} ${back ? "back" : ""} ${card && red(card) ? "red" : ""}`;
  const inner = back || !card ? null : <><b>{card.slice(0, -1)}</b><i>{card.slice(-1)}</i></>;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={card ?? "Card"}>{inner}</button>
    : <span className={cls} aria-label={back ? "Hidden card" : card ?? "Empty"}>{inner}</span>;
}

function Pisti({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<PistiView>(game);
  const peerName = first(peer.displayName);
  const last = v.last;
  return (
    <div className="dm-pisti">
      <Scores game={game} me={me} peer={peer} label="points" />
      <div className="dm-pisti-them" aria-label={`${v.theirCards} cards`}>
        {Array.from({ length: v.theirCards ?? 0 }, (_, i) => <Card key={i} back small />)}
      </div>
      <div className="dm-pisti-table">
        <span className="dm-pisti-deck"><Card back small /><small>{v.deck}</small></span>
        <span className="dm-pisti-pile">
          {v.under && <Card card={v.under} />}
          {v.top ? <Card key={v.top + v.pile} card={v.top} /> : <span className="dm-card-p empty" />}
          <small>{v.pile}</small>
        </span>
      </div>
      {last && (
        <p className={`dm-xg-note small ${last.pisti ? "dm-pisti-flash" : ""}`}>
          {last.pisti
            ? `${last.player === me ? "You" : peerName}: PİŞTİ! +${last.pisti}`
            : last.took ? (last.player === me ? `You took the pile with ${last.card}` : `${peerName} took the pile with ${last.card}`)
              : last.player === me ? `You played ${last.card}` : `${peerName} played ${last.card}`}
        </p>
      )}
      <div className="dm-pisti-hand">
        {(v.hand ?? []).map((c, i) => <Card key={c} card={c} onClick={() => onMove({ cell: i })} disabled={!playable} />)}
      </div>
      <p className="dm-xg-note small">{`Taken: you ${v.taken?.[me] ?? 0}, ${peerName} ${v.taken?.[1 - me] ?? 0} · Same rank or a jack takes the pile.`}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Coin toss                                                                                     */

function Coin({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<CoinView>(game);
  const peerName = first(peer.displayName);
  return (
    <div className="dm-coin">
      {v.stake === null ? (
        playable
          ? <LineInput placeholder="What's it for?" initial="Who does the dishes? 🍽️" cta="Next" busy={busy} max={100} onSend={(text) => onMove({ action: "prompt", text })} />
          : <Waiting text={`${peerName} is writing…`} />
      ) : (
        <>
          <p className="dm-nhie-card" translate="no">{v.stake}</p>
          <div className={`dm-coin-face ${v.result ? `flip ${v.result}` : ""}`} aria-label={v.result ? (v.result === "a" ? "Heads" : "Tails") : "Coin"} role="img">
            <span>{v.result === "b" ? "🌙" : "☀️"}</span>
          </div>
          {v.result ? (
            <p className="dm-xg-note small">{`${v.result === "a" ? "Heads" : "Tails"} · ${v.call === v.result ? (me === 1 ? "you called it" : `${peerName} called it`) : (me === 1 ? "you missed" : `${peerName} missed`)}`}</p>
          ) : playable ? (
            <div className="dm-nhie-options">
              <button type="button" disabled={busy} onClick={() => onMove({ choice: "a" })}>☀️ Heads</button>
              <button type="button" disabled={busy} onClick={() => onMove({ choice: "b" })}>🌙 Tails</button>
            </div>
          ) : <Waiting text={`${peerName} is calling it…`} />}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Spin the wheel                                                                                */

const WHEEL_COLORS = ["#ff8787", "#ffa94d", "#ffd43b", "#69db7c", "#4dabf7", "#9775fa", "#f783ac", "#38d9a9"];
function Wheel({ game, peer, playable, busy, onMove }: BoardProps) {
  const v = view<WheelView>(game);
  const [text, setText] = useState("Pizza\nSushi\nKebab\nBurger");
  const peerName = first(peer.displayName);
  const options = v.options ?? [];
  const n = options.length || 1;
  const turn = v.result === null ? 0 : 5 * 360 + (360 - (v.result + 0.5) * (360 / n));
  return (
    <div className="dm-wheel">
      {v.options === null ? (
        playable ? (
          <form className="dm-wheel-form" onSubmit={(e) => { e.preventDefault(); if (!busy) onMove({ action: "prompt", text }); }}>
            <textarea value={text} rows={5} maxLength={330} onChange={(e) => setText(e.target.value)} aria-label="Options, one per line" />
            <small className="dm-xg-note small">{`One option per line (2–8). ${peerName} spins.`}</small>
            <button type="submit" className="dm-talk-send" disabled={busy}>Next</button>
          </form>
        ) : <Waiting text={`${peerName} is writing the options…`} />
      ) : (
        <>
          <div className="dm-wheel-wrap">
            <svg viewBox="-100 -100 200 200" className="dm-wheel-disc" style={{ transform: `rotate(${turn}deg)` }} aria-hidden="true">
              {options.map((o, i) => {
                const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
                const mid = (a0 + a1) / 2;
                return (
                  <g key={i}>
                    <path d={`M0 0 L${95 * Math.cos(a0)} ${95 * Math.sin(a0)} A95 95 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${95 * Math.cos(a1)} ${95 * Math.sin(a1)} Z`} fill={WHEEL_COLORS[i % WHEEL_COLORS.length]} />
                    <text x={58 * Math.cos(mid)} y={58 * Math.sin(mid)} transform={`rotate(${(mid * 180) / Math.PI} ${58 * Math.cos(mid)} ${58 * Math.sin(mid)})`} textAnchor="middle" dominantBaseline="middle">
                      {o.length > 12 ? `${o.slice(0, 11)}…` : o}
                    </text>
                  </g>
                );
              })}
            </svg>
            <span className="dm-wheel-pointer" aria-hidden="true">▼</span>
          </div>
          {v.result !== null ? <p className="dm-wheel-result" translate="no">🎉 {options[v.result]}</p>
            : playable ? <button type="button" className="dm-talk-send dm-wheel-spin" disabled={busy} onClick={() => onMove({ action: "roll" })}>🎡 Spin</button>
              : <Waiting text={`${peerName} is spinning…`} />}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Dama                                                                                          */

function Dama({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<DamaView>(game);
  const [sel, setSel] = useState<number[]>([]);
  const flip = me === 1;
  const moves = playable ? v.moves ?? [] : [];
  const fits = (m: number[], prefix: number[]) => prefix.every((c, i) => m[i] === c);
  const options = moves.filter((m) => fits(m, sel));
  const targets = new Set(sel.length ? options.map((m) => m[sel.length]).filter((c) => c !== undefined) : []);
  const starts = new Set(moves.map((m) => m[0]));
  const tap = (cell: number) => {
    if (!playable) return;
    if (starts.has(cell) && (sel.length <= 1 || !targets.has(cell))) return setSel(sel[0] === cell ? [] : [cell]);
    if (!targets.has(cell)) return setSel([]);
    const next = [...sel, cell];
    const rest = moves.filter((m) => fits(m, next));
    if (rest.some((m) => m.length === next.length)) { onMove({ action: "move", text: next.join("-") }); setSel([]); }
    else setSel(next);
  };
  const lastSet = new Set(v.last ?? []);
  const cells = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));
  const mine = (val: number) => val !== 0 && (val % 2 === 1 ? 0 : 1) === me;
  return (
    <div className="dm-dama">
      <div className="dm-battle-count">
        <span>{`You took ${v.captured?.[me] ?? 0}`}</span>
        <span>{`${first(peer.displayName)} took ${v.captured?.[1 - me] ?? 0}`}</span>
      </div>
      <div className="dm-dama-board" role="grid" aria-label="Dama board">
        {cells.map((cell) => {
          const val = v.board?.[cell] ?? 0;
          return (
            <button key={cell} type="button" disabled={!playable || (!starts.has(cell) && !targets.has(cell) && !(sel.length && cell === sel[0]))}
              className={`${(Math.floor(cell / 8) + cell) % 2 ? "dark" : ""} ${sel.includes(cell) ? "sel" : ""} ${targets.has(cell) ? "target" : ""} ${lastSet.has(cell) ? "last" : ""} ${starts.has(cell) && !sel.length ? "can" : ""}`}
              onClick={() => tap(cell)} aria-label={val ? (mine(val) ? "Your piece" : "Their piece") : `Square ${cell + 1}`}>
              {val ? <span className={`piece ${mine(val) ? "mine" : "theirs"} ${val >= 3 ? "king" : ""}`}>{val >= 3 ? "♛" : ""}</span> : null}
            </button>
          );
        })}
      </div>
      <p className="dm-xg-note small">Men move diagonally forward and take forward or backward. Taking is a must; a king flies along the diagonals.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Tavla                                                                                         */

function Die({ n, used }: { n: number; used?: boolean }) {
  const pips: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <span className={`dm-die small ${used ? "used" : ""}`} aria-label={`${n}`} role="img">
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={pips[n]?.includes(i) ? "pip" : ""} />)}
    </span>
  );
}

function Tavla({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<TavlaView>(game);
  const [from, setFrom] = useState<number | null>(null);
  const peerName = first(peer.displayName);
  const meIdx = Math.max(0, me);
  // Everything from the viewer's side: their home is bottom right, their checkers are positive.
  const toView = (i: number) => (meIdx === 0 ? i : 23 - i);
  const fromView = toView;
  const pts = Array.from({ length: 24 }, (_, vi) => (v.points?.[fromView(vi)] ?? 0) * (meIdx === 0 ? 1 : -1));
  const steps = playable ? v.steps ?? [] : [];
  const fromSet = new Set(steps.map((s) => (s.from === 24 ? 24 : toView(s.from))));
  const dests = new Map<number, TavlaStep>();
  if (from !== null) for (const s of steps) if ((s.from === 24 ? 24 : toView(s.from)) === from) dests.set(s.to === -1 ? -1 : toView(s.to), s);
  const tap = (vi: number) => {
    if (!playable || busy) return;
    if (from !== null && dests.has(vi)) {
      const s = dests.get(vi)!;
      onMove({ action: "move", cell: s.from, text: String(s.die) });
      setFrom(null);
      return;
    }
    setFrom(fromSet.has(vi) && from !== vi ? vi : null);
  };
  const remaining = [...(v.dice ?? [])];
  const shownDice = (v.rolled ?? []).length === 2 && v.rolled[0] === v.rolled[1] ? [v.rolled[0], v.rolled[0], v.rolled[0], v.rolled[0]] : v.rolled ?? [];
  const usedFlags = shownDice.map((d) => { const k = remaining.indexOf(d); if (k >= 0) { remaining.splice(k, 1); return false; } return true; });
  const point = (vi: number, top: boolean) => {
    const n = pts[vi];
    const count = Math.abs(n);
    return (
      <button key={vi} type="button" className={`dm-tv-point ${top ? "top" : "bottom"} ${vi % 2 ? "odd" : ""} ${from === vi ? "sel" : ""} ${dests.has(vi) ? "dest" : ""} ${fromSet.has(vi) && from === null ? "can" : ""}`}
        onClick={() => tap(vi)} disabled={!playable} aria-label={`Point ${vi + 1}: ${count ? `${count} ${n > 0 ? "yours" : "theirs"}` : "empty"}`}>
        <span className="dm-tv-stack">
          {Array.from({ length: Math.min(count, 5) }, (_, k) => (
            <i key={k} className={n > 0 ? "mine" : "theirs"}>{k === 4 && count > 5 ? count : ""}</i>
          ))}
        </span>
      </button>
    );
  };
  const lastLog = v.log?.at(-1);
  return (
    <div className="dm-tavla">
      <div className="dm-tv-board">
        <div className="dm-tv-half">{[12, 13, 14, 15, 16, 17].map((vi) => point(vi, true))}</div>
        <button type="button" className={`dm-tv-bar ${from === 24 ? "sel" : ""} ${fromSet.has(24) ? "can" : ""}`} onClick={() => tap(24)} disabled={!playable} aria-label="Bar">
          {Array.from({ length: v.bar?.[1 - meIdx] ?? 0 }, (_, k) => <i key={`t${k}`} className="theirs" />)}
          <span className="dm-tv-dice">{shownDice.map((d, k) => <Die key={k} n={d} used={usedFlags[k]} />)}</span>
          {Array.from({ length: v.bar?.[meIdx] ?? 0 }, (_, k) => <i key={`m${k}`} className="mine" />)}
        </button>
        <div className="dm-tv-half">{[18, 19, 20, 21, 22, 23].map((vi) => point(vi, true))}</div>
        <div className="dm-tv-half">{[11, 10, 9, 8, 7, 6].map((vi) => point(vi, false))}</div>
        <span className="dm-tv-gap" />
        <div className="dm-tv-half">{[5, 4, 3, 2, 1, 0].map((vi) => point(vi, false))}</div>
        <button type="button" className={`dm-tv-off ${dests.has(-1) ? "dest" : ""}`} onClick={() => tap(-1)} disabled={!dests.has(-1)} aria-label="Bear off">
          <small>{v.off?.[1 - meIdx] ?? 0}</small>
          <span>⬇</span>
          <b>{v.off?.[meIdx] ?? 0}</b>
        </button>
      </div>
      <div className="dm-tv-foot">
        {playable ? <span>{from === null ? "Tap a checker to move" : "Tap where it goes"}</span>
          : game.status === "active" ? <span>{`${peerName} is playing…`}</span> : <span />}
        {v.canUndo && <button type="button" className="dm-tv-undo" disabled={busy} onClick={() => { setFrom(null); onMove({ action: "undo" }); }}><RotateCcw size={13} /> Undo</button>}
      </div>
      {lastLog?.blocked && <p className="dm-xg-note small">{lastLog.player === me ? "You couldn't move, so your turn passed" : `${peerName} couldn't move`}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Chess                                                                                         */

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
function Chess({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<ChessView>(game);
  const [sel, setSel] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const flip = me === 1;
  const legal = playable ? v.legal ?? [] : [];
  const parsed = legal.map((m) => { const [a, rest] = m.split("-"); const [b, p] = rest.split("="); return { from: Number(a), to: Number(b), promo: p }; });
  const fromSet = new Set(parsed.map((m) => m.from));
  const targets = new Set(sel === null ? [] : parsed.filter((m) => m.from === sel).map((m) => m.to));
  const myColor = (p: string) => (p === p.toUpperCase() ? 0 : 1) === me;
  const kingInCheck = v.check ? (v.board ?? []).indexOf(v.toMove === 0 ? "K" : "k") : -1;
  const tap = (cell: number) => {
    if (!playable) return;
    if (sel !== null && targets.has(cell)) {
      const options = parsed.filter((m) => m.from === sel && m.to === cell);
      if (options.some((m) => m.promo)) setPromo({ from: sel, to: cell });
      else onMove({ action: "move", text: `${sel}-${cell}` });
      setSel(null);
      return;
    }
    setSel(fromSet.has(cell) && sel !== cell ? cell : null);
  };
  const cells = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));
  const lastSet = new Set(v.last ?? []);
  const files = flip ? "hgfedcba" : "abcdefgh";
  return (
    <div className="dm-chess">
      <div className="dm-chess-captured theirs" aria-label="Pieces you took">{(v.captured?.[1 - me] ?? []).map((p, i) => <span key={i}>{GLYPH[p.toLowerCase()]}</span>)}</div>
      <div className="dm-chess-board" role="grid" aria-label="Chess board">
        {cells.map((cell, i) => {
          const p = v.board?.[cell] ?? "";
          const dark = (Math.floor(cell / 8) + cell) % 2 === 1;
          return (
            <button key={cell} type="button" disabled={!playable}
              className={`${dark ? "dark" : ""} ${sel === cell ? "sel" : ""} ${targets.has(cell) ? (p ? "take" : "target") : ""} ${lastSet.has(cell) ? "last" : ""} ${kingInCheck === cell ? "check" : ""}`}
              onClick={() => tap(cell)} aria-label={`${"abcdefgh"[cell % 8]}${8 - Math.floor(cell / 8)}${p ? ` ${p}` : ""}`}>
              {p && <span className={`pc ${p === p.toUpperCase() ? "w" : "b"} ${myColor(p) ? "mine" : ""}`}>{GLYPH[p.toLowerCase()]}</span>}
              {i % 8 === 0 && <small className="rank">{flip ? Math.floor(i / 8) + 1 : 8 - Math.floor(i / 8)}</small>}
              {i >= 56 && <small className="file">{files[i % 8]}</small>}
            </button>
          );
        })}
      </div>
      <div className="dm-chess-captured mine" aria-label="Pieces they took">{(v.captured?.[me] ?? []).map((p, i) => <span key={i}>{GLYPH[p.toLowerCase()]}</span>)}</div>
      {promo && (
        <div className="dm-chess-promo" role="group" aria-label="Promote to">
          {(["q", "r", "b", "n"] as const).map((t) => (
            <button key={t} type="button" onClick={() => { onMove({ action: "move", text: `${promo.from}-${promo.to}=${t}` }); setPromo(null); }}>
              <span className={`pc ${me === 0 ? "w" : "b"}`}>{GLYPH[t]}</span>
            </button>
          ))}
          <button type="button" className="cancel" onClick={() => setPromo(null)}>✕</button>
        </div>
      )}
      <p className="dm-xg-note small">{me === 0 ? "You play white" : "You play black"}{v.lastText ? ` · last: ${v.lastText}` : ""}</p>
    </div>
  );
}
