"use client";
/**
 * The second batch of chat games: Hangman, Number Puzzle, Dots and Boxes, Reversi, Mangala,
 * Battleship, Dice Duel, Word Chain, Two Truths and a Lie, Never Have I Ever, How Well Do You
 * Know Me and Story Together. The server sends each one's visible state in `game.view`.
 */
import { useState, type CSSProperties, type FormEvent } from "react";
import { Loader2, Send } from "lucide-react";
import type { Models } from "@/lib/api/client";
import { useSession } from "./providers";
import { Avatar } from "./ui";

type Game = Models["ChatGameDto"];
type Peer = Models["MessagePeerDto"];
export type ExtraMove = { cell?: number; choice?: "a" | "b"; action?: Models["GameMoveDto"]["action"]; text?: string };

export const EXTRA_KINDS = ["hangman", "bulls", "dots", "reversi", "mangala", "battleship", "pig", "wordchain", "lies", "nhie", "knowme", "story"] as const;
type ExtraKind = (typeof EXTRA_KINDS)[number];
export const isExtraKind = (kind: Game["kind"]): kind is ExtraKind => (EXTRA_KINDS as readonly string[]).includes(kind);

/* View shapes (mirror server/src/modules/social/games-extra.ts `extraView`). */
type HangmanRound = { setter: number; guessed: string[]; wrong: number; solved: boolean | null; ready: boolean; word: string | null; masked: string[] };
type HangmanView = { lives: number; scores: number[]; total: number; rounds: HangmanRound[] };
type BullsGuess = { guess: string; plus: number; minus: number };
type BullsView = { phase: "set" | "guess"; max: number; mySecret: string | null; theirSecret: string | null; ready: boolean[]; guesses: BullsGuess[][] };
type DotsView = { size: number; lines: number[]; boxes: number[]; last: number | null; scores: number[] };
type ReversiView = { size: number; board: number[]; last: number | null; passed: number | null; scores: number[] };
type MangalaView = { pits: number[]; last: { player: number; pit: number; extra: boolean; captured: number } | null; scores: number[] };
type SeaView = { size: number; fleet: number[]; mine: number[]; theirs: number[]; afloat: number[]; lastShots: (number | null)[] };
type PigView = { target: number; scores: number[]; rolls: number[]; turnTotal: number; log: { player: number; rolls: number[]; banked: number; bust: boolean }[] };
type ChainView = { words: { by: number; word: string }[]; letter: string | null; max: number; gaveUp: number | null };
type LiesView = { scores: number[]; total: number; rounds: { teller: number; statements: string[] | null; guess: number | null; lie: number | null }[] };
type NhieView = { round: number; total: number; prompt: string | null; rounds: { prompt: string; answers: ("a" | "b")[] }[] };
type KnowView = {
  round: number; total: number; question: [string, string, string] | null; myGuess: "a" | "b" | null; scores: number[];
  rounds: { question: [string, string, string]; answers: ("a" | "b")[]; guesses: ("a" | "b")[] }[];
};
type StoryView = { starter: string; lines: { by: number; text: string }[]; total: number; max: number };

const view = <T,>(game: Game) => (game.view ?? {}) as T;
const first = (name: string) => name.split(" ")[0];

/** Games where both answer at the same time (Number Puzzle only while picking the numbers). */
export function extraSimultaneous(game: Game) {
  if (game.kind === "nhie" || game.kind === "knowme") return true;
  return game.kind === "bulls" && view<BullsView>(game).phase === "set";
}
/** Whether the viewer has already answered this round of a simultaneous game. */
export function extraAnswered(game: Game, me: number) {
  if (game.kind === "bulls") return !!view<BullsView>(game).ready?.[me];
  return !!game.myChoice;
}
export function extraPeerAnswered(game: Game, me: number) {
  if (game.kind === "bulls") return !!view<BullsView>(game).ready?.[1 - me];
  return game.peerReady;
}

