"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, ImagePlus, Loader2, Palette, RotateCcw, Trash2 } from "lucide-react";
import { api, upload, type Models } from "@/lib/api/client";
import { compressImage } from "@/lib/compress-image";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import { Avatar, Modal } from "./ui";
import { MESSAGE_SOUNDS, peerSound, previewSound, setPeerSound, type MessageSound } from "./app-bridge";
import { themeMeta } from "./chat-themes";
import { BabyCard } from "./baby";

type Game = Models["ChatGameDto"];
export type GameKind = Game["kind"];
type Peer = Models["MessagePeerDto"];

export const GAMES: { kind: GameKind; name: string; blurb: string; icon: string; tone: string }[] = [
  { kind: "thisorthat", name: "This or That", blurb: "Answer in secret, see if you think alike", icon: "💞", tone: "#ffe3ec" },
  { kind: "memory", name: "Memory", blurb: "Find the pairs, take turns", icon: "🃏", tone: "#e7f5ff" },
  { kind: "xox", name: "Tic-tac-toe", blurb: "Three in a row wins", icon: "⭕", tone: "#fff0f6" },
  { kind: "connect4", name: "Connect Four", blurb: "Drop discs, line up four", icon: "🔴", tone: "#edf2ff" },
  { kind: "gomoku", name: "Five in a Row", blurb: "Bigger board, five to win", icon: "⚫", tone: "#fff4e6" },
  { kind: "rps", name: "Rock Paper Scissors", blurb: "Secret picks, best of three", icon: "✌️", tone: "#f3f0ff" },
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
type Move = { cell?: number; choice?: RpsChoice | "a" | "b" };
const C4_COLS = 7;
const C4_ROWS = 6;

/** What the game looks like right after your move, before the server confirms it. */
function predict(game: Game, me: number, move: Move): Game {
  if (game.kind === "rps" || game.kind === "thisorthat") return { ...game, myChoice: move.choice ?? null };
  if (game.kind === "memory") return game;
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
  const game = query.data;
  const me = game.players.indexOf(user?.id ?? "");
  const move = useMutation({
    mutationFn: (body: Move) => api("messagesGameMove", { params: { gameId: game.id }, body }),
    onMutate: (body) => {
      haptic("tap");
      const previous = client.getQueryData<Game>(key);
      if (previous) client.setQueryData<Game>(key, predict(previous, me, body));
      return { previous };
    },
    onSuccess: (next) => client.setQueryData(key, next),
    onError: (error, _body, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast(error.message, true);
    },
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

  const peerName = peer.displayName.split(" ")[0];
  const simultaneous = game.kind === "rps" || game.kind === "thisorthat";
  const myTurn = game.status === "active" && (simultaneous ? !game.myChoice : game.turnId === user?.id);
  const matches = game.kind === "thisorthat" ? game.rounds.filter((r) => r.choices[0] === r.choices[1]).length : 0;
  const statusText =
    game.status === "won"
      ? game.winnerId === user?.id ? "You won! 🎉" : `${peerName} won`
      : game.status === "draw"
        ? "It's a draw 🤝"
        : game.status === "done"
          ? `You think alike on ${matches} of ${game.rounds.length} 💞`
          : simultaneous
            ? game.myChoice
              ? `Waiting for ${peerName}…`
              : game.peerReady ? `${peerName} answered — your turn` : game.kind === "thisorthat" ? `Question ${game.round + 1} of ${game.totalRounds}` : "Make your pick"
            : myTurn ? "Your turn" : `${peerName}'s turn`;
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

      {game.status !== "active" && onRematch && (
        <button type="button" className="dm-game-rematch" onClick={() => onRematch(game.kind)}>
          <RotateCcw size={15} /> Play again
        </button>
      )}
    </div>
  );
}

/** "Together" sheet from the composer: a gesture with a screen effect, or a mini game. */
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
  return (
    <Modal title="Together" className="dm-together-sheet" onClose={onClose}>
      <div className="dm-together-body">
        {onBaby && canPlay && (
          <section>
            <h3>Our baby</h3>
            <div className="dm-set-group">
              <BabyCard peer={peer} onOpen={onBaby} />
            </div>
          </section>
        )}
        <section>
          <h3>Send a gesture</h3>
          <div className="dm-gesture-grid">
            {GESTURES.map((g) => (
              <button key={g.emoji} type="button" className="dm-gesture" onClick={() => { haptic("tap"); onGesture(g.emoji); }}>
                <span aria-hidden="true">{g.emoji}</span>
                <small>{g.label}</small>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Play with {peer.displayName.split(" ")[0]}</h3>
          <div className="dm-set-group">
            {GAMES.map((g) => (
              <button key={g.kind} type="button" className="dm-set-item dm-game-option" disabled={!canPlay} onClick={() => { haptic("tap"); onGame(g.kind); }}>
                <span className="dm-game-option-art" style={{ "--tone": g.tone } as CSSProperties} aria-hidden="true">{g.icon}</span>
                <span className="dm-set-text">
                  <strong>{g.name}</strong>
                  <small>{g.blurb}</small>
                </span>
                <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

/**
 * Telegram-style settings for one chat: a private nickname, the shared theme, your own
 * wallpaper and a notification sound for this person.
 */
export function ChatCustomize({
  peer,
  nickname,
  wallpaperUrl,
  themeName,
  themeId,
  onTheme,
  onClose,
}: {
  peer: Peer;
  nickname: string | null;
  wallpaperUrl: string | null;
  themeName: string;
  themeId: string;
  onTheme?: () => void;
  onClose: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [name, setName] = useState(nickname ?? "");
  const [sound, setSound] = useState<MessageSound>(() => peerSound(peer.id));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const statusKey = ["messages", user?.id, "status", peer.id];
  const applyPrefs = (prefs: Models["ChatPrefsResultDto"]) => {
    client.setQueryData<Models["MessageStatusDto"]>(statusKey, (d) => d && { ...d, ...prefs });
    void client.invalidateQueries({ queryKey: ["messages", user?.id, "conversations"] });
  };
  const save = useMutation({
    mutationFn: (body: { nickname?: string | null; wallpaperMediaId?: string | null }) =>
      api("messagesSetPrefs", { params: { id: peer.id }, body }),
    onSuccess: applyPrefs,
    onError: (e) => toast(e.message, true),
  });
  const pickWallpaper = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choose a photo.", true);
    setUploading(true);
    try {
      let media = (await upload(await compressImage(file), () => {})) as Models["MediaDto"];
      while (media.status === "PROCESSING") {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        media = await api("mediaGet", { params: { id: media.id } });
      }
      if (media.status !== "READY") throw new Error("This photo could not be processed.");
      const uploaded = media;
      const prefs = await api("messagesSetPrefs", { params: { id: peer.id }, body: { wallpaperMediaId: uploaded.id } }).catch((e) => {
        void api("mediaRemove", { params: { id: uploaded.id } }).catch(() => {});
        throw e;
      });
      applyPrefs(prefs);
      haptic("success");
      toast("Wallpaper set.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed.", true);
    } finally {
      setUploading(false);
    }
  };
  const trimmed = name.trim();
  const nameChanged = trimmed !== (nickname ?? "");
  const saveName = () => {
    if (!nameChanged || save.isPending) return;
    save.mutate({ nickname: trimmed || null }, { onSuccess: () => toast(trimmed ? "Nickname saved." : "Nickname removed.") });
  };
  const accent = themeMeta(themeId).accent ?? "var(--primary)";
  return (
    <Modal
      title="Customize"
      className="dm-customize-sheet"
      onClose={onClose}
      headerActions={
        nameChanged ? (
          <button type="button" className="dm-set-done" disabled={save.isPending} onClick={saveName}>
            {save.isPending ? <Loader2 size={16} className="spin" /> : "Save"}
          </button>
        ) : undefined
      }
    >
      <div className="dm-set">
        <div className="dm-set-hero">
          <Avatar user={peer} size={84} />
          <strong>{trimmed || peer.displayName}</strong>
          <span>@{peer.username}</span>
        </div>

        <h3 className="dm-set-label">Nickname</h3>
        <form className="dm-set-group" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
          <input
            className="dm-set-input"
            value={name}
            maxLength={40}
            placeholder={peer.displayName}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nickname"
            enterKeyHint="done"
          />
        </form>
        <p className="dm-set-note">Only you see this name, in your chats and here.</p>

        <h3 className="dm-set-label">Appearance</h3>
        <div className="dm-set-group">
          {onTheme && (
            <button type="button" className="dm-set-item" onClick={onTheme}>
              <span className="dm-set-icon" style={{ background: accent }}><Palette size={17} /></span>
              <span className="dm-set-text"><strong>Chat theme</strong></span>
              <span className="dm-set-value">{themeName}</span>
              <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
            </button>
          )}
          <button type="button" className="dm-set-item" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <span className="dm-set-icon" style={{ background: "#1c7ed6" }}><ImagePlus size={17} /></span>
            <span className="dm-set-text"><strong>Wallpaper</strong></span>
            <span className="dm-set-value">{uploading ? "Uploading…" : wallpaperUrl ? "Your photo" : "Theme"}</span>
            {uploading ? <Loader2 size={17} className="spin dm-set-chevron" /> : <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />}
          </button>
          {wallpaperUrl && (
            <button type="button" className="dm-set-item danger" disabled={uploading || save.isPending}
              onClick={() => save.mutate({ wallpaperMediaId: null }, { onSuccess: () => toast("Wallpaper removed.") })}>
              <span className="dm-set-icon" style={{ background: "#fa5252" }}><Trash2 size={17} /></span>
              <span className="dm-set-text"><strong>Remove wallpaper</strong></span>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pickWallpaper(e.target.files?.[0]); e.target.value = ""; }} />
        <p className="dm-set-note">Both of you see the theme. Your wallpaper is only visible to you.</p>

        <h3 className="dm-set-label">Notification sound</h3>
        <div className="dm-set-group" role="radiogroup" aria-label="Notification sound">
          {(Object.keys(MESSAGE_SOUNDS) as MessageSound[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={sound === id}
              className="dm-set-item"
              onClick={() => {
                setSound(id);
                setPeerSound(peer.id, id);
                previewSound(id);
              }}
            >
              <span className="dm-set-text"><strong>{MESSAGE_SOUNDS[id].name}</strong></span>
              {sound === id && <Check size={18} strokeWidth={2.6} className="dm-set-check" style={{ color: accent }} />}
            </button>
          ))}
        </div>
        <p className="dm-set-note">Plays for {trimmed || peer.displayName}&apos;s messages on this device while Circle is open.</p>
      </div>
    </Modal>
  );
}
