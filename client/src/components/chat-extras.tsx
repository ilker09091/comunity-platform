"use client";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { toTurkish, useLang } from "@/lib/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, RotateCcw, Search, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BabyCard } from "./baby";
import { ExtraBoard, extraAnswered, extraDone, extraPeerAnswered, extraSimultaneous, extraStatus, isExtraKind, type ExtraMove } from "./chat-games-more";
import { ThirdBoard, isThirdKind, thirdAnswered, thirdDone, thirdEndNote, thirdPeerAnswered, thirdSimultaneous, thirdStatus } from "./chat-games-third";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Modal } from "./ui";

type Game = Models["ChatGameDto"];
export type GameKind = Game["kind"];
type Peer = Models["MessagePeerDto"];

type GameGroup = "talk" | "board" | "words" | "luck";
export const GAME_GROUPS: { id: GameGroup; name: string }[] = [
  { id: "talk", name: "Get closer" },
  { id: "board", name: "Board games" },
  { id: "words", name: "Words & puzzles" },
  { id: "luck", name: "Cards, dice & luck" },
];
export const GAMES: { kind: GameKind; name: string; blurb: string; icon: string; group: GameGroup }[] = [
  { kind: "daily", name: "Question of the Day", blurb: "Both answer, then see each other's", icon: "☀️", group: "talk" },
  { kind: "lovemap", name: "Love Map", blurb: "How well do you remember me?", icon: "🗺️", group: "talk" },
  { kind: "whomore", name: "Who's More Likely", blurb: "Point at each other in secret", icon: "👉", group: "talk" },
  { kind: "qa", name: "Q&A", blurb: "Ask each other anything, take turns", icon: "💬", group: "talk" },
  { kind: "tod", name: "Truth or Dare", blurb: "Pick truth or dare, the other one decides", icon: "🎲", group: "talk" },
  { kind: "thisorthat", name: "This or That", blurb: "Answer in secret, see if you think alike", icon: "💞", group: "talk" },
  { kind: "knowme", name: "How Well Do You Know Me", blurb: "Answer for yourself, guess their answer", icon: "🧠", group: "talk" },
  { kind: "nhie", name: "Never Have I Ever", blurb: "Confess in secret, then compare", icon: "🙊", group: "talk" },
  { kind: "lies", name: "Two Truths and a Lie", blurb: "Spot the lie in three statements", icon: "🤥", group: "talk" },
  { kind: "story", name: "Story Together", blurb: "Write a story one line each", icon: "📖", group: "talk" },
  { kind: "bucket", name: "Bucket List", blurb: "Things to do together, tick them off", icon: "📝", group: "talk" },
  { kind: "tavla", name: "Tavla", blurb: "Backgammon: roll, move, bear off", icon: "🎲", group: "board" },
  { kind: "chess", name: "Chess", blurb: "The full game, checkmate wins", icon: "♟️", group: "board" },
  { kind: "dama", name: "Russian Draughts", blurb: "Diagonal moves, flying kings", icon: "⛀", group: "board" },
  { kind: "xox", name: "Tic-tac-toe", blurb: "Three in a row wins", icon: "⭕", group: "board" },
  { kind: "connect4", name: "Connect Four", blurb: "Drop discs, line up four", icon: "🔴", group: "board" },
  { kind: "gomoku", name: "Five in a Row", blurb: "Bigger board, five to win", icon: "⚫", group: "board" },
  { kind: "reversi", name: "Reversi", blurb: "Flank discs to flip them", icon: "⚪", group: "board" },
  { kind: "dots", name: "Dots and Boxes", blurb: "Draw lines, close the boxes", icon: "🔲", group: "board" },
  { kind: "mangala", name: "Mangala", blurb: "The classic stone-sowing game", icon: "🪨", group: "board" },
  { kind: "battleship", name: "Battleship", blurb: "Find and sink the hidden fleet", icon: "🚢", group: "board" },
  { kind: "colorword", name: "Color Word", blurb: "Guess the 5-letter word in 6 tries", icon: "🟩", group: "words" },
  { kind: "wordsearch", name: "Word Search", blurb: "Race to find the hidden words", icon: "🔍", group: "words" },
  { kind: "sudoku", name: "Sudoku Duel", blurb: "Same puzzle, first to solve wins", icon: "🔢", group: "words" },
  { kind: "emoji", name: "Emoji Riddle", blurb: "Guess the film or song from emojis", icon: "🤔", group: "words" },
  { kind: "hangman", name: "Hangman", blurb: "Hide a word, guess letter by letter", icon: "🔤", group: "words" },
  { kind: "bulls", name: "Number Puzzle", blurb: "Crack the secret 4-digit number", icon: "🧮", group: "words" },
  { kind: "wordchain", name: "Word Chain", blurb: "Start with the last letter", icon: "🔗", group: "words" },
  { kind: "memory", name: "Memory", blurb: "Find the pairs, take turns", icon: "🃏", group: "words" },
  { kind: "pisti", name: "Pişti", blurb: "The classic card game for two", icon: "🂡", group: "luck" },
  { kind: "pig", name: "Dice Duel", blurb: "Roll or hold, race to 50", icon: "🎯", group: "luck" },
  { kind: "rps", name: "Rock Paper Scissors", blurb: "Secret picks, best of three", icon: "✌️", group: "luck" },
  { kind: "coin", name: "Coin Toss", blurb: "Settle it: heads or tails", icon: "🪙", group: "luck" },
  { kind: "wheel", name: "Spin the Wheel", blurb: "Can't decide? Let the wheel pick", icon: "🎡", group: "luck" },
];
export const gameName = (kind: GameKind) => GAMES.find((g) => g.kind === kind)?.name ?? "Game";