/** The line under the game's title while it's going on. */
export function extraStatus(game: Game, me: number, peerName: string, myTurn: boolean): string {
  const v = game.view ?? {};
  switch (game.kind) {
    case "hangman": {
      const r = (v as HangmanView).rounds?.at(-1);
      if (!r) return myTurn ? "Your turn" : `${peerName}'s turn`;
      if (!r.ready) return r.setter === me ? "Choose a secret word" : `${peerName} is choosing a word…`;
      return r.setter === me ? `${peerName} is guessing your word` : "Guess the word";
    }
    case "bulls": {
      const b = v as BullsView;
      if (b.phase === "set") return b.ready?.[me] ? `Waiting for ${peerName}…` : "Pick your secret number";
      return myTurn ? "Guess their number" : `${peerName} is guessing…`;
    }
    case "nhie":
    case "knowme":
      return game.myChoice ? `Waiting for ${peerName}…` : game.peerReady ? `${peerName} answered — your turn` : `Question ${game.round + 1} of ${game.totalRounds}`;
    case "lies": {
      const r = (v as LiesView).rounds?.at(-1);
      if (r && !r.statements) return r.teller === me ? "Write two truths and a lie" : `${peerName} is writing…`;
      return myTurn ? "Which one is the lie?" : `${peerName} is guessing…`;
    }
    case "wordchain":
      return myTurn ? ((v as ChainView).letter ? `Your word starts with ${(v as ChainView).letter!.toLocaleUpperCase("tr")}` : "Start with any word") : `${peerName}'s turn`;
    case "story":
      return myTurn ? "Write the next line" : `${peerName} is writing…`;
    case "pig":
      return myTurn ? "Roll or hold" : `${peerName} is rolling…`;
    default:
      return myTurn ? "Your turn" : `${peerName}'s turn`;
  }
}
/** The line once a game nobody wins ("done") is over. */
export function extraDone(game: Game) {
  if (game.kind === "nhie") {
    const same = view<NhieView>(game).rounds?.filter((r) => r.answers[0] === "a" && r.answers[1] === "a").length ?? 0;
    return `You've both done ${same} of these 🙊`;
  }
  if (game.kind === "story") return "The end 📖";
  return "Well played 💞";
}

/* -------------------------------------------------------------------------------------------- */

type BoardProps = { game: Game; me: number; peer: Peer; playable: boolean; busy: boolean; onMove: (move: ExtraMove) => void };

export function Scores({ game, me, peer, label }: { game: Game; me: number; peer: Peer; label: string }) {
  const { user } = useSession();
  const s = game.scores ?? [];
  return (
    <div className="dm-game-score">
      <span><Avatar user={user ?? peer} size={22} /> <b>{s[me] ?? 0}</b></span>
      <small>{label}</small>
      <span><b>{s[1 - me] ?? 0}</b> <Avatar user={peer} size={22} /></span>
    </div>
  );
}

/** A one-line written move. */
export function LineInput({ placeholder, busy, cta, onSend, max = 300, inputMode, pattern, transform, initial = "" }: {
  placeholder: string; busy: boolean; cta: string; onSend: (text: string) => void; max?: number;
  inputMode?: "numeric" | "text"; pattern?: string; transform?: (s: string) => string; initial?: string;
}) {
  const [text, setText] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && !busy) { onSend(text.trim()); setText(""); }
  };
  return (
    <form className="dm-xg-line" onSubmit={submit}>
      <input
        value={text}
        maxLength={max}
        placeholder={placeholder}
        aria-label={placeholder}
        inputMode={inputMode}
        pattern={pattern}
        autoComplete="off"
        enterKeyHint="send"
        onChange={(e) => setText(transform ? transform(e.target.value) : e.target.value)}
      />
      <button type="submit" disabled={!text.trim() || busy} aria-label={cta}>
        {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        <span>{cta}</span>
      </button>
    </form>
  );
}

export function Waiting({ text }: { text: string }) {
  return (
    <p className="dm-talk-wait">
      <span className="dm-talk-dots" aria-hidden="true"><i /><i /><i /></span>
      {text}
    </p>
  );
}

export function ExtraBoard(props: BoardProps) {
  switch (props.game.kind) {
    case "hangman": return <Hangman {...props} />;
    case "bulls": return <Bulls {...props} />;
    case "dots": return <Dots {...props} />;
    case "reversi": return <Reversi {...props} />;
    case "mangala": return <Mangala {...props} />;
    case "battleship": return <Battleship {...props} />;
    case "pig": return <Pig {...props} />;
    case "wordchain": return <WordChain {...props} />;
    case "lies": return <Lies {...props} />;
    case "nhie": return <Nhie {...props} />;
    case "knowme": return <KnowMe {...props} />;
    case "story": return <Story {...props} />;
    default: return null;
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Hangman                                                                                       */

const LETTERS = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWX".split("");

function Gallows({ wrong, lives }: { wrong: number; lives: number }) {
  // Six parts: head, body, two arms, two legs (scaled if the server ever changes the lives).
  const shown = Math.round((wrong / lives) * 6);
  const part = (i: number) => (shown > i ? "on" : "");
  return (
    <svg className="dm-hang-art" viewBox="0 0 120 120" aria-label={`${wrong} of ${lives} wrong`} role="img">
      <path className="dm-hang-wood" d="M14 112h60M30 112V10h50v14" />
      <circle className={part(0)} cx="80" cy="34" r="10" />
      <path className={part(1)} d="M80 44v32" />
      <path className={part(2)} d="M80 52l-14 12" />
      <path className={part(3)} d="M80 52l14 12" />
      <path className={part(4)} d="M80 76l-12 18" />
      <path className={part(5)} d="M80 76l12 18" />
    </svg>
  );
}

function Hangman({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<HangmanView>(game);
  const round = v.rounds?.at(-1);
  const active = game.status === "active";
  const peerName = first(peer.displayName);
  if (!round) return null;
  const setter = round.setter === me;
  const guessing = active && round.ready && !setter;
  return (
    <div className="dm-hang">
      <Scores game={game} me={me} peer={peer} label={`round ${Math.min(v.rounds.length, v.total)} of ${v.total}`} />
      {active && !round.ready ? (
        setter ? (
          playable && (
            <>
              <p className="dm-xg-note">{`Pick a word or a short phrase. ${peerName} guesses it letter by letter.`}</p>
              <LineInput placeholder="Secret word" cta="Hide it" busy={busy} max={30} onSend={(text) => onMove({ action: "prompt", text })} />
            </>
          )
        ) : <Waiting text={`${peerName} is choosing a word…`} />
      ) : (
        <>
          <div className="dm-hang-stage">
            <Gallows wrong={round.wrong} lives={v.lives} />
            <div className="dm-hang-word" translate="no" aria-label="The word">
              {round.masked.map((ch, i) => (ch === " " ? <i key={i} className="gap" /> : <span key={i} className={ch ? "shown" : ""}>{ch}</span>))}
            </div>
          </div>
          <div className="dm-hang-lives" aria-hidden="true">
            {Array.from({ length: v.lives }, (_, i) => <i key={i} className={i < round.wrong ? "lost" : ""}>❤</i>)}
          </div>
          {guessing && (
            <>
              <div className="dm-hang-keys" role="group" aria-label="Letters">
                {LETTERS.map((l) => {
                  const tried = round.guessed.includes(l);
                  const hit = tried && round.masked.includes(l);
                  return (
                    <button key={l} type="button" className={tried ? (hit ? "hit" : "miss") : ""} disabled={!playable || tried}
                      onClick={() => onMove({ action: "guess", text: l })}>{l}</button>
                  );
                })}
              </div>
              {playable && (
                <LineInput placeholder="Know it? Guess the whole word (a miss costs 2)" cta="Solve" busy={busy} max={30} onSend={(text) => onMove({ action: "solve", text })} />
              )}
            </>
          )}
          {active && setter && round.ready && (
            <p className="dm-xg-note">Your word: <b translate="no">{round.word}</b></p>
          )}
        </>
      )}
      {v.rounds.filter((r) => r.solved !== null).length > 0 && (
        <ul className="dm-xg-history">
          {v.rounds.filter((r) => r.solved !== null).map((r, i) => (
            <li key={i}>
              <b translate="no">{r.word}</b>
              <span>{r.solved ? (r.setter === me ? `${peerName} found it` : "You found it 🎉") : r.setter === me ? `${peerName} got hanged` : "Hanged 😵"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Number puzzle (Bulls and cows)                                                                */

const digitsOnly = (s: string) => s.replace(/\D/g, "").slice(0, 4);

function GuessList({ guesses, title }: { guesses: BullsGuess[]; title: string }) {
  return (
    <div className="dm-bulls-col">
      <small>{title}</small>
      {guesses.length === 0 ? <span className="dm-bulls-empty">—</span> : (
        <ol>
          {guesses.map((g, i) => (
            <li key={i} className={g.plus === 4 ? "solved" : ""}>
              <b translate="no">{g.guess}</b>
              <span className="plus">+{g.plus}</span>
              <span className="minus">−{g.minus}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Bulls({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<BullsView>(game);
  const peerName = first(peer.displayName);
  const active = game.status === "active";
  return (
    <div className="dm-bulls">
      {v.phase === "set" ? (
        v.ready?.[me] ? (
          <Waiting text={`${peerName} is picking a number…`} />
        ) : (
          <>
            <p className="dm-xg-note">{"Pick 4 different digits (not starting with 0). Then take turns guessing each other's number: + is a right digit in the right place, − a right digit in the wrong place."}</p>
            <LineInput placeholder="Your secret number" cta="Lock in" busy={busy || !playable} inputMode="numeric" max={4} transform={digitsOnly} onSend={(text) => onMove({ action: "set", text })} />
          </>
        )
      ) : (
        <>
          <div className="dm-bulls-secrets">
            <span>{"Your number"} <b translate="no">{v.mySecret ?? "····"}</b></span>
            <span>{"Their number"} <b translate="no">{v.theirSecret ?? "????"}</b></span>
          </div>
          <div className="dm-bulls-cols">
            <GuessList title="Your guesses" guesses={v.guesses?.[me] ?? []} />
            <GuessList title="Their guesses" guesses={v.guesses?.[1 - me] ?? []} />
          </div>
          {active && playable && (
            <LineInput placeholder="Your guess" cta="Guess" busy={busy} inputMode="numeric" max={4} transform={digitsOnly} onSend={(text) => onMove({ action: "guess", text })} />
          )}
          {active && <p className="dm-xg-note small">{`${v.guesses?.[me]?.length ?? 0}/${v.max} guesses`}</p>}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Dots and boxes                                                                                */

function Dots({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<DotsView>(game);
  const n = v.size ?? 4;
  const H = (n + 1) * n;
  const gap = 50, pad = 14, size = n * gap + pad * 2;
  const owner = (value: number) => (value === 0 ? "" : value - 1 === me ? "mine" : "theirs");
  const lines: { id: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) lines.push({ id: r * n + c, x1: c, y1: r, x2: c + 1, y2: r });
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) lines.push({ id: H + r * (n + 1) + c, x1: c, y1: r, x2: c, y2: r + 1 });
  const at = (k: number) => pad + k * gap;
  return (
    <div className="dm-dots">
      <Scores game={game} me={me} peer={peer} label="boxes" />
      <svg viewBox={`0 0 ${size} ${size}`} className="dm-dots-board" role="grid" aria-label="Dots and boxes">
        {v.boxes?.map((b, i) => b ? (
          <rect key={`b${i}`} className={`box ${owner(b)}`} x={at(i % n) + 3} y={at(Math.floor(i / n)) + 3} width={gap - 6} height={gap - 6} rx={6} />
        ) : null)}
        {lines.map((l) => {
          const value = v.lines?.[l.id] ?? 0;
          const free = !value && playable;
          return (
            <g key={l.id} className={`line ${owner(value)} ${value ? "set" : ""} ${v.last === l.id ? "last" : ""} ${free ? "free" : ""}`}>
              <line x1={at(l.x1)} y1={at(l.y1)} x2={at(l.x2)} y2={at(l.y2)} />
              {free && (
                <line className="hit" x1={at(l.x1)} y1={at(l.y1)} x2={at(l.x2)} y2={at(l.y2)} role="button" aria-label={`Line ${l.id + 1}`}
                  onClick={() => onMove({ cell: l.id })} />
              )}
            </g>
          );
        })}
        {Array.from({ length: (n + 1) * (n + 1) }, (_, i) => (
          <circle key={`d${i}`} className="dot" cx={at(i % (n + 1))} cy={at(Math.floor(i / (n + 1)))} r={4.5} />
        ))}
      </svg>
      <p className="dm-xg-note small">Close a box to score and draw again.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Reversi                                                                                       */

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
function legal(board: number[], size: number, mark: number) {
  const ok = new Set<number>();
  board.forEach((v, cell) => {
    if (v) return;
    const r0 = Math.floor(cell / size), c0 = cell % size;
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr, c = c0 + dc, run = 0;
      while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === 3 - mark) { r += dr; c += dc; run++; }
      if (run && r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === mark) { ok.add(cell); return; }
    }
  });
  return ok;
}

function Reversi({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<ReversiView>(game);
  const size = v.size ?? 8;
  const hints = playable ? legal(v.board ?? [], size, me + 1) : new Set<number>();
  return (
    <div className="dm-reversi">
      <Scores game={game} me={me} peer={peer} label="discs" />
      {v.passed !== null && v.passed !== undefined && game.status === "active" && (
        <p className="dm-xg-note small">{v.passed === me ? "You had no move, so you passed" : `${first(peer.displayName)} had no move and passed`}</p>
      )}
      <div className="dm-reversi-board" role="grid" aria-label="Reversi board" style={{ "--n": size } as CSSProperties}>
        {(v.board ?? []).map((value, cell) => (
          <button key={cell} type="button" className={`${hints.has(cell) ? "hint" : ""} ${v.last === cell ? "last" : ""}`}
            disabled={!hints.has(cell)} aria-label={value ? (value - 1 === me ? "Your disc" : "Their disc") : `Square ${cell + 1}`}
            onClick={() => onMove({ cell })}>
            {value ? <span className={`disc ${value - 1 === me ? "mine" : "theirs"}`} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Mangala                                                                                       */

function Stones({ n }: { n: number }) {
  return (
    <span className="dm-mangala-stones" aria-hidden="true">
      {Array.from({ length: Math.min(n, 12) }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
    </span>
  );
}

function Mangala({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<MangalaView>(game);
  const p = v.pits ?? [];
  const mine = Math.max(0, me) * 7, theirs = (1 - Math.max(0, me)) * 7;
  const peerName = first(peer.displayName);
  const last = v.last;
  return (
    <div className="dm-mangala">
      <Scores game={game} me={me} peer={peer} label="stones" />
      <div className="dm-mangala-board" aria-label="Mangala board">
        <div className="dm-mangala-store theirs" aria-label={`${peerName}'s store: ${p[theirs + 6] ?? 0}`}><b>{p[theirs + 6] ?? 0}</b><Stones n={p[theirs + 6] ?? 0} /></div>
        <div className="dm-mangala-row theirs">
          {[5, 4, 3, 2, 1, 0].map((i) => (
            <span key={i} className={`dm-mangala-pit ${last && last.pit === theirs + i ? "last" : ""}`} aria-label={`${p[theirs + i]} stones`}>
              <Stones n={p[theirs + i] ?? 0} /><b>{p[theirs + i] ?? 0}</b>
            </span>
          ))}
        </div>
        <div className="dm-mangala-row mine">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <button key={i} type="button" className={`dm-mangala-pit ${last && last.pit === mine + i ? "last" : ""}`} disabled={!playable || !p[mine + i]}
              aria-label={`Your pit ${i + 1}: ${p[mine + i]} stones`} onClick={() => onMove({ cell: i })}>
              <Stones n={p[mine + i] ?? 0} /><b>{p[mine + i] ?? 0}</b>
            </button>
          ))}
        </div>
        <div className="dm-mangala-store mine" aria-label={`Your store: ${p[mine + 6] ?? 0}`}><b>{p[mine + 6] ?? 0}</b><Stones n={p[mine + 6] ?? 0} /></div>
      </div>
      {last && game.status === "active" && (last.extra || last.captured > 0) && (
        <p className="dm-xg-note small">
          {last.player === me
            ? last.extra ? "You ended in your store: one more turn" : `You captured ${last.captured}`
            : last.extra ? `${peerName} ended in their store: one more turn` : `${peerName} captured ${last.captured}`}
        </p>
      )}
      <p className="dm-xg-note small">Your pits are at the bottom. The first stone stays, the rest go right. End in your store to play again; make their pit even to take it.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Battleship                                                                                    */

function Sea({ cells, size, target, last, playable, onFire }: { cells: number[]; size: number; target: boolean; last: number | null; playable: boolean; onFire?: (cell: number) => void }) {
  const names = ["water", "ship", "hit", "miss", "sunk"];
  return (
    <div className={`dm-sea ${target ? "target" : "own"}`} role="grid" style={{ "--n": size } as CSSProperties}>
      {cells.map((c, i) => target ? (
        <button key={i} type="button" className={`${names[c]} ${last === i ? "last" : ""}`} disabled={!playable || c !== 0}
          aria-label={c === 0 ? `Fire at ${String.fromCharCode(65 + (i % size))}${Math.floor(i / size) + 1}` : names[c]} onClick={() => onFire?.(i)}>
          {c === 2 || c === 4 ? "💥" : c === 3 ? "•" : null}
        </button>
      ) : (
        <span key={i} className={`${names[c]} ${last === i ? "last" : ""}`} aria-hidden="true">{c === 2 || c === 4 ? "✕" : c === 3 ? "•" : null}</span>
      ))}
    </div>
  );
}

function Battleship({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<SeaView>(game);
  const peerName = first(peer.displayName);
  return (
    <div className="dm-battle">
      <div className="dm-battle-count">
        <span>{`Your ships ${v.afloat?.[0] ?? 0}/${v.fleet?.length ?? 0}`}</span>
        <span>{`Their ships ${v.afloat?.[1] ?? 0}/${v.fleet?.length ?? 0}`}</span>
      </div>
      <small className="dm-battle-label">{`${peerName}'s sea · tap to fire`}</small>
      <Sea cells={v.theirs ?? []} size={v.size ?? 8} target last={v.lastShots?.[0] ?? null} playable={playable} onFire={(cell) => onMove({ cell })} />
      <small className="dm-battle-label">Your fleet</small>
      <Sea cells={v.mine ?? []} size={v.size ?? 8} target={false} last={v.lastShots?.[1] ?? null} playable={false} />
      <p className="dm-xg-note small">A hit lets you fire again. Ships never touch each other.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Dice duel                                                                                     */

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function Die({ value, rolling }: { value: number | null; rolling?: boolean }) {
  return (
    <span key={value ?? 0} className={`dm-die ${value === 1 ? "bust" : ""} ${rolling ? "rolling" : ""}`} aria-label={value ? `Rolled ${value}` : "Die"} role="img">
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={value && PIPS[value]?.includes(i) ? "pip" : ""} />)}
    </span>
  );
}

function Pig({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<PigView>(game);
  const { user } = useSession();
  const peerName = first(peer.displayName);
  const lastTurn = v.log?.at(-1);
  const shown = v.rolls?.length ? v.rolls.at(-1)! : lastTurn?.rolls.at(-1) ?? null;
  const bar = (who: number) => Math.min(100, Math.round(((v.scores?.[who] ?? 0) / (v.target || 50)) * 100));
  return (
    <div className="dm-pig">
      {[me, 1 - me].map((who) => (
        <div key={who} className={`dm-pig-player ${who === me ? "mine" : "theirs"}`}>
          <Avatar user={who === me ? (user ?? peer) : peer} size={22} />
          <span className="dm-pig-bar"><i style={{ width: `${bar(who)}%` }} /></span>
          <b>{v.scores?.[who] ?? 0}</b>
        </div>
      ))}
      <div className="dm-pig-table">
        <Die value={shown} rolling={busy} />
        <div className="dm-pig-turn">
          <small>This turn</small>
          <b>{v.turnTotal ?? 0}</b>
          {lastTurn && !v.rolls?.length && (
            <span>{lastTurn.player === me
              ? lastTurn.bust ? "You rolled a 1 😬" : `You banked ${lastTurn.banked}`
              : lastTurn.bust ? `${peerName} rolled a 1 😬` : `${peerName} banked ${lastTurn.banked}`}</span>
          )}
        </div>
      </div>
      {game.status === "active" && (
        <div className="dm-pig-actions">
          <button type="button" disabled={!playable} onClick={() => onMove({ action: "roll" })}>🎲 Roll</button>
          <button type="button" className="secondary" disabled={!playable || !(v.turnTotal > 0)} onClick={() => onMove({ action: "hold" })}>✋ Hold</button>
        </div>
      )}
      <p className="dm-xg-note small">{`First to ${v.target ?? 50}. Roll as often as you dare, but a 1 wipes this turn's points.`}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Word chain                                                                                    */

function WordChain({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<ChainView>(game);
  const words = v.words ?? [];
  const shown = game.status === "active" ? words.slice(-8) : words;
  const peerName = first(peer.displayName);
  return (
    <div className="dm-chain">
      {words.length === 0 ? (
        <p className="dm-xg-note">Write a word. The next one must start with its last letter. No repeats; give up and you lose.</p>
      ) : (
        <ol className="dm-chain-words" translate="no">
          {shown.map((w, i) => (
            <li key={i} className={w.by === me ? "mine" : "theirs"}>
              {w.word.slice(0, -1)}<b>{w.word.slice(-1)}</b>
            </li>
          ))}
        </ol>
      )}
      <p className="dm-xg-note small">{`${words.length}/${v.max} words`}</p>
      {v.gaveUp !== null && v.gaveUp !== undefined && <p className="dm-xg-note small">{v.gaveUp === me ? "You gave up" : `${peerName} gave up`}</p>}
      {game.status === "active" && playable && (
        <>
          {v.letter && <span className="dm-chain-letter" translate="no">{v.letter.toLocaleUpperCase("tr")}</span>}
          <LineInput placeholder={v.letter ? `A word starting with ${v.letter.toLocaleUpperCase("tr")}` : "Any word"} cta="Send" busy={busy} max={20}
            onSend={(text) => onMove({ action: "word", text })} />
          <button type="button" className="dm-talk-chance" disabled={busy} onClick={() => onMove({ action: "pass" })}>🏳️ I give up</button>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Two truths and a lie                                                                          */

function LiesWriter({ busy, onSend }: { busy: boolean; onSend: (text: string, lie: number) => void }) {
  const [lines, setLines] = useState(["", "", ""]);
  const [lie, setLie] = useState<number | null>(null);
  const ready = lines.every((l) => l.trim()) && lie !== null;
  return (
    <form className="dm-lies-write" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onSend(lines.map((l) => l.trim()).join("\n"), lie!); }}>
      {lines.map((l, i) => (
        <label key={i} className={lie === i ? "lie" : ""}>
          <input value={l} maxLength={90} placeholder={`Statement ${i + 1}`} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" aria-pressed={lie === i} onClick={() => setLie(i)}>{lie === i ? "🤥 Lie" : "Lie?"}</button>
        </label>
      ))}
      <button type="submit" className="dm-talk-send" disabled={!ready || busy}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send</button>
    </form>
  );
}

function Lies({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<LiesView>(game);
  const peerName = first(peer.displayName);
  const rounds = v.rounds ?? [];
  const current = rounds.at(-1);
  const active = game.status === "active";
  const done = rounds.filter((r) => r.guess !== null);
  return (
    <div className="dm-lies">
      <Scores game={game} me={me} peer={peer} label={`round ${Math.min(rounds.length, v.total)} of ${v.total}`} />
      {active && current && !current.statements && (
        current.teller === me
          ? playable && (<><p className="dm-xg-note">Write two true things about you and one lie. Mark the lie.</p><LiesWriter busy={busy} onSend={(text, lie) => onMove({ action: "prompt", text, cell: lie })} /></>)
          : <Waiting text={`${peerName} is writing two truths and a lie…`} />
      )}
      {active && current?.statements && current.guess === null && (
        <div className="dm-lies-pick" role="group" aria-label="Which one is the lie?">
          {current.statements.map((s, i) => (
            <button key={i} type="button" disabled={!playable} className={current.lie === i ? "lie" : ""} onClick={() => onMove({ action: "guess", cell: i })}>
              <span translate="no">{s}</span>
              {current.teller === me && current.lie === i && <em>Lie</em>}
            </button>
          ))}
          {current.teller === me && <Waiting text={`${peerName} is looking for the lie…`} />}
        </div>
      )}
      {done.length > 0 && (
        <ol className="dm-lies-done">
          {(active ? done.slice(-1) : done).map((r, i) => (
            <li key={i}>
              {r.statements?.map((s, j) => (
                <span key={j} className={`${j === r.lie ? "lie" : ""} ${j === r.guess ? "guess" : ""}`}><span translate="no">{s}</span>{j === r.lie ? " 🤥" : ""}</span>
              ))}
              <small>{r.guess === r.lie ? (r.teller === me ? `${peerName} caught you` : "You caught it 🎯") : r.teller === me ? "You fooled them 😏" : "You got fooled"}</small>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Never have I ever                                                                             */

function Nhie({ game, me, peer, playable, onMove }: BoardProps) {
  const v = view<NhieView>(game);
  const peerName = first(peer.displayName);
  const active = game.status === "active";
  const rounds = v.rounds ?? [];
  const label = (a: "a" | "b") => (a === "a" ? "I have 🙋" : "Never 🙅");
  return (
    <div className="dm-nhie">
      <div className="dm-tot-progress" aria-hidden="true">
        {Array.from({ length: v.total ?? 0 }, (_, i) => <i key={i} className={rounds[i] ? (rounds[i].answers[0] === rounds[i].answers[1] ? "same" : "diff") : i === v.round ? "now" : ""} />)}
      </div>
      {active && v.prompt && (
        <>
          <p className="dm-nhie-card">{v.prompt}</p>
          <div className="dm-nhie-options" role="group" aria-label="Your answer">
            {(["a", "b"] as const).map((c) => (
              <button key={c} type="button" className={game.myChoice === c ? "picked" : ""} disabled={!playable} aria-pressed={game.myChoice === c} onClick={() => onMove({ choice: c })}>
                {label(c)}
              </button>
            ))}
          </div>
        </>
      )}
      {rounds.length > 0 && (
        <ul className="dm-nhie-results">
          {(active ? rounds.slice(-1) : rounds).map((r, i) => (
            <li key={i}>
              <p>{r.prompt}</p>
              <span>{`${r.answers[me] === "a" ? "🙋" : "🙅"} You · ${peerName} ${r.answers[1 - me] === "a" ? "🙋" : "🙅"}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* How well do you know me                                                                       */

function KnowMe({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<KnowView>(game);
  const peerName = first(peer.displayName);
  const [own, setOwn] = useState<"a" | "b" | null>(null);
  const [guess, setGuess] = useState<"a" | "b" | null>(null);
  const active = game.status === "active";
  const rounds = v.rounds ?? [];
  const q = v.question;
  const answered = !!game.myChoice;
  const option = (c: "a" | "b", qq: [string, string, string]) => (c === "a" ? qq[1] : qq[2]);
  return (
    <div className="dm-know">
      <Scores game={game} me={me} peer={peer} label="right guesses" />
      {active && q && (
        answered ? (
          <Waiting text={`${peerName} is answering…`} />
        ) : (
          <div key={v.round} className="dm-know-q">
            <p className="dm-nhie-card">{q[0]}</p>
            <small>You</small>
            <div className="dm-know-row" role="radiogroup" aria-label="Your answer">
              {(["a", "b"] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={own === c} className={own === c ? "picked" : ""} disabled={!playable} onClick={() => setOwn(c)}>{option(c, q)}</button>
              ))}
            </div>
            <small>{`What would ${peerName} pick?`}</small>
            <div className="dm-know-row" role="radiogroup" aria-label="Your guess">
              {(["a", "b"] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={guess === c} className={guess === c ? "picked guess" : ""} disabled={!playable} onClick={() => setGuess(c)}>{option(c, q)}</button>
              ))}
            </div>
            <button type="button" className="dm-talk-send" disabled={!playable || busy || !own || !guess}
              onClick={() => { onMove({ choice: own!, cell: guess === "a" ? 0 : 1 }); setOwn(null); setGuess(null); }}>
              Lock in
            </button>
          </div>
        )
      )}
      {rounds.length > 0 && (
        <ul className="dm-know-results">
          {(active ? rounds.slice(-1) : rounds).map((r, i) => (
            <li key={i}>
              <p>{r.question[0]}</p>
              <span className={r.guesses[me] === r.answers[1 - me] ? "right" : "wrong"}>
                {peerName}: {option(r.answers[1 - me], r.question)} · you guessed {option(r.guesses[me], r.question)}
              </span>
              <span className={r.guesses[1 - me] === r.answers[me] ? "right" : "wrong"}>
                You: {option(r.answers[me], r.question)} · {peerName} guessed {option(r.guesses[1 - me], r.question)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Story together                                                                                */

function Story({ game, me, peer, playable, busy, onMove }: BoardProps) {
  const v = view<StoryView>(game);
  const { user } = useSession();
  const [all, setAll] = useState(false);
  const lines = v.lines ?? [];
  const active = game.status === "active";
  const shown = active && !all ? lines.slice(-3) : lines;
  return (
    <div className="dm-story">
      <p className="dm-story-starter">{v.starter}</p>
      {active && lines.length > shown.length && (
        <button type="button" className="dm-talk-more" onClick={() => setAll(true)}>Show {lines.length - shown.length} earlier</button>
      )}
      <ol className="dm-story-lines">
        {shown.map((l, i) => (
          <li key={i} className={l.by === me ? "mine" : ""}>
            <Avatar user={l.by === me ? (user ?? peer) : peer} size={18} />
            <span translate="no">{l.text}</span>
          </li>
        ))}
      </ol>
      <div className="dm-talk-progress" aria-label={`Line ${lines.length} of ${v.total}`}>
        {Array.from({ length: v.total ?? 0 }, (_, i) => <i key={i} className={i < lines.length ? "done" : i === lines.length && active ? "now" : ""} />)}
      </div>
      {active && playable && (
        <LineInput placeholder={lines.length + 1 === v.total ? "Write the last line…" : "What happens next?"} cta="Add" busy={busy} max={v.max ?? 200}
          onSend={(text) => onMove({ action: "reply", text })} />
      )}
    </div>
  );
}