/** Gestures send an emoji that plays a full-screen effect on both phones. */
export const GESTURES = [
  { emoji: "❤️", label: "Love" },
  { emoji: "😘", label: "Kiss" },
  { emoji: "🤗", label: "Hug" },
  { emoji: "🌹", label: "Rose" },
  { emoji: "🥺", label: "Miss you" },
  { emoji: "🎉", label: "Celebrate" },
];

const RPS = { rock: "✊", paper: "✋", scissors: "✌️" } as const;
type RpsChoice = keyof typeof RPS;
type Move = { cell?: number; choice?: RpsChoice | "a" | "b" | "truth" | "dare"; action?: Models["GameMoveDto"]["action"]; text?: string } | ExtraMove;
const C4_COLS = 7;
const C4_ROWS = 6;

/** What the game looks like right after your move, before the server confirms it. */
function predict(game: Game, me: number, move: Move): Game {
  if (game.kind === "rps" || game.kind === "thisorthat" || game.kind === "nhie" || game.kind === "knowme" || game.kind === "whomore") return { ...game, myChoice: move.choice ?? null };
  // Sudoku: show the number right away.
  if (game.kind === "sudoku" && move.cell !== undefined) {
    const board = [...((game.view?.board as number[] | undefined) ?? [])];
    board[move.cell] = Number(move.text ?? 0);
    return { ...game, view: { ...game.view, board } };
  }
  if (isThirdKind(game.kind)) return thirdSimultaneous(game) ? game : { ...game, turnId: null };
  // The newer games: lock the controls until the server answers.
  if (isExtraKind(game.kind)) return { ...game, turnId: null };
  if (game.kind === "memory") return game;
  // Written games: just lock the controls until the server answers.
  if (game.kind === "qa" || game.kind === "tod") return { ...game, turnId: null };
  const board = [...game.board];
  let cell = move.cell!;
  if (game.kind === "connect4") {
    let row = C4_ROWS - 1;
    while (row >= 0 && board[row * C4_COLS + cell]) row--;
    if (row < 0) return game;
    cell = row * C4_COLS + cell;
  }
  board[cell] = me + 1;
  return { ...game, board, turnId: null };
}

function Score({ me, peer, mine, theirs, middle }: { me: Peer | Models["UserSummaryDto"]; peer: Peer; mine: number; theirs: number; middle: string }) {
  return (
    <div className="dm-game-score">
      <span><Avatar user={me} size={22} /> <b>{mine}</b></span>
      <small>{middle}</small>
      <span><b>{theirs}</b> <Avatar user={peer} size={22} /></span>
    </div>
  );
}

/** Whose turn it is in a game and the one-line status under its title, for the card and the game bar. */
export function describeGame(game: Game, userId: string | undefined, peer: Peer) {
  const me = game.players.indexOf(userId ?? "");
  const peerName = peer.displayName.split(" ")[0];
  const extra = isExtraKind(game.kind);
  const third = isThirdKind(game.kind);
  const simultaneous = game.kind === "rps" || game.kind === "thisorthat" || (extra && extraSimultaneous(game)) || (third && thirdSimultaneous(game));
  const answered = extra ? extraAnswered(game, me) : third ? thirdAnswered(game, me) : !!game.myChoice;
  const myTurn = game.status === "active" && (simultaneous ? !answered : game.turnId === userId);
  const matches = game.kind === "thisorthat" ? game.rounds.filter((r) => r.choices[0] === r.choices[1]).length : 0;
  const statusText =
    game.status === "won"
      ? game.winnerId === userId ? "You won! 🎉" : `${peerName} won`
      : game.status === "draw"
        ? "It's a draw 🤝"
        : game.status === "done"
          ? game.kind === "qa" ? "Great talk 💬" : game.kind === "tod" ? "What a game 🎲" : extra ? extraDone(game) : third ? thirdDone(game, me, peerName) : `You think alike on ${matches} of ${game.rounds.length} 💞`
          : extra
            ? extraStatus(game, me, peerName, myTurn)
          : third
            ? thirdStatus(game, me, peerName, myTurn)
          : game.kind === "qa" || game.kind === "tod"
            ? myTurn
              ? game.kind === "qa"
                ? game.phase === "ask" ? "Your turn to ask" : game.phase === "explain" ? `${peerName} asks what you mean` : "Your turn to answer"
                : game.phase === "pick" ? "Truth or dare?" : game.phase === "prompt" ? `Write ${peerName}'s ${game.turns[game.turns.length - 1]?.pick === "dare" ? "dare" : "question"}` : "Your turn to reply"
              : `${peerName}'s turn`
          : simultaneous
            ? game.myChoice
              ? `Waiting for ${peerName}…`
              : game.peerReady ? `${peerName} answered — your turn` : game.kind === "thisorthat" ? `Question ${game.round + 1} of ${game.totalRounds}` : "Make your pick"
            : myTurn ? "Your turn" : `${peerName}'s turn`;
  return { me, peerName, extra, third, simultaneous, myTurn, statusText };
}

/**
 * A mini game inside the chat. It refreshes itself while waiting for your partner, so both
 * phones stay in step without reloading the conversation.
 */
export function GameCard({
  game: initial,
  peer,
  own,
  onRematch,
}: {
  game: Game;
  peer: Peer;
  own: boolean;
  onRematch?: (kind: GameKind) => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const key = ["messages", user?.id, "game", initial.id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api("messagesGame", { params: { gameId: initial.id }, signal }),
    initialData: initial,
    initialDataUpdatedAt: Date.parse(initial.updatedAt),
    staleTime: 1000,
    refetchInterval: (q) => {
      const g = q.state.data;
      if (!g || g.status !== "active") return false;
      return typeof document !== "undefined" && document.visibilityState === "visible" ? 1500 : false;
    },
  });
  // Older servers don't send the written-game fields yet: default them so nothing breaks.
  const game: Game = { ...query.data, turns: query.data.turns ?? [], chances: query.data.chances ?? [], phase: query.data.phase ?? null, view: query.data.view ?? {} };
  const me = game.players.indexOf(user?.id ?? "");
  const move = useMutation({
    mutationFn: (body: Move) => api("messagesGameMove", { params: { gameId: game.id }, body }),
    onMutate: (body) => {
      haptic("tap");
      const previous = client.getQueryData<Game>(key);
      if (previous) client.setQueryData<Game>(key, predict(previous, me, body));
      return { previous };
    },
    onSuccess: (next) => {
      client.setQueryData(key, next);
      // The game bar over the chat shows whose turn it is (and drops finished games).
      void client.invalidateQueries({ queryKey: ["messages", user?.id, "active-games"] });
    },
    onError: (error, _body, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast(error.message, true);
    },
  });
  const [ending, setEnding] = useState(false);
  const resign = useMutation({
    mutationFn: () => api("messagesGameResign", { params: { gameId: game.id } }),
    onSuccess: (next) => {
      setEnding(false);
      client.setQueryData(key, next);
      void client.invalidateQueries({ queryKey: ["messages", user?.id, "active-games"] });
    },
    onError: (error) => toast(error.message, true),
  });
  // A little cheer (and buzz) the moment the game ends in your favour.
  const [celebrate, setCelebrate] = useState(false);
  const seenStatus = useRef(game.status);
  useEffect(() => {
    if (seenStatus.current === "active" && game.status !== "active" && (game.winnerId === user?.id || game.status === "done")) {
      haptic("success");
      setCelebrate(true);
    }
    seenStatus.current = game.status;
  }, [game.status, game.winnerId, user?.id]);

  const { peerName, extra, third, simultaneous, myTurn, statusText } = describeGame(game, user?.id, peer);
  const markOf = (value: number) => (value === 0 ? null : game.players[value - 1] === user?.id ? "mine" : "theirs");
  const playable = myTurn && !move.isPending && me >= 0;
  const winning = new Set(game.line);
  const meta = GAMES.find((g) => g.kind === game.kind);

  return (
    <div className={`dm-game ${game.kind} ${game.status} ${myTurn ? "my-turn" : ""} ${own ? "own" : ""} ${celebrate ? "celebrate" : ""}`}>
      <div className="dm-game-head">
        <span className="dm-game-icon" aria-hidden="true">{meta?.icon}</span>
        <span className="dm-game-title">
          <strong>{gameName(game.kind)}</strong>
          <small aria-live="polite">{statusText}</small>
        </span>
        {myTurn && <span className="dm-game-turn">Your move</span>}
        {!myTurn && simultaneous && game.status === "active" && (extra ? extraPeerAnswered(game, me) : third && thirdPeerAnswered(game, me)) && <span className="dm-game-turn soft">✓</span>}
      </div>

      {(game.kind === "xox" || game.kind === "gomoku") && (
        <div className={game.kind === "xox" ? "dm-xox" : "dm-gomoku"} role="grid" aria-label={`${gameName(game.kind)} board`}>
          {game.board.map((value, cell) => {
            const mark = markOf(value);
            return (
              <button
                key={cell}
                type="button"
                className={`dm-cell ${mark ?? ""} ${winning.has(cell) ? "win" : ""}`}
                disabled={!playable || !!value}
                aria-label={mark ? (mark === "mine" ? "Your mark" : `${peerName}'s mark`) : `Square ${cell + 1}`}
                onClick={() => move.mutate({ cell })}
              >
                {value === 1 ? <span className="p1" /> : value === 2 ? <span className="p2" /> : null}
              </button>
            );
          })}
        </div>
      )}

      {game.kind === "connect4" && (
        <div className="dm-c4" role="grid" aria-label="Connect Four board">
          {game.board.map((value, cell) => {
            const col = cell % C4_COLS;
            return (
              <button
                key={cell}
                type="button"
                className={`dm-c4-cell ${value ? `p${value}` : ""} ${winning.has(cell) ? "win" : ""}`}
                disabled={!playable || !!game.board[col]}
                aria-label={`Column ${col + 1}`}
                onClick={() => move.mutate({ cell: col })}
              >
                <span />
              </button>
            );
          })}
        </div>
      )}

      {game.kind === "memory" && (
        <>
          <Score me={user ?? peer} peer={peer} mine={game.scores[me] ?? 0} theirs={game.scores[1 - me] ?? 0} middle="pairs" />
          <div className="dm-memory" role="grid" aria-label="Memory cards">
            {game.cards.map((face, cell) => {
              const owner = game.owners[cell];
              const up = !!face;
              return (
                <button
                  key={cell}
                  type="button"
                  className={`dm-card ${up ? "up" : ""} ${owner ? (game.players[owner - 1] === user?.id ? "mine" : "theirs") : ""} ${!owner && game.flipped.includes(cell) ? "turned" : ""}`}
                  disabled={!playable || up}
                  aria-label={up ? face : `Card ${cell + 1}`}
                  onClick={() => move.mutate({ cell })}
                >
                  <span className="dm-card-inner">
                    <span className="dm-card-back" />
                    <span className="dm-card-face">{face}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {game.kind === "rps" && (
        <div className="dm-rps">
          <Score me={user ?? peer} peer={peer} mine={game.scores[me] ?? 0} theirs={game.scores[1 - me] ?? 0} middle="first to 2" />
          {game.rounds.length > 0 && (() => {
            const last = game.rounds[game.rounds.length - 1];
            const mine = last.choices[me] as RpsChoice, theirs = last.choices[1 - me] as RpsChoice;
            return (
              <div key={game.rounds.length} className="dm-rps-reveal" aria-label={`Last round: you ${mine}, ${peerName} ${theirs}`}>
                <span>{RPS[mine]}</span>
                <small>{last.winner === null ? "Tie" : last.winner === me ? "You +1" : `${peerName} +1`}</small>
                <span className="theirs">{RPS[theirs]}</span>
              </div>
            );
          })()}
          {game.status === "active" && (
            <div className="dm-picks" role="group" aria-label="Your pick">
              {(Object.keys(RPS) as RpsChoice[]).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={game.myChoice === choice ? "picked" : ""}
                  disabled={!playable}
                  aria-label={choice}
                  aria-pressed={game.myChoice === choice}
                  onClick={() => move.mutate({ choice })}
                >
                  {RPS[choice]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {game.kind === "thisorthat" && (
        <div className="dm-tot">
          {game.status === "active" && game.prompt.length === 2 && (
            <>
              <div className="dm-tot-progress" aria-hidden="true">
                {Array.from({ length: game.totalRounds }, (_, i) => {
                  const r = game.rounds[i];
                  return <i key={i} className={r ? (r.choices[0] === r.choices[1] ? "same" : "diff") : i === game.round ? "now" : ""} />;
                })}
              </div>
              <div className="dm-tot-options" role="group" aria-label="Choose one">
                {(["a", "b"] as const).map((choice, i) => (
                  <button
                    key={choice}
                    type="button"
                    className={game.myChoice === choice ? "picked" : ""}
                    disabled={!playable}
                    aria-pressed={game.myChoice === choice}
                    onClick={() => move.mutate({ choice })}
                  >
                    {game.prompt[i]}
                  </button>
                ))}
                <span className="dm-tot-or" aria-hidden="true">or</span>
              </div>
            </>
          )}
          {game.rounds.length > 0 && (() => {
            const shown = game.status === "done" ? game.rounds : game.rounds.slice(-1);
            return (
              <ul className="dm-tot-results" aria-label={game.status === "done" ? "All answers" : "Last answer"}>
                {shown.map((r, i) => {
                  const same = r.choices[0] === r.choices[1];
                  const label = (c: string) => r.labels[c === "a" ? 0 : 1];
                  return (
                    <li key={i} className={same ? "same" : "diff"}>
                      <span>{label(r.choices[me])}</span>
                      <b aria-label={same ? "Same answer" : "Different answers"}>{same ? "💞" : "≠"}</b>
                      <span>{label(r.choices[1 - me])}</span>
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </div>
      )}

      {third && game.status !== "active" && thirdEndNote(game) && <p className="dm-xg-endnote">{thirdEndNote(game)}</p>}
      {third && (
        <ThirdBoard game={game} me={me} peer={peer} busy={move.isPending} playable={playable} onMove={(m) => move.mutate(m)} />
      )}

      {extra && (
        <ExtraBoard game={game} me={me} peer={peer} busy={move.isPending} playable={playable} onMove={(m) => move.mutate(m)} />
      )}

      {(game.kind === "qa" || game.kind === "tod") && (
        <TalkBoard game={game} me={me} peer={peer} busy={move.isPending} myTurn={playable} onMove={(m) => move.mutate(m)} />
      )}

      {game.status !== "active" && onRematch && (
        <button type="button" className="dm-game-rematch" onClick={() => onRematch(game.kind)}>
          <RotateCcw size={15} /> Play again
        </button>
      )}
      {game.status === "active" && me >= 0 && (
        <button type="button" className="dm-game-end" onClick={() => setEnding(true)}>End game</button>
      )}
      {ending && (
        <ConfirmDialog
          title="End this game?"
          description={`If the game has a winner, ${peerName} wins. Ending a game early doesn't count for your baby.`}
          confirmLabel="End game"
          pending={resign.isPending}
          onConfirm={() => resign.mutate()}
          onClose={() => setEnding(false)}
        />
      )}
    </div>
  );
}

/**
 * Games still going on in this chat, pinned under the header like Telegram's pinned message,
 * so you never have to scroll up to find the board. Tap one to play it right here.
 */
export function GameBar({ peer, onRematch }: { peer: Peer; onRematch?: (kind: GameKind) => void }) {
  const { user } = useSession();
  const [opened, setOpened] = useState<Game | null>(null);
  const games = useQuery({
    queryKey: ["messages", user?.id, "active-games", peer.id],
    queryFn: ({ signal }) => api("messagesActiveGames", { params: { id: peer.id }, signal }),
    staleTime: 3000,
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 6000 : false),
  });
  const list = games.data ?? [];
  return (
    <>
      {list.length > 0 && (
        <div className={`dm-gamebar ${list.length > 1 ? "many" : ""}`} role="region" aria-label="Games in progress">
          {list.map((g) => {
            const d = describeGame(g, user?.id, peer);
            const meta = GAMES.find((x) => x.kind === g.kind);
            return (
              <button key={g.id} type="button" className={`dm-gamebar-item ${d.myTurn ? "turn" : ""}`} onClick={() => { haptic("tap"); setOpened(g); }}>
                <span className="dm-gamebar-icon" aria-hidden="true">{meta?.icon ?? "🎮"}</span>
                <span className="dm-gamebar-text">
                  <small>{gameName(g.kind)}</small>
                  <b>{d.statusText}</b>
                </span>
                {d.myTurn ? <em>Play</em> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
      {opened && (
        <Modal title={gameName(opened.kind)} className="dm-game-modal" onClose={() => setOpened(null)}>
          <div className="dm-game-modal-body">
            <GameCard game={opened} peer={peer} own={false} onRematch={onRematch && ((kind) => { setOpened(null); onRematch(kind); })} />
          </div>
        </Modal>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Q&A and Truth or Dare: games you play by writing to each other.                               */

/** A written move: you type it yourselves, then send. */
function TalkInput({ placeholder, initial = "", busy, onSend, cta = "Send" }: {
  placeholder: string; initial?: string; busy: boolean; onSend: (text: string) => void; cta?: string;
}) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <form className="dm-talk-input" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) onSend(text.trim()); }}>
      <textarea
        ref={area}
        value={text}
        rows={2}
        maxLength={300}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim() && !busy) onSend(text.trim()); } }}
      />
      <span className="dm-talk-input-row">
        <small>{text.length}/300</small>
        <button type="submit" className="dm-talk-send" disabled={!text.trim() || busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {cta}
        </button>
      </span>
    </form>
  );
}

/** One finished or ongoing turn, as a little conversation. */
function TalkTurn({ game, turn, index, me, peer }: { game: Game; turn: Models["GameTurnDto"]; index: number; me: number; peer: Peer }) {
  const { user } = useSession();
  const qa = game.kind === "qa";
  const who = (i: number) => (game.players[i] === user?.id ? user : peer);
  const name = (i: number) => (i === me ? "You" : peer.displayName.split(" ")[0]);
  const asker = qa ? turn.who : 1 - turn.who;
  const answerer = 1 - asker;
  if (!turn.question && !(game.kind === "tod" && turn.pick)) return null;
  return (
    <li className="dm-talk-turn">
      <span className="dm-talk-num">{index + 1}</span>
      {game.kind === "tod" && turn.pick && (
        <span className={`dm-talk-pick ${turn.pick}`}>{name(turn.who)} picked {turn.pick === "truth" ? "Truth 🤫" : "Dare 🔥"}</span>
      )}
      {turn.question && (
        <div className={`dm-talk-line q ${asker === me ? "mine" : ""}`}>
          <Avatar user={who(asker)} size={20} />
          <p><b>{qa ? "Q" : turn.pick === "dare" ? "Dare" : "Truth"}</b>{turn.question}</p>
        </div>
      )}
      {turn.clarify && (
        <div className={`dm-talk-line ask ${answerer === me ? "mine" : ""}`}>
          <Avatar user={who(answerer)} size={20} />
          <p><b>🤔</b>{turn.clarify}</p>
        </div>
      )}
      {turn.clarification && (
        <div className={`dm-talk-line explain ${asker === me ? "mine" : ""}`}>
          <Avatar user={who(asker)} size={20} />
          <p><b>💡</b>{turn.clarification}</p>
        </div>
      )}
      {turn.answer && (
        <div className={`dm-talk-line a ${answerer === me ? "mine" : ""}`}>
          <Avatar user={who(answerer)} size={20} />
          <p><b>{qa ? "A" : turn.pick === "dare" ? "✓" : "A"}</b>{turn.answer}</p>
        </div>
      )}
      {turn.passed && <span className="dm-talk-passed">{name(turn.who)} passed 🙈</span>}
    </li>
  );
}

/** Q&A and Truth or Dare boards: history, then what you can do right now. */
function TalkBoard({ game, me, peer, busy, myTurn, onMove }: {
  game: Game; me: number; peer: Peer; busy: boolean; myTurn: boolean; onMove: (move: Move) => void;
}) {
  const [clarifying, setClarifying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const peerName = peer.displayName.split(" ")[0];
  const turns = game.turns;
  const current = turns[turns.length - 1];
  const active = game.status === "active";
  // While playing, the last two turns; afterwards, everything.
  const visible = active && !showAll ? turns.slice(-2) : turns;
  const offset = turns.length - visible.length;
  const chancesLeft = game.chances[me] ?? 0;
  const qa = game.kind === "qa";
  return (
    <div className={`dm-talk ${game.kind}`}>
      <div className="dm-talk-progress" aria-label={`Turn ${Math.min(turns.length, game.totalRounds)} of ${game.totalRounds}`}>
        {Array.from({ length: game.totalRounds }, (_, i) => (
          <i key={i} className={i < turns.length - (active ? 1 : 0) ? "done" : i === turns.length - 1 && active ? "now" : ""} />
        ))}
      </div>
      {offset > 0 && (
        <button type="button" className="dm-talk-more" onClick={() => setShowAll(true)}>Show {offset} earlier</button>
      )}
      {visible.some((t) => t.question || t.pick) && (
        <ol className="dm-talk-turns">
          {visible.map((t, i) => <TalkTurn key={offset + i} game={game} turn={t} index={offset + i} me={me} peer={peer} />)}
        </ol>
      )}

      {active && current && !myTurn && (
        <p className="dm-talk-wait">
          <span className="dm-talk-dots" aria-hidden="true"><i /><i /><i /></span>
          {qa
            ? game.phase === "ask" ? `${peerName} is writing a question…` : game.phase === "explain" ? `${peerName} is explaining…` : `${peerName} is answering…`
            : game.phase === "pick" ? `${peerName} is choosing truth or dare…` : game.phase === "prompt" ? `${peerName} is writing your ${current.pick === "dare" ? "dare" : "question"}…` : `${peerName} is replying…`}
        </p>
      )}

      {active && current && myTurn && qa && game.phase === "ask" && (
        <TalkInput key={`ask-${turns.length}`} placeholder={`Ask ${peerName} anything…`} busy={busy} cta="Ask" onSend={(text) => onMove({ action: "ask", text })} />
      )}
      {active && current && myTurn && qa && game.phase === "answer" && (
        clarifying ? (
          <div className="dm-talk-clarify">
            <TalkInput key={`clarify-${turns.length}`} placeholder="What didn't you understand?" initial="What do you mean? 🤔" busy={busy} cta="Ask back"
              onSend={(text) => { setClarifying(false); onMove({ action: "clarify", text }); }} />
            <button type="button" className="dm-talk-link" onClick={() => setClarifying(false)}>Never mind, I&apos;ll answer</button>
          </div>
        ) : (
          <>
            <TalkInput key={`answer-${turns.length}`} placeholder="Your answer…" busy={busy} cta="Answer" onSend={(text) => onMove({ action: "answer", text })} />
            {!current.clarify && (
              <button type="button" className="dm-talk-chance" disabled={chancesLeft <= 0 || busy} onClick={() => { haptic("tap"); setClarifying(true); }}>
                🤔 Didn&apos;t get it? Ask what they mean <em>{chancesLeft} left</em>
              </button>
            )}
          </>
        )
      )}
      {active && current && myTurn && qa && game.phase === "explain" && (
        <TalkInput key={`explain-${turns.length}`} placeholder={`Explain your question to ${peerName}…`} busy={busy} cta="Explain" onSend={(text) => onMove({ action: "explain", text })} />
      )}

      {active && current && myTurn && !qa && game.phase === "pick" && (
        <div className="dm-tod-picks" role="group" aria-label="Truth or dare">
          <button type="button" className="truth" disabled={busy} onClick={() => onMove({ action: "pick", choice: "truth" })}>
            <span>🤫</span><b>Truth</b><small>Answer honestly</small>
          </button>
          <button type="button" className="dare" disabled={busy} onClick={() => onMove({ action: "pick", choice: "dare" })}>
            <span>🔥</span><b>Dare</b><small>Do the challenge</small>
          </button>
        </div>
      )}
      {active && current && myTurn && !qa && game.phase === "prompt" && (
        <TalkInput key={`prompt-${turns.length}`} placeholder={current.pick === "dare" ? `Write a dare for ${peerName}…` : `Ask ${peerName} a truth question…`} busy={busy} cta={current.pick === "dare" ? "Dare" : "Ask"}
          onSend={(text) => onMove({ action: "prompt", text })} />
      )}
      {active && current && myTurn && !qa && game.phase === "reply" && (
        <>
          <TalkInput key={`reply-${turns.length}`} placeholder={current.pick === "dare" ? "Tell how it went (or send it in the chat)…" : "Your honest answer…"}
            initial={current.pick === "dare" ? "Done ✓" : ""} busy={busy} cta="Reply" onSend={(text) => onMove({ action: "reply", text })} />
          <button type="button" className="dm-talk-chance" disabled={chancesLeft <= 0 || busy} onClick={() => onMove({ action: "pass" })}>
            🙈 Pass this one <em>{chancesLeft} left</em>
          </button>
        </>
      )}
    </div>
  );
}

/** Telegram-style icon colors, one per game (top and bottom of a soft gradient). */
const GAME_COLORS: [string, string][] = [
  ["#ff8a80", "#ff5252"], ["#ffb74d", "#fb8c00"], ["#ffd54f", "#f9a825"], ["#81c784", "#43a047"], ["#4dd0e1", "#00acc1"],
  ["#64b5f6", "#1e88e5"], ["#9575cd", "#5e35b1"], ["#ba68c8", "#8e24aa"], ["#f06292", "#d81b60"], ["#4db6ac", "#00897b"],
];
const gameColor = (kind: GameKind) => GAME_COLORS[Math.max(0, GAMES.findIndex((g) => g.kind === kind)) % GAME_COLORS.length];

const RECENT_KEY = "circle-recent-games";
function readRecent(): GameKind[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((k): k is GameKind => GAMES.some((g) => g.kind === k)).slice(0, 3) : [];
  } catch {
    return [];
  }
}
function rememberGame(kind: GameKind) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([kind, ...readRecent().filter((k) => k !== kind)].slice(0, 3)));
  } catch {
    /* storage unavailable */
  }
}

/** One game as a Telegram list row: a colored rounded icon, the name, a line about it. */
function GameRow({ game, disabled, onPick }: { game: (typeof GAMES)[number]; disabled: boolean; onPick: (kind: GameKind) => void }) {
  const [top, bottom] = gameColor(game.kind);
  return (
    <button type="button" className="dm-tg-row" disabled={disabled} onClick={() => onPick(game.kind)}>
      <span className="dm-tg-icon" style={{ background: `linear-gradient(180deg, ${top}, ${bottom})` }} aria-hidden="true">{game.icon}</span>
      <span className="dm-tg-text">
        <strong>{game.name}</strong>
        <small>{game.blurb}</small>
      </span>
      <ChevronRight size={18} className="dm-tg-chevron" aria-hidden="true" />
    </button>
  );
}

/**
 * "Together" sheet from the composer, Telegram style: search, category tabs, quick gestures,
 * recently played games and every game as a list row.
 */
export function TogetherSheet({
  peer,
  canPlay,
  onGesture,
  onGame,
  onBaby,
  onClose,
}: {
  peer: Peer;
  canPlay: boolean;
  onGesture: (emoji: string) => void;
  onGame: (kind: GameKind) => void;
  onBaby?: () => void;
  onClose: () => void;
}) {
  const lang = useLang();
  const [tab, setTab] = useState<"all" | GameGroup>("all");
  const [query, setQuery] = useState("");
  const [recent] = useState<GameKind[]>(() => (typeof window === "undefined" ? [] : readRecent()));
  const pick = (kind: GameKind) => {
    haptic("tap");
    rememberGame(kind);
    onGame(kind);
  };
  // Search in English and, in Turkish mode, in the Turkish names too.
  const text = (s: string) => `${s} ${lang === "tr" ? toTurkish(s) ?? "" : ""}`.toLocaleLowerCase(lang === "tr" ? "tr" : "en");
  const q = query.trim().toLocaleLowerCase(lang === "tr" ? "tr" : "en");
  const found = q ? GAMES.filter((g) => text(`${g.name} ${g.blurb}`).includes(q)) : [];
  const groups = GAME_GROUPS.filter((g) => tab === "all" || g.id === tab);
  return (
    <Modal title="Together" className="dm-together-sheet dm-tg" onClose={onClose}>
      <div className="dm-tg-head">
        <label className="dm-tg-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} placeholder="Search games" aria-label="Search games" enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" aria-label="Clear" onClick={() => setQuery("")}><X size={14} /></button>}
        </label>
        {!q && (
          <div className="dm-tg-tabs" role="tablist" aria-label="Categories">
            {[{ id: "all" as const, name: "All" }, ...GAME_GROUPS].map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""}
                onClick={() => { haptic("tap"); setTab(t.id); }}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="dm-tg-body">
        {q ? (
          found.length ? (
            <div className="dm-tg-group">{found.map((g) => <GameRow key={g.kind} game={g} disabled={!canPlay} onPick={pick} />)}</div>
          ) : (
            <p className="dm-tg-empty">No games found</p>
          )
        ) : (
          <>
            {tab === "all" && (
              <>
                <div className="dm-tg-gestures" role="group" aria-label="Send a gesture">
                  {GESTURES.map((g) => (
                    <button key={g.emoji} type="button" onClick={() => { haptic("tap"); onGesture(g.emoji); }}>
                      <span aria-hidden="true">{g.emoji}</span>
                      <small>{g.label}</small>
                    </button>
                  ))}
                </div>
                {onBaby && canPlay && (
                  <>
                    <h3 className="dm-tg-label">Our baby</h3>
                    <div className="dm-tg-group dm-tg-baby"><BabyCard peer={peer} onOpen={onBaby} /></div>
                  </>
                )}
                {recent.length > 0 && (
                  <>
                    <h3 className="dm-tg-label">Recently played</h3>
                    <div className="dm-tg-group">
                      {recent.map((k) => GAMES.find((g) => g.kind === k)).filter((g): g is (typeof GAMES)[number] => !!g)
                        .map((g) => <GameRow key={g.kind} game={g} disabled={!canPlay} onPick={pick} />)}
                    </div>
                  </>
                )}
              </>
            )}
            {groups.map((group) => (
              <section key={group.id}>
                <h3 className="dm-tg-label">{group.name}</h3>
                <div className="dm-tg-group">
                  {GAMES.filter((g) => g.group === group.id).map((g) => <GameRow key={g.kind} game={g} disabled={!canPlay} onPick={pick} />)}
                </div>
              </section>
            ))}
          </>
        )}
        {!canPlay && <p className="dm-set-note">Games open up once your message request is accepted.</p>}
      </div>
    </Modal>
  );
}
