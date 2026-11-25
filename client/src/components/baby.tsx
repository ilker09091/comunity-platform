"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Baby, Bath, BookHeart, ChevronLeft, ChevronRight, Heart, Lock, Moon, Pill, Shirt, ShoppingBag, Sparkles, Sun, ToyBrick, Utensils, Volume2, VolumeX, X,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { babySoundOn, playLullaby, sayWord, setBabySoundOn, stopLullaby, type BabySound } from "@/lib/baby-sounds";
import { babyVoice as playBabySound, playSfx, preloadSfx, setAmbience } from "@/lib/baby-sfx";
import { BabyWorld, type Scene } from "./baby-world";
import { BabyGuide } from "./baby-guide";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Modal } from "./ui";

type BabyState = Models["BabyDto"];
type Invite = Models["BabyInviteDto"];
type Peer = Models["MessagePeerDto"];
type Gender = "girl" | "boy";
type Pose = number | "sleep" | "eat" | "sad" | "laugh" | "sneeze" | "sick";

/*
 * Artwork lives in /public/baby (sliced from the sheets in /public/baby/raw). Until a file
 * exists, a picture falls back to a simpler one or an emoji, so everything works before the art.
 */
const FOODS = ["🍼", "🥣", "🍎", "🍌", "🍪", "🍕", "🍰", "🥕", "🍲", "🧃", "🍦", "🥪"];
const FOOD_NAMES = ["Milk", "Baby food", "Apple", "Banana", "Cookie", "Pizza", "Cake", "Carrot", "Soup", "Juice", "Ice cream", "Sandwich"];
/** Little babies only get baby food. */
const FOODS_BY_STAGE = [[0, 1, 2, 3], FOODS.map((_, i) => i), FOODS.map((_, i) => i), FOODS.map((_, i) => i)];
const TOYS = ["🧸", "🦆", "🧱", "⚽", "🪁", "📖", "🚀", "🦖", "🎹", "🫧", "🚂", "🤖"];
const TOY_NAMES = ["Teddy", "Duck", "Blocks", "Ball", "Kite", "Book", "Rocket", "Dino", "Xylophone", "Bubbles", "Train", "Robot"];
const FREE_TOYS = 6;
/** Same as the server: a full child won't eat, a clean one needs no bath, a rested one won't sleep. */
const FULL_AT = 95;
const CLEAN_AT = 90;
const RESTED_AT = 80;
const OUTFITS: Record<Gender, string[][]> = {
  girl: [
    ["Onesie", "Bunny", "Duckling", "Knit set", "Teddy", "Sailor"],
    ["Overalls", "Dino", "Raincoat", "Pajamas", "Strawberry", "Winter"],
    ["Casual", "School", "Superhero", "Football", "Party", "Pajamas"],
    ["Hoodie", "School", "Beach", "Special day", "Winter", "Tennis"],
  ],
  boy: [
    ["Onesie", "Bunny", "Duckling", "Knit set", "Teddy", "Sailor"],
    ["Overalls", "Dino", "Raincoat", "Pajamas", "Suspenders", "Winter"],
    ["Casual", "School", "Superhero", "Football", "Blazer", "Pajamas"],
    ["Hoodie", "School", "Beach", "Special day", "Winter", "Tennis"],
  ],
};
const STAGE_EMOJI: Record<Gender, string[]> = { girl: ["👶", "🧒", "👧", "👧"], boy: ["👶", "🧒", "👦", "👦"] };

type ShopGroup = "toys" | "decor" | "rooms";
/** Mirrors the server's shop (the server checks prices and ownership). */
const SHOP: { id: string; name: string; emoji: string; price: number; group: ShopGroup; slot?: "room" | "hang" | "floor" | "frame" }[] = [
  { id: "toy-6", name: "Rocket", emoji: "🚀", price: 60, group: "toys" },
  { id: "toy-7", name: "Dino", emoji: "🦖", price: 60, group: "toys" },
  { id: "toy-8", name: "Xylophone", emoji: "🎹", price: 80, group: "toys" },
  { id: "toy-9", name: "Bubbles", emoji: "🫧", price: 50, group: "toys" },
  { id: "toy-10", name: "Train", emoji: "🚂", price: 80, group: "toys" },
  { id: "toy-11", name: "Robot", emoji: "🤖", price: 100, group: "toys" },
  { id: "frame", name: "Photo of us", emoji: "🖼️", price: 40, group: "decor", slot: "frame" },
  { id: "hang-bunting", name: "Bunting", emoji: "🎏", price: 80, group: "decor", slot: "hang" },
  { id: "hang-lights", name: "Fairy lights", emoji: "✨", price: 120, group: "decor", slot: "hang" },
  { id: "hang-balloons", name: "Balloons", emoji: "🎈", price: 100, group: "decor", slot: "hang" },
  { id: "hang-mobile", name: "Star mobile", emoji: "⭐", price: 120, group: "decor", slot: "hang" },
  { id: "floor-horse", name: "Rocking horse", emoji: "🐴", price: 150, group: "decor", slot: "floor" },
  { id: "floor-tent", name: "Play tent", emoji: "⛺", price: 200, group: "decor", slot: "floor" },
  { id: "floor-toybox", name: "Toy box", emoji: "🧺", price: 120, group: "decor", slot: "floor" },
  { id: "floor-bunny", name: "Big bunny", emoji: "🐰", price: 140, group: "decor", slot: "floor" },
  { id: "room-ocean", name: "Ocean room", emoji: "🐠", price: 300, group: "rooms", slot: "room" },
  { id: "room-space", name: "Space room", emoji: "🪐", price: 300, group: "rooms", slot: "room" },
  { id: "room-garden", name: "Garden room", emoji: "🌷", price: 300, group: "rooms", slot: "room" },
];
const shopItem = (id: string | null | undefined) => SHOP.find((i) => i.id === id);

const childArt = (gender: Gender, stage: number, pose: Pose) => `/baby/${gender}-${stage}-${pose}.webp`;
/** Room themes are bedroom panoramas in the world. */
const roomThumb = (id: string) => `/baby/world/scene/nursery/bg-${id.replace("room-", "")}-day.webp`;

/** A picture that quietly falls back to `fallback`, then to an emoji, when a file is missing. */
function Art({ src, fallback, emoji, className, alt = "", onLoad }: {
  src: string; fallback?: string; emoji: string; className?: string; alt?: string; onLoad?: (img: HTMLImageElement) => void;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const chain = [src, fallback].filter((s): s is string => !!s && !failed.includes(s));
  const current = chain[0];
  if (!current) return <span className={`${className ?? ""} dm-baby-emoji`} role={alt ? "img" : undefined} aria-label={alt || undefined}>{emoji}</span>;
  return (
    <img
      key={current}
      className={className}
      src={current}
      alt={alt}
      draggable={false}
      onLoad={(e) => onLoad?.(e.currentTarget)}
      onError={() => setFailed((f) => [...f, current])}
    />
  );
}

function Coin() {
  return <Art className="dm-coin" src="/baby/coin.webp" emoji="🪙" />;
}

const isNight = (date = new Date()) => date.getHours() >= 21 || date.getHours() < 7;

/** "Now", refreshed every `ms`, so time-based hints stay current without impure renders. */
function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/** The day of a month a monthly birthday falls on: born on the 31st, it's the 30th in April. */
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const birthdayDay = (born: Date, year: number, month: number) => Math.min(born.getDate(), daysIn(year, month));

/** Whole months since birth, and whether today is a monthly birthday. */
function monthsOld(bornAt: string | null, now: number) {
  if (!bornAt) return { months: 0, birthday: false };
  const b = new Date(bornAt), n = new Date(now);
  let months = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth();
  const day = birthdayDay(b, n.getFullYear(), n.getMonth());
  if (n.getDate() < day) months--;
  return { months: Math.max(0, months), birthday: months >= 1 && n.getDate() === day };
}
/** The date of the n-th monthly birthday (no rolling over into the next month). */
function nthBirthday(born: Date, n: number) {
  const year = born.getFullYear() + Math.floor((born.getMonth() + n) / 12);
  const month = (born.getMonth() + n) % 12;
  return new Date(year, month, birthdayDay(born, year, month), born.getHours(), born.getMinutes());
}

type Need = { id: "feed" | "sleep" | "bath" | "play" | "rest" | "ok"; icon: string; text: string; cta?: string };
/** The most useful thing to do right now (a cold has its own card). */
function needOf(baby: BabyState, left: (k: "feeds" | "plays" | "baths") => number): Need {
  if (baby.asleep) return { id: "rest", icon: "💤", text: `Sleeping · ${baby.energy}% rested` };
  if (baby.fullness < 40 && left("feeds") > 0) return { id: "feed", icon: "🍼", text: baby.fullness < 25 ? `${baby.name} is hungry` : `${baby.name} could eat something`, cta: "Feed" };
  if (baby.energy < 30) return { id: "sleep", icon: "🥱", text: `${baby.name} is getting sleepy`, cta: "Bedtime" };
  if (baby.clean < 35 && left("baths") > 0) return { id: "bath", icon: "🫧", text: `${baby.name} needs a bath`, cta: "Bath" };
  if (baby.happiness < 45 && left("plays") > 0) return { id: "play", icon: "🧸", text: `${baby.name} wants to play`, cta: "Play" };
  return { id: "ok", icon: "💗", text: `${baby.name} is happy` };
}

export function moodLabel(baby: BabyState) {
  if (baby.asleep) return "Sleeping";
  return { happy: "Happy", hungry: "Hungry", sad: "Misses you", sick: "Has a cold", sleepy: "Sleepy", dirty: "Needs a bath" }[baby.mood];
}
function moodBadge(baby: BabyState, birthday = false) {
  if (baby.asleep) return "💤";
  if (baby.mood === "happy") return birthday ? "🎂" : null;
  return { hungry: "🍼", sad: "🥺", sick: "🤒", sleepy: "🥱", dirty: "🫧" }[baby.mood];
}

/** The child's picture for the current state; special poses fall back to the outfit or the sad face. */
function childPose(baby: BabyState, gender: Gender, override?: Pose | null) {
  const pose: Pose = override ?? (baby.asleep ? "sleep" : baby.mood === "sick" ? "sick" : baby.mood !== "happy" ? "sad" : baby.outfit);
  const fallback = pose === "sick" ? childArt(gender, baby.stage, "sad")
    : typeof pose === "number" || pose === "sleep" || pose === "eat" || pose === "sad" ? undefined
      : childArt(gender, baby.stage, baby.outfit);
  return { src: childArt(gender, baby.stage, pose), fallback };
}

export function useBaby(peerId: string, live = false) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["messages", user?.id, "baby", peerId],
    queryFn: ({ signal }) => api("messagesBaby", { params: { id: peerId }, signal }),
    staleTime: live ? 5_000 : 60_000,
    refetchInterval: live ? 15_000 : 90_000,
  });
}

/** The newest memory the viewer hasn't seen yet (a new word, growing up…), within three days. */
const SEEN_KEY = "circle-baby-seen:";
function unseenMoment(baby: BabyState | null | undefined, seen: string | null, now: number) {
  const m = baby?.latestMoment;
  if (!m || m.id === seen || !["word", "stage", "firsthug", "healed"].includes(m.kind)) return null;
  return now - new Date(m.createdAt).getTime() < 3 * 86_400_000 ? m : null;
}
function readSeen(babyId: string | undefined) {
  if (!babyId || typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SEEN_KEY + babyId);
  } catch {
    return null;
  }
}
function markSeen(babyId: string, momentId: string) {
  try {
    localStorage.setItem(SEEN_KEY + babyId, momentId);
    window.dispatchEvent(new Event("circle-baby-seen"));
  } catch {
    /* storage unavailable */
  }
}
function useSeen(babyId: string | undefined) {
  const [seen, setSeen] = useState(() => readSeen(babyId));
  useEffect(() => {
    const sync = () => setSeen(readSeen(babyId));
    window.addEventListener("circle-baby-seen", sync);
    const timer = window.setTimeout(sync, 0);
    return () => { window.removeEventListener("circle-baby-seen", sync); window.clearTimeout(timer); };
  }, [babyId]);
  return seen;
}
function momentLine(m: Models["BabyMomentDto"]) {
  if (m.kind === "word") return `“${m.word}”`;
  if (m.kind === "stage") return "I grew up! 🎉";
  if (m.kind === "firsthug") return "Family hug! 💞";
  if (m.kind === "healed") return "I feel better!";
  return "";
}

/* -------------------------------------------------------------------------------------------- */
/* Touch zones: where on the child you tap decides how they react.                               */

/** Opaque area of each picture (as fractions), so zones follow the drawn child, not the canvas. */
const figureBoxes = new Map<string, { top: number; left: number; right: number }>();
function measure(img: HTMLImageElement) {
  const src = img.currentSrc || img.src;
  if (figureBoxes.has(src) || !img.naturalWidth) return;
  try {
    const w = 60, h = Math.max(1, Math.round((60 * img.naturalHeight) / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    let top = h, left = w, right = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 40) continue;
      if (y < top) top = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (top < h) figureBoxes.set(src, { top: top / h, left: left / w, right: (right + 1) / w });
  } catch {
    /* canvas unavailable */
  }
}

type Zone = "head" | "nose" | "belly" | "feet";
/** Head size relative to the whole body, per stage (babies are mostly head). */
const HEAD = [0.5, 0.42, 0.36, 0.31];
function zoneAt(img: HTMLImageElement | null, x: number, y: number, stage: number): Zone {
  if (!img) return "belly";
  const r = img.getBoundingClientRect();
  const box = figureBoxes.get(img.currentSrc || img.src) ?? { top: 0.08, left: 0.12, right: 0.88 };
  const fy = ((y - r.top) / r.height - box.top) / Math.max(0.2, 0.97 - box.top);
  const fx = ((x - r.left) / r.width - box.left) / Math.max(0.2, box.right - box.left);
  const head = HEAD[Math.min(3, Math.max(0, stage - 1))];
  if (fy < head) {
    const inHead = fy / head;
    return Math.abs(fx - 0.5) < 0.13 && inHead > 0.48 && inHead < 0.84 ? "nose" : "head";
  }
  return fy < head + (1 - head) * 0.55 ? "belly" : "feet";
}

type ReactionKind = "pat" | "laugh" | "sneeze" | "hmph" | "cry" | "cough" | "shh" | "kick" | "whine" | "yawn";
type Reaction = { kind: ReactionKind; key: number };
const REACTION_POSE: Partial<Record<ReactionKind, Pose>> = {
  laugh: "laugh", kick: "laugh", sneeze: "sneeze", hmph: "sad", cry: "sad", cough: "sick", whine: "sad", shh: "sleep",
};
const REACTION_FX: Record<ReactionKind, string[]> = {
  pat: ["💗", "💕", "💗"], laugh: ["✨", "😆", "✨"], kick: ["✨", "⭐", "✨"], sneeze: ["💨", "✨", "💨"], hmph: ["💢"], cry: ["💧", "💧"],
  cough: ["🤧"], shh: ["💤"], whine: ["🍼"], yawn: ["🥱"],
};

/* -------------------------------------------------------------------------------------------- */

function Meter({ label, icon, value, tone }: { label: string; icon: string; value: number; tone: string }) {
  return (
    <div className={`dm-baby-meter ${value < 25 ? "low" : ""}`} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span aria-hidden="true">{icon}</span>
      <span className="dm-baby-meter-copy">
        <small>{label}</small>
        <span className="dm-baby-meter-bar"><i style={{ width: `${value}%`, background: tone }} /></span>
      </span>
      <b>{value}%</b>
    </div>
  );
}

/** What the parents bought for the bedroom: a garland, a floor toy and the photo of the two of them. */
function WallDecor({ baby }: { baby: BabyState }) {
  const hang = shopItem(baby.decor.hang);
  const floor = shopItem(baby.decor.floor);
  return (
    <>
      {hang && (
        <span className={`w-decor hang ${hang.id}`} aria-hidden="true">
          <Art src={`/baby/${hang.id}.webp`} emoji={hang.emoji.repeat(5)} />
        </span>
      )}
      {baby.decor.frame && (
        <span className="dm-baby-frame w-decor-frame" aria-hidden="true">
          {baby.photoUrl ? <img src={baby.photoUrl} alt="" draggable={false} /> : <span>💞</span>}
        </span>
      )}
      {floor && (
        <span className={`w-decor floor ${floor.id}`} aria-hidden="true">
          <Art src={`/baby/${floor.id}.webp`} emoji={floor.emoji} />
        </span>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Bath: scrub the bubbles off with your finger.                                                 */

/** Fixed foam spots, so the bath looks the same every time (no randomness while rendering). */
const FOAM = Array.from({ length: 16 }, (_, i) => ({ id: i, x: 28 + ((i * 37) % 44), y: 22 + ((i * 53) % 40), s: 0.8 + ((i * 29) % 10) / 22 }));

function BathScene({ baby, gender, done, onClean }: { baby: BabyState; gender: Gender; done: boolean; onClean: () => void }) {
  const [foam, setFoam] = useState(FOAM);
  const lastSound = useRef(0);
  const finished = useRef(false);
  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (finished.current || (e.type === "pointermove" && e.pointerType === "mouse" && e.buttons === 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
    const left = foam.filter((f) => Math.hypot(f.x - x, (f.y - y) * 0.7) > 8 * f.s);
    if (left.length === foam.length) return;
    const t = performance.now();
    if (t - lastSound.current > 150) {
      lastSound.current = t;
      playBabySound("splash", baby.stage);
      haptic("tap");
    }
    if (left.length <= 2) {
      finished.current = true;
      setFoam([]);
      onClean();
    } else setFoam(left);
  };
  const pose = childPose(baby, gender, "laugh");
  return (
    <div className="dm-baby-bath" onPointerDown={scrub} onPointerMove={scrub} role="application" aria-label={`Rub the bubbles off ${baby.name}`}>
      <div className="w-bath-child">
        <Art className="dm-baby-figure" src={pose.src} fallback={pose.fallback} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
      </div>
      {foam.map((f) => (
        <i key={f.id} className="dm-baby-foam" style={{ left: `${f.x}%`, top: `${f.y}%`, "--s": f.s } as CSSProperties} aria-hidden="true" />
      ))}
      {done ? (
        <span className="dm-baby-duck" aria-hidden="true"><Art src="/baby/world/bathroom/duck.webp" fallback="/baby/toy-1.webp" emoji="🦆" /></span>
      ) : (
        <span className="dm-baby-bath-hint">Rub the bubbles away</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* The baby screen.                                                                              */

type Picker = "feed" | "play" | "wardrobe" | null;
type View = "home" | "bath" | "shop" | "memories" | "more" | "guide";
type MomentKind = "feed" | "play" | "dress" | "hug" | "family" | "buy" | "level" | "heal" | "bath" | "word";
type Moment = { kind: MomentKind; emoji: string; key: number } | null;
type Act =
  | { kind: "feed" | "play"; item: number }
  | { kind: "bath" | "sleep" | "wake" | "hug" | "medicine" }
  | { kind: "dress"; outfit: number }
  | { kind: "buy"; id: string }
  | { kind: "place"; slot: "room" | "hang" | "floor" | "frame"; id: string | null }
  | { kind: "photo"; messageId: string | null }
  | { kind: "teach"; word: string };

/**
 * The baby screen: the room, your child, what they need and what each of you did today.
 * With no child yet it asks for a name; with an open request it shows who is waiting.
 */
export function BabySheet({ peer, onRequested, onClose }: { peer: Peer; onRequested: (message: Models["DirectMessageDto"]) => void; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const state = useBaby(peer.id, true);
  const key = ["messages", user?.id, "baby", peer.id];
  const baby = state.data?.baby ?? null;
  const now = useNow();
  const [view, setView] = useState<View>("home");
  const [scene, setScene] = useState<Scene>("nursery");
  const [picker, setPicker] = useState<Picker>(null);
  const [moment, setMoment] = useState<Moment>(null);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [speech, setSpeech] = useState<{ text: string; key: number } | null>(null);
  const [coinPop, setCoinPop] = useState<{ n: number; key: number } | null>(null);
  const [bathDone, setBathDone] = useState(false);
  const [goodbye, setGoodbye] = useState(false);
  const [word, setWord] = useState("");
  const [soundOn, setSoundOn] = useState(babySoundOn);
  const pokes = useRef<number[]>([]);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => {
    preloadSfx(["laugh", "coo", "fuss", "splash", "pop", "jingle-coin", "jingle-up", "jingle-love", "place", "open", "close"]);
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      stopLullaby();
      void setAmbience(null);
    };
  }, []);
  useEffect(() => {
    void setAmbience(view === "bath" ? "bath" : null, 0.18);
    if (view !== "home") void playSfx(view === "bath" ? "open" : "whoosh", { volume: 0.4 });
  }, [view]);
  const say = (sound: BabySound) => playBabySound(sound, baby?.stage ?? 1);
  const talk = (text: string) => {
    setSpeech({ text, key: Date.now() });
    sayWord(text, baby?.stage ?? 2);
    later(() => setSpeech(null), 2600);
  };
  const celebrate = (kind: MomentKind, emoji: string) => {
    haptic("success");
    setMoment({ kind, emoji, key: Date.now() });
  };

  // Opening the screen: the child greets you, says a new word, or shows off having grown.
  const greeted = useRef(false);
  const prevFamily = useRef<boolean | null>(null);
  useEffect(() => {
    if (greeted.current || baby?.status !== "active") return;
    greeted.current = true;
    prevFamily.current = baby.familyHugToday;
    const fresh = unseenMoment(baby, readSeen(baby.id), Date.now());
    const timer = window.setTimeout(() => {
      if (fresh) markSeen(baby.id, fresh.id);
      if (fresh?.kind === "word" && fresh.word && !baby.asleep) {
        setSpeech({ text: fresh.word, key: Date.now() });
        sayWord(fresh.word, baby.stage);
        window.setTimeout(() => setSpeech(null), 3200);
      } else if (fresh?.kind === "stage" || fresh?.kind === "firsthug") {
        setMoment({ kind: fresh.kind === "stage" ? "level" : "family", emoji: fresh.kind === "stage" ? "🎉" : "💞", key: Date.now() });
        playBabySound("levelup", baby.stage);
      } else if (monthsOld(baby.bornAt, Date.now()).birthday) {
        setMoment({ kind: "level", emoji: "🎂", key: Date.now() });
        playBabySound("levelup", baby.stage);
      } else {
        const greet: BabySound = baby.asleep ? "snore" : baby.mood === "hungry" ? "whine" : baby.mood === "sad" ? "cry"
          : baby.mood === "sick" ? "cough" : baby.mood === "sleepy" ? "yawn" : "coo";
        playBabySound(greet, baby.stage);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [baby]);

  // The other parent hugged within minutes of you: a family hug, seen on both phones.
  useEffect(() => {
    if (baby?.status !== "active") return;
    const was = prevFamily.current;
    prevFamily.current = baby.familyHugToday;
    if (was !== false || !baby.familyHugToday) return;
    const timer = window.setTimeout(() => {
      setMoment({ kind: "family", emoji: "💞", key: Date.now() });
      playBabySound("kiss", baby.stage);
      void playSfx("jingle-love", { volume: 0.55, delay: 0.3 });
      window.setTimeout(() => playBabySound("sparkle", baby.stage), 600);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [baby?.status, baby?.familyHugToday, baby?.stage]);

  const put = (next: BabyState | null) => client.setQueryData<Models["BabyStateDto"]>(key, { baby: next });
  const act = useMutation({
    mutationFn: (a: Act): Promise<BabyState> => {
      const params = { babyId: baby!.id };
      switch (a.kind) {
        case "feed": return api("babyFeed", { params, body: { item: a.item } });
        case "play": return api("babyPlay", { params, body: { item: a.item } });
        case "bath": return api("babyBath", { params });
        case "sleep": return api("babySleep", { params });
        case "wake": return api("babyWake", { params });
        case "hug": return api("babyHug", { params });
        case "medicine": return api("babyMedicine", { params });
        case "dress": return api("babyOutfit", { params, body: { outfit: a.outfit } });
        case "buy": return api("babyBuy", { params, body: { item: a.id as Models["BabyBuyDto"]["item"] } });
        case "place": return api("babyPlace", { params, body: { slot: a.slot, item: a.id as Models["BabyPlaceDto"]["item"] } });
        case "photo": return api("babyPhoto", { params, body: { messageId: a.messageId } });
        case "teach": return api("babyTeach", { params, body: { word: a.word } });
      }
    },
    onMutate: (a) => {
      if (a.kind === "dress" && baby) put({ ...baby, outfit: a.outfit });
    },
    onSuccess: (next, a) => {
      const prev = baby;
      put(next);
      if (prev && next.coins > prev.coins) setCoinPop({ n: next.coins - prev.coins, key: Date.now() });
      switch (a.kind) {
        case "feed":
          setPicker(null);
          celebrate("feed", FOODS[a.item]);
          say("nom");
          break;
        case "play":
          setPicker(null);
          celebrate("play", TOYS[a.item]);
          say(a.item === 1 ? "squeak" : "giggle");
          if (a.item !== 1) later(() => say("tickle"), 700);
          break;
        case "bath":
          setBathDone(true);
          playBabySound("squeak", next.stage);
          later(() => playBabySound("sparkle", next.stage), 450);
          later(() => {
            setView("home");
            setBathDone(false);
            celebrate("bath", "🫧");
            say("giggle");
          }, 1700);
          break;
        case "sleep":
          say("yawn");
          later(playLullaby, 1300);
          break;
        case "wake":
          stopLullaby();
          if (prev && prev.energy < 50) { say("whine"); toast(`${next.name} woke up a little grumpy. Let them sleep longer next time.`); }
          else { say("yawn"); later(() => say("coo"), 1400); }
          break;
        case "hug":
          if (next.familyHugToday && !prev?.familyHugToday) {
            prevFamily.current = true;
            celebrate("family", "💞");
            say("kiss");
            void playSfx("jingle-love", { volume: 0.55, delay: 0.3 });
            later(() => say("sparkle"), 600);
          } else {
            celebrate("hug", "🤗");
            say(next.asleep ? "snore" : "kiss");
          }
          break;
        case "medicine":
          if (!next.sick) {
            celebrate("heal", "🌈");
            playBabySound("levelup", next.stage);
            later(() => say("giggle"), 900);
          } else {
            say("cough");
            toast(`Thanks! Now ${peerName} gives a dose too, and ${next.name} feels better.`);
          }
          break;
        case "dress":
          celebrate("dress", "✨");
          say("sparkle");
          later(() => say("coo"), 380);
          break;
        case "buy":
          say("coin");
          later(() => say("sparkle"), 300);
          celebrate("buy", shopItem(a.id)?.emoji ?? "✨");
          break;
        case "place":
        case "photo":
          void playSfx("place", { volume: 0.6 });
          later(() => say("sparkle"), 150);
          break;
        case "teach":
          setWord("");
          talk(next.words[0] ?? a.word);
          break;
      }
      if (prev && next.stage > prev.stage) {
        later(() => {
          playBabySound("levelup", next.stage);
          celebrate("level", "🎉");
          toast(`${next.name} grew up into a ${next.stageName.toLowerCase()}! 🎉`);
        }, 900);
      }
    },
    onError: (e, a) => {
      toast(e.message, true);
      if (a.kind === "dress") void state.refetch();
    },
  });
  const end = useMutation({
    mutationFn: () => api("babyEnd", { params: { babyId: baby!.id } }),
    onSuccess: () => { setGoodbye(false); stopLullaby(); put(null); toast("You said goodbye."); },
    onError: (e) => toast(e.message, true),
  });
  const peerName = peer.displayName.split(" ")[0];

  if (state.isPending) {
    return (
      <Modal title="Our baby" className="dm-baby-sheet" onClose={onClose}>
        <div className="dm-baby-loading" aria-busy="true"><span className="dm-older-spinner" /></div>
      </Modal>
    );
  }
  if (!baby) return <BabyRequestForm peer={peer} onRequested={(m) => { onRequested(m); void state.refetch(); }} onClose={onClose} />;
  if (baby.status === "pending") return <BabyPending baby={baby} peer={peer} onClose={onClose} onChanged={(next) => put(next)} />;

  const night = isNight(new Date(now));
  const gender = baby.gender as Gender;
  const busy = act.isPending;
  const { birthday } = monthsOld(baby.bornAt, now);
  const reactionPose = reaction ? REACTION_POSE[reaction.kind] : null;
  const pose = childPose(baby, gender, moment?.kind === "feed" ? "eat" : reactionPose ?? (moment && ["bath", "family", "heal", "level"].includes(moment.kind) ? "laugh" : null));
  const progress = baby.nextStageXp ? Math.min(100, Math.round(((baby.xp - baby.stageXp) / (baby.nextStageXp - baby.stageXp)) * 100)) : 100;
  const left = (k: "feeds" | "plays" | "baths") => baby.limits[k] - baby.mine[k];
  const age = baby.ageDays === 0 ? "Born today" : `${baby.ageDays} ${baby.ageDays === 1 ? "day" : "days"} old`;
  const badge = reaction || moment ? null : moodBadge(baby, birthday);
  const theirHugFresh = !!baby.theirHugAt && now - new Date(baby.theirHugAt).getTime() < 5 * 60_000 && !baby.familyHugToday;
  const care = (who: "mine" | "theirs") => [
    { icon: "🍼", value: baby[who].feeds, max: baby.limits.feeds, label: "Fed" },
    { icon: "🧸", value: baby[who].plays, max: baby.limits.plays, label: "Played" },
    { icon: "🛁", value: baby[who].baths, max: baby.limits.baths, label: "Bathed" },
    { icon: "💬", value: baby[who].chats, max: baby.limits.chats, label: "Talked" },
    { icon: "🎮", value: baby[who].games, max: baby.limits.games, label: "Games" },
  ];

  /** Tapping the child: head = pat, nose = sneeze, tummy = tickle, feet = giggle; too many pokes = grumpy. */
  const tap = (e: { currentTarget: HTMLButtonElement; clientX: number; clientY: number }) => {
    haptic("tap");
    setMoment(null);
    const t = performance.now();
    pokes.current = [...pokes.current.filter((p) => t - p < 2500), t];
    const react = (kind: ReactionKind, sound: BabySound) => {
      setReaction({ kind, key: Date.now() });
      say(sound);
      later(() => setReaction((r) => (r?.kind === kind ? null : r)), kind === "sneeze" ? 1700 : 1300);
    };
    if (baby.asleep) return react("shh", "snore");
    if (baby.mood === "sick") return react("cough", "cough");
    const n = pokes.current.length;
    if (n >= 8) { pokes.current = []; return react("cry", "cry"); }
    if (n >= 5) return react("hmph", "hmph");
    if (baby.mood === "hungry") return react("whine", "whine");
    if (baby.mood === "sleepy") return react("yawn", "yawn");
    const zone = zoneAt(e.currentTarget.querySelector("img"), e.clientX, e.clientY, baby.stage);
    if (zone === "nose") return react("sneeze", "sneeze");
    if (zone === "belly") return react("laugh", "tickle");
    if (zone === "feet") return react("kick", "giggle");
    react("pat", "pat");
    // A happy toddler who knows words sometimes says one back when you stroke their head.
    if (baby.words.length && baby.mood === "happy" && (n === 1 || Math.random() < 0.5)) {
      const said = baby.words[Math.floor(Math.random() * Math.min(baby.words.length, 12))];
      later(() => talk(said), 900);
    }
  };

  const childButton = (
    <button
      type="button"
      key={`${moment?.key ?? 0}-${reaction?.key ?? 0}`}
      className={`dm-baby-child stage-${baby.stage} ${moment ? `moment ${moment.kind}` : ""} ${reaction ? `react ${reaction.kind}` : ""} ${baby.mood} ${baby.asleep ? "sleeping" : ""}`}
      aria-label={`${baby.name}. Tap the head, nose, tummy or feet`}
      onClick={(e) => { e.stopPropagation(); tap(e); }}
    >
      <Art className="dm-baby-figure" src={pose.src} fallback={pose.fallback} emoji={STAGE_EMOJI[gender][baby.stage - 1]} alt={baby.name} onLoad={measure} />
      {badge && <span className="dm-baby-bubble" aria-hidden="true">{badge}</span>}
      {reaction && (
        <span className="dm-baby-fx" aria-hidden="true">
          {REACTION_FX[reaction.kind].map((fx, i) => <i key={i} style={{ "--i": i } as CSSProperties}>{fx}</i>)}
        </span>
      )}
      {speech && <span key={speech.key} className="dm-baby-speech">{speech.text}</span>}
    </button>
  );
  const momentFx = moment && view !== "bath" ? (
    <span key={`m${moment.key}`} className={`dm-baby-moment ${moment.kind}`} aria-hidden="true">
      {moment.kind === "feed" ? (
        <Art className="dm-baby-moment-item" src={`/baby/food-${FOODS.indexOf(moment.emoji)}.webp`} emoji={moment.emoji} />
      ) : moment.kind === "play" ? (
        <Art className="dm-baby-moment-item" src={`/baby/toy-${TOYS.indexOf(moment.emoji)}.webp`} emoji={moment.emoji} />
      ) : null}
      {Array.from({ length: moment.kind === "family" || moment.kind === "level" ? 10 : 6 }, (_, i) => (
        <i key={i} style={{ "--i": i } as CSSProperties}>
          {moment.kind === "dress" || moment.kind === "buy" ? "✨" : moment.kind === "family" ? (i % 2 ? "💞" : "💗")
            : moment.kind === "level" ? (i % 3 ? "🎉" : "⭐") : moment.kind === "bath" ? "🫧" : moment.kind === "heal" ? (i % 2 ? "🌈" : "✨") : "💗"}
        </i>
      ))}
    </span>
  ) : null;
  // Asleep means in bed; bath time means the bathroom; food in the kitchen means the high chair.
  const where: Scene = baby.asleep ? "nursery" : view === "bath" ? "bathroom" : scene;
  const mode = baby.asleep ? "bed" : view === "bath" ? "bath" : where === "kitchen" && (picker === "feed" || moment?.kind === "feed") ? "chair" : "walk";
  const startBath = () => {
    if (baby.asleep) return toast(`${baby.name} is sleeping`);
    if (left("baths") <= 0) return toast(`${baby.name} is clean for today`);
    if (baby.clean >= CLEAN_AT) return toast(`${baby.name} is already clean`);
    setPicker(null);
    setBathDone(false);
    setScene("bathroom");
    setView("bath");
  };
  const openFeed = () => {
    if (baby.fullness >= FULL_AT) return toast(`${baby.name} is full right now. Try again a bit later`);
    setView("home");
    setScene("kitchen");
    setPicker("feed");
  };
  const goToBed = () => {
    if (baby.energy >= RESTED_AT) return toast(`${baby.name} isn't sleepy yet (${baby.energy}% energy)`);
    setPicker(null);
    setView("home");
    setScene("nursery");
    act.mutate({ kind: "sleep" });
  };
  const need = needOf(baby, left);
  const doNeed = () => {
    haptic("tap");
    if (need.id === "feed") openFeed();
    else if (need.id === "sleep") goToBed();
    else if (need.id === "bath") startBath();
    else if (need.id === "play") { setView("home"); setPicker("play"); }
  };
  const careDone = (["feeds", "plays", "baths"] as const).reduce((n, k) => n + baby.mine[k], 0);
  const careMax = (["feeds", "plays", "baths"] as const).reduce((n, k) => n + baby.limits[k], 0);
  const room = (
    <BabyWorld
      baby={baby}
      peer={peer}
      scene={where}
      night={night || baby.asleep}
      mode={mode}
      child={childButton}
      childStage={baby.stage}
      fx={momentFx}
      decor={<WallDecor baby={baby} />}
      bath={view === "bath" ? <BathScene baby={baby} gender={gender} done={bathDone} onClean={() => act.mutate({ kind: "bath" })} /> : null}
      onScene={(next) => { setPicker(null); setScene(next); }}
      onBed={() => (baby.asleep ? act.mutate({ kind: "wake" }) : goToBed())}
      onWardrobe={() => setPicker("wardrobe")}
      onToys={() => setPicker("play")}
      onFeedSpot={() => {
        if (baby.asleep) return;
        if (left("feeds") <= 0) return toast(`${baby.name} has eaten enough from you today`);
        if (baby.fullness >= FULL_AT) return toast(`${baby.name} is full right now. Try again a bit later`);
        setPicker("feed");
      }}
      onBath={startBath}
      onIceCream={() => {
        if (baby.asleep) return toast(`${baby.name} is sleeping`);
        if (baby.stage < 2) return toast(`${baby.name} is a bit too little for ice cream 🍦`);
        if (baby.fullness >= FULL_AT) return toast(`${baby.name} is full right now. Try again a bit later`);
        if (left("feeds") <= 0) return toast(`${baby.name} has eaten enough from you today`);
        act.mutate({ kind: "feed", item: 10 });
      }}
      onLeaveChair={() => setPicker(null)}
      overlay={
        <>
          <div className="dm-baby-tag">
            <strong>{baby.name}{birthday ? " 🎂" : ""}</strong>
            <span>{age} · {baby.stageName}</span>
            <em className={careDone >= careMax ? "done" : ""} title="Your care today">
              {`${careDone >= careMax ? "✓ " : ""}${careDone}/${careMax} today`}
            </em>
          </div>
          <div className="dm-baby-corner">
            <button type="button" className="dm-baby-mute dm-baby-help" aria-label="How it works" aria-pressed={view === "guide"} onClick={() => { setPicker(null); setView(view === "guide" ? "home" : "guide"); }}>
              <b aria-hidden="true">?</b>
            </button>
            <button type="button" className="dm-baby-coins" onClick={() => { setPicker(null); setView(view === "shop" ? "home" : "shop"); }} aria-label={`${baby.coins} coins. Open the shop`}>
              <Coin /> <b>{baby.coins.toLocaleString()}</b>
              {coinPop && <em key={coinPop.key} onAnimationEnd={() => setCoinPop(null)}>+{coinPop.n}</em>}
            </button>
            <button
              type="button"
              className="dm-baby-mute"
              aria-label={soundOn ? "Mute baby sounds" : "Turn on baby sounds"}
              aria-pressed={!soundOn}
              onClick={() => {
                setBabySoundOn(!soundOn);
                setSoundOn(!soundOn);
                if (soundOn) { stopLullaby(); void setAmbience(null); }
                else playBabySound("coo", baby.stage);
              }}
            >
              {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
          </div>
        </>
      }
    />
  );

  if (view === "memories") {
    return (
      <Modal title={baby.name} className="dm-baby-sheet" onClose={onClose}>
        <MemoriesPanel baby={baby} gender={gender} peer={peer} onBack={() => setView("home")} />
      </Modal>
    );
  }

  const closeTray = () => { setPicker(null); if (view === "shop" || view === "more" || view === "guide") setView("home"); };
  const trayTitle = picker === "feed" ? "What should we eat?" : picker === "play" ? "Pick a toy" : picker === "wardrobe" ? "Wardrobe" : null;
  const dock: { id: string; icon: ReactNode; label: string; badge?: string | number; active?: boolean; disabled?: boolean; hint?: boolean; onClick: () => void }[] = [
    {
      id: "feed", icon: <Utensils size={21} />, label: "Feed", badge: left("feeds") > 0 ? left("feeds") : undefined, active: picker === "feed",
      disabled: left("feeds") <= 0 || baby.asleep,
      onClick: () => { if (picker === "feed") setPicker(null); else openFeed(); },
    },
    {
      id: "play", icon: <ToyBrick size={21} />, label: "Play", badge: left("plays") > 0 ? left("plays") : undefined, active: picker === "play",
      disabled: left("plays") <= 0 || baby.asleep,
      onClick: () => { setView("home"); setPicker(picker === "play" ? null : "play"); },
    },
    { id: "bath", icon: <Bath size={21} />, label: "Bath", badge: left("baths") > 0 ? left("baths") : undefined, disabled: left("baths") <= 0 || baby.asleep, onClick: startBath },
    baby.asleep
      ? { id: "wake", icon: <Sun size={21} />, label: "Wake", disabled: busy, onClick: () => act.mutate({ kind: "wake" }) }
      : {
        id: "sleep", icon: <Moon size={21} />, label: "Sleep", hint: (night && baby.energy < RESTED_AT) || baby.mood === "sleepy", disabled: busy,
        onClick: goToBed,
      },
    { id: "hug", icon: <Heart size={21} />, label: "Hug", badge: baby.familyHugToday ? "✓" : undefined, hint: theirHugFresh, disabled: busy, onClick: () => act.mutate({ kind: "hug" }) },
    { id: "dress", icon: <Shirt size={21} />, label: "Dress", active: picker === "wardrobe", onClick: () => { setView("home"); setPicker(picker === "wardrobe" ? null : "wardrobe"); } },
    { id: "shop", icon: <ShoppingBag size={21} />, label: "Shop", active: view === "shop", onClick: () => { setPicker(null); setView(view === "shop" ? "home" : "shop"); } },
    { id: "more", icon: <BookHeart size={21} />, label: "Us", active: view === "more", onClick: () => { setPicker(null); setView(view === "more" ? "home" : "more"); } },
  ];
  const meters = [
    { icon: "🍼", label: "Tummy", value: baby.fullness, tone: "#fd7e14" },
    { icon: "💗", label: "Happiness", value: baby.happiness, tone: "#e64980" },
    { icon: "🫧", label: "Clean", value: baby.clean, tone: "#22b8cf" },
    { icon: "⚡", label: baby.asleep ? "Energy (sleeping)" : "Energy", value: baby.energy, tone: "#fab005" },
  ];

  return (
    <Modal title={baby.name} className="dm-baby-sheet game" onClose={onClose}>
      <div className="dm-baby game">
        {room}

        {/* Things that need you right now float over the world. */}
        {(baby.sick || theirHugFresh) && view !== "bath" && (
          <div className="dm-baby-floats">
            {baby.sick && (
              <div className="dm-baby-alert sick">
                <span className="dm-baby-alert-icon" aria-hidden="true">🤒</span>
                <span className="dm-baby-alert-copy">
                  <strong>{baby.name} caught a cold</strong>
                  <small>{baby.medicineMine ? "✓ You" : "○ You"} · {baby.medicineTheirs ? `✓ ${peerName}` : `○ ${peerName}`}</small>
                </span>
                <button type="button" disabled={busy || baby.medicineMine} onClick={() => act.mutate({ kind: "medicine" })}>
                  <Pill size={15} /> {baby.medicineMine ? "Given" : "Medicine"}
                </button>
              </div>
            )}
            {theirHugFresh && (
              <div className="dm-baby-alert hug">
                <span className="dm-baby-alert-icon" aria-hidden="true">💞</span>
                <span className="dm-baby-alert-copy">
                  <strong>{peerName} just hugged {baby.name}</strong>
                  <small>Hug too for a family hug</small>
                </span>
                <button type="button" disabled={busy} onClick={() => act.mutate({ kind: "hug" })}><Heart size={15} /> Hug</button>
              </div>
            )}
          </div>
        )}

        {view === "bath" ? (
          <div className="dm-baby-bathbar">
            <span>🫧 Rub the bubbles off {baby.name}</span>
            <button type="button" className="dm-baby-secondary" disabled={busy || bathDone} onClick={() => setView("home")}>Not now</button>
          </div>
        ) : (
          <>
            {!baby.sick && !theirHugFresh && (
              <div key={need.id} className={`dm-baby-coach ${need.id}`} role="status">
                <span aria-hidden="true">{need.icon}</span>
                <strong>{need.text}</strong>
                {need.cta && <button type="button" disabled={busy} onClick={doNeed}>{need.cta}</button>}
              </div>
            )}
            <div className="dm-baby-hud" aria-label="How your baby is doing">
              <span className="dm-baby-hud-grow" title={baby.nextStageXp ? `${(baby.nextStageXp - baby.xp).toLocaleString()} XP to the next stage` : "All grown up"}>
                <span className="dm-baby-hud-grow-top">
                  <small>🌱 {baby.stageName}</small>
                  <b>{baby.nextStageXp ? `${progress}%` : "🎓"}</b>
                </span>
                <span className="dm-baby-hud-bar"><i style={{ width: `${progress}%` }} /></span>
              </span>
              {meters.map((m) => (
                <span key={m.label} className={`dm-baby-hud-meter ${m.value < 25 ? "low" : ""}`} role="meter" aria-label={m.label} aria-valuenow={m.value} aria-valuemin={0} aria-valuemax={100} title={`${m.label} ${m.value}%`}
                  style={{ "--v": m.value, "--tone": m.tone } as CSSProperties}>
                  <span className="dm-baby-ring" aria-hidden="true"><i>{m.icon}</i></span>
                  <b>{m.value}</b>
                </span>
              ))}
            </div>
            <nav className="dm-baby-dock" aria-label="Care">
              {dock.map((d) => (
                <button key={d.id} type="button" className={`${d.active ? "active" : ""} ${d.hint ? "hint" : ""}`} disabled={d.disabled} onClick={() => { haptic("tap"); d.onClick(); }}>
                  <span className="dm-baby-dock-icon">{d.icon}{d.badge !== undefined && <em>{d.badge}</em>}</span>
                  <small>{d.label}</small>
                </button>
              ))}
            </nav>
          </>
        )}

        {/* Bottom trays: they slide over the world, so nothing ever needs a long scroll. */}
        {(trayTitle || view === "shop" || view === "more" || view === "guide") && (
          <div className="dm-baby-scrim" onClick={closeTray} aria-hidden="true" />
        )}
        {trayTitle && (
          <section className={`dm-baby-tray ${picker === "wardrobe" ? "tall" : ""}`} aria-label={trayTitle}>
            <header className="dm-baby-tray-head">
              <span className="dm-baby-tray-grip" aria-hidden="true" />
              <strong>{trayTitle}</strong>
              <button type="button" onClick={closeTray} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="dm-baby-tray-body">
              {picker === "feed" && (
                <div className="dm-baby-picker" role="group" aria-label="Choose food">
                  {FOODS_BY_STAGE[baby.stage - 1].map((i) => (
                    <button key={i} type="button" disabled={busy} onClick={() => act.mutate({ kind: "feed", item: i })}>
                      <Art src={`/baby/food-${i}.webp`} emoji={FOODS[i]} />
                      <small>{FOOD_NAMES[i]}</small>
                    </button>
                  ))}
                </div>
              )}
              {picker === "play" && (
                <div className="dm-baby-picker" role="group" aria-label="Choose a toy">
                  {TOYS.map((emoji, i) => {
                    const locked = i >= FREE_TOYS && !baby.owned.includes(`toy-${i}`);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={locked ? "locked" : ""}
                        disabled={busy}
                        aria-label={locked ? `${TOY_NAMES[i]}: in the shop` : TOY_NAMES[i]}
                        onClick={() => (locked ? (setPicker(null), setView("shop")) : act.mutate({ kind: "play", item: i }))}
                      >
                        <Art src={`/baby/toy-${i}.webp`} emoji={emoji} />
                        <small>{locked ? <><Lock size={10} /> Shop</> : TOY_NAMES[i]}</small>
                      </button>
                    );
                  })}
                </div>
              )}
              {picker === "wardrobe" && (
                <div className="dm-baby-picker wardrobe" role="radiogroup" aria-label="Outfits">
                  {OUTFITS[gender][baby.stage - 1].map((name, i) => (
                    <button key={i} type="button" role="radio" aria-checked={baby.outfit === i} className={baby.outfit === i ? "selected" : ""}
                      disabled={busy} onClick={() => baby.outfit !== i && act.mutate({ kind: "dress", outfit: i })}>
                      <Art src={childArt(gender, baby.stage, i)} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
                      <small>{name}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
        {view === "shop" && (
          <section className="dm-baby-tray tall" aria-label="Shop">
            <div className="dm-baby-tray-body">
              <ShopPanel
                baby={baby}
                peer={peer}
                busy={busy}
                onBuy={(id) => act.mutate({ kind: "buy", id })}
                onPlace={(slot, id) => act.mutate({ kind: "place", slot, id })}
                onPhoto={(messageId) => act.mutate({ kind: "photo", messageId })}
                onBack={closeTray}
              />
            </div>
          </section>
        )}
        {view === "guide" && (
          <section className="dm-baby-tray tall" aria-label="How it works">
            <header className="dm-baby-tray-head">
              <span className="dm-baby-tray-grip" aria-hidden="true" />
              <strong>How it works</strong>
              <button type="button" onClick={closeTray} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="dm-baby-tray-body">
              <BabyGuide />
            </div>
          </section>
        )}
        {view === "more" && (
          <section className="dm-baby-tray tall" aria-label={`${baby.name} and us`}>
            <header className="dm-baby-tray-head">
              <span className="dm-baby-tray-grip" aria-hidden="true" />
              <strong>{baby.name} &amp; us</strong>
              <button type="button" onClick={closeTray} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="dm-baby-tray-body">
              <div className="dm-baby-growth">
                <div className="dm-baby-growth-head">
                  <span>{baby.nextStageXp ? `Growing up · ${progress}%` : "All grown up 🎓"}</span>
                  {baby.nextStageXp && <small>{(baby.nextStageXp - baby.xp).toLocaleString()} XP to go</small>}
                </div>
                <span className="dm-baby-growth-bar"><i style={{ width: `${progress}%` }} /></span>
              </div>
              <div className="dm-baby-meters">
                {meters.map((m) => <Meter key={m.label} label={m.label} icon={m.icon} value={m.value} tone={m.tone} />)}
              </div>
              <button type="button" className="dm-baby-memories-link" onClick={() => setView("memories")}>
                <BookHeart size={20} />
                <span>
                  <strong>Memories</strong>
                  <small>{baby.words.length ? `${baby.words.length} words · ` : ""}our story so far</small>
                </span>
                <ChevronRight size={18} />
              </button>

              <h3 className="dm-set-label">Words</h3>
              {baby.stage >= 2 ? (
                <div className="dm-baby-words">
                  {baby.words.length > 0 && (
                    <div className="dm-baby-word-list">
                      {baby.words.slice(0, 12).map((w) => (
                        <button key={w} type="button" onClick={() => talk(w)} disabled={baby.asleep}>{w}</button>
                      ))}
                    </div>
                  )}
                  <form
                    className="dm-baby-teach"
                    onSubmit={(e: FormEvent) => { e.preventDefault(); if (word.trim() && !busy) act.mutate({ kind: "teach", word: word.trim() }); }}
                  >
                    <input value={word} maxLength={20} placeholder={`Teach ${baby.name} a word`} aria-label="New word" onChange={(e) => setWord(e.target.value)} />
                    <button type="submit" disabled={!word.trim() || busy || baby.asleep}><Sparkles size={15} /> Teach</button>
                  </form>
                  <p className="dm-set-note">{baby.name} also picks up the sweet words you two use in this chat, one a day.</p>
                </div>
              ) : (
                <p className="dm-set-note dm-baby-words-soon">
                  🗣️ {baby.name} starts talking as a toddler. The first word comes from how you two talk to each other here.
                </p>
              )}

              <h3 className="dm-set-label">Today</h3>
              <div className="dm-baby-today">
                {(["mine", "theirs"] as const).map((who) => (
                  <div key={who} className="dm-baby-parent">
                    <span className="dm-baby-parent-head">
                      <Avatar user={who === "mine" ? (user ?? peer) : peer} size={26} />
                      <strong>{who === "mine" ? "You" : peerName}</strong>
                    </span>
                    <span className="dm-baby-care">
                      {care(who).map((c) => (
                        <span key={c.label} className={c.value >= c.max ? "done" : c.value ? "some" : ""} title={`${c.label} ${c.value}/${c.max}`}>
                          {c.icon} <b>{c.value}</b>/{c.max}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <p className="dm-set-note">
                {baby.name} grows when you talk, feed, play and bathe them. Caring on the same day as {peerName} gives a bonus, and every bit of care fills your shared piggy bank. Daily limits reset at midnight (UTC).
              </p>
              <button type="button" className="dm-baby-goodbye" onClick={() => setGoodbye(true)}>Say goodbye to {baby.name}</button>
            </div>
          </section>
        )}
      </div>
      {goodbye && (
        <ConfirmDialog
          title={`Say goodbye to ${baby.name}?`}
          description={`${baby.name} will leave for both of you, with all growth, words, coins and memories. This can't be undone.`}
          confirmLabel="Say goodbye"
          pending={end.isPending}
          onConfirm={() => end.mutate()}
          onClose={() => setGoodbye(false)}
        />
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Shop: spend the shared piggy bank on toys and things for the room.                            */

function ShopPanel({ baby, peer, busy, onBuy, onPlace, onPhoto, onBack }: {
  baby: BabyState; peer: Peer; busy: boolean;
  onBuy: (id: string) => void;
  onPlace: (slot: "room" | "hang" | "floor" | "frame", id: string | null) => void;
  onPhoto: (messageId: string | null) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<ShopGroup>("decor");
  const [picking, setPicking] = useState(false);
  const items = SHOP.filter((i) => i.group === tab);
  return (
    <div className="dm-baby-shop">
      <div className="dm-baby-subhead">
        <button type="button" className="dm-baby-back" onClick={onBack} aria-label="Back"><ChevronLeft size={20} /></button>
        <strong>Shop</strong>
        <span className="dm-baby-wallet"><Coin /> {baby.coins.toLocaleString()}</span>
      </div>
      <div className="dm-baby-tabs" role="tablist">
        {(["decor", "rooms", "toys"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setPicking(false); }}>
            {t === "decor" ? "Decor" : t === "rooms" ? "Rooms" : "Toys"}
          </button>
        ))}
      </div>
      {picking ? (
        <PhotoPicker peer={peer} current={baby.photoUrl} busy={busy} onPick={(id) => { onPhoto(id); setPicking(false); }} onClose={() => setPicking(false)} />
      ) : (
        <div className="dm-baby-shop-grid">
          {items.map((item) => {
            const owned = baby.owned.includes(item.id);
            const placed = !!item.slot && baby.decor[item.slot] === item.id;
            const short = item.price - baby.coins;
            return (
              <div key={item.id} className={`dm-baby-shop-item ${owned ? "owned" : ""} ${placed ? "placed" : ""}`}>
                <span className={`dm-baby-shop-art ${item.group}`}>
                  {item.group === "rooms" ? (
                    <Art src={roomThumb(item.id)} emoji={item.emoji} />
                  ) : item.id === "frame" ? (
                    <span className="dm-baby-frame mini">{baby.photoUrl ? <img src={baby.photoUrl} alt="" /> : <span>💞</span>}</span>
                  ) : (
                    <Art src={item.group === "toys" ? `/baby/${item.id}.webp` : `/baby/${item.id}.webp`} emoji={item.emoji} />
                  )}
                </span>
                <strong>{item.name}</strong>
                {!owned ? (
                  <button type="button" className="buy" disabled={busy || short > 0} onClick={() => onBuy(item.id)}>
                    {short > 0 ? <>Need {short} <Coin /></> : <><Coin /> {item.price}</>}
                  </button>
                ) : item.group === "toys" ? (
                  <span className="dm-baby-owned">In the toy box ✓</span>
                ) : (
                  <span className="dm-baby-shop-row">
                    <button type="button" className={placed ? "on" : ""} disabled={busy} onClick={() => onPlace(item.slot!, placed ? null : item.id)}>
                      {placed ? "Take down" : "Put up"}
                    </button>
                    {item.id === "frame" && (
                      <button type="button" disabled={busy} onClick={() => setPicking(true)}>{baby.photoUrl ? "Change photo" : "Pick photo"}</button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="dm-set-note">
        Feeding, playing, baths, games, bedtime and family hugs fill the piggy bank you share with {peer.displayName.split(" ")[0]}. Growing up gives 100 coins.
      </p>
    </div>
  );
}

/** Photos the two of you shared in this chat, to put in the frame. */
function PhotoPicker({ peer, current, busy, onPick, onClose }: { peer: Peer; current: string | null; busy: boolean; onPick: (messageId: string | null) => void; onClose: () => void }) {
  const { user } = useSession();
  const media = useInfiniteQuery({
    queryKey: ["messages", user?.id, "baby-photos", peer.id],
    queryFn: ({ pageParam, signal }) => api("messagesSharedMedia", { params: { id: peer.id }, query: { cursor: pageParam, limit: 30, kind: "media" }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const photos = (media.data?.pages ?? []).flatMap((p) => p.items).filter((m) => m.media?.type === "IMAGE" && !m.viewOnce && m.media.url);
  return (
    <div className="dm-baby-photos">
      <div className="dm-baby-photos-head">
        <strong>Choose a photo of you two</strong>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
      {media.isPending ? (
        <div className="dm-baby-loading small"><span className="dm-older-spinner" /></div>
      ) : photos.length === 0 ? (
        <p className="dm-set-note">Share a photo in this chat first, then pick it here.</p>
      ) : (
        <div className="dm-baby-photo-grid">
          {photos.map((m) => (
            <button key={m.id} type="button" disabled={busy} onClick={() => onPick(m.id)} className={current === m.media!.url ? "selected" : ""}>
              <img src={m.media!.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {media.hasNextPage && (
        <button type="button" className="dm-baby-secondary" disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()}>
          {media.isFetchingNextPage ? "Loading…" : "More photos"}
        </button>
      )}
      {current && <button type="button" className="dm-baby-secondary" disabled={busy} onClick={() => onPick(null)}>Remove photo</button>}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Memory book: every milestone, monthly birthdays and every word, newest first.                 */

function MemoriesPanel({ baby, gender, peer, onBack }: { baby: BabyState; gender: Gender; peer: Peer; onBack: () => void }) {
  const { user } = useSession();
  const now = useNow(60_000);
  const memories = useQuery({
    queryKey: ["messages", user?.id, "baby-memories", baby.id, baby.latestMoment?.id ?? null],
    queryFn: ({ signal }) => api("babyMemories", { params: { babyId: baby.id }, signal }),
  });
  const peerName = peer.displayName.split(" ")[0];
  const who = (id: string | null) => (id === user?.id ? "You" : id === peer.id ? peerName : null);
  const { months } = monthsOld(baby.bornAt, now);
  const born = baby.bornAt ? new Date(baby.bornAt) : null;
  type Entry = { id: string; at: number; art: ReactNode; title: string; sub: string | null };
  const entries: Entry[] = [];
  for (const m of memories.data?.moments ?? []) {
    const at = new Date(m.createdAt).getTime();
    const by = who(m.byId);
    if (m.kind === "born") {
      entries.push({ id: m.id, at, art: <Art src={childArt(gender, 1, 0)} emoji="👶" />, title: `${baby.name} was born`, sub: "Welcome to the world 💗" });
    } else if (m.kind === "stage") {
      const stage = m.stage ?? 2;
      entries.push({ id: m.id, at, art: <Art src={childArt(gender, stage, m.outfit ?? 0)} emoji={STAGE_EMOJI[gender][stage - 1]} />,
        title: `Became a ${["baby", "toddler", "child", "big kid"][stage - 1]}`, sub: null });
    } else if (m.kind === "word") {
      const first = memories.data?.words.length && memories.data.words[memories.data.words.length - 1].word === m.word;
      entries.push({ id: m.id, at, art: <span className="dm-baby-mem-emoji">🗣️</span>,
        title: first ? `First word: “${m.word}”` : `Learned “${m.word}”`, sub: by ? `Taught by ${by}` : first ? "Picked up from your chat" : null });
    } else if (m.kind === "firsthug") {
      entries.push({ id: m.id, at, art: <span className="dm-baby-mem-emoji">💞</span>, title: "First family hug", sub: "Both of you, at the same time" });
    } else if (m.kind === "healed") {
      entries.push({ id: m.id, at, art: <span className="dm-baby-mem-emoji">🌈</span>, title: "Got over a cold", sub: by ? `Last dose from ${by}` : null });
    } else if (m.kind === "bought") {
      const item = shopItem(m.item);
      entries.push({ id: m.id, at,
        art: item?.group === "rooms" ? <Art src={roomThumb(item.id)} emoji={item.emoji} /> : <Art src={`/baby/${m.item}.webp`} emoji={item?.emoji ?? "🎁"} />,
        title: `New in the room: ${item?.name ?? "a surprise"}`, sub: by ? `From ${by}` : null });
    }
  }
  if (born) {
    for (let n = 1; n <= months; n++) {
      const at = nthBirthday(born, n);
      entries.push({ id: `bday-${n}`, at: at.getTime(), art: <span className="dm-baby-mem-emoji">🎂</span>,
        title: `${n} ${n === 1 ? "month" : "months"} old`, sub: "Happy birthday!" });
    }
  }
  entries.sort((a, b) => b.at - a.at);
  const words = memories.data?.words ?? [];
  return (
    <div className="dm-baby-memories">
      <div className="dm-baby-subhead">
        <button type="button" className="dm-baby-back" onClick={onBack} aria-label="Back"><ChevronLeft size={20} /></button>
        <strong>Memories</strong>
        <span className="dm-baby-wallet">{baby.ageDays} {baby.ageDays === 1 ? "day" : "days"}</span>
      </div>
      <div className="dm-baby-mem-cover">
        <Art src={childArt(gender, baby.stage, baby.outfit)} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
        <span>
          <strong>{baby.name}</strong>
          <small>{baby.stageName} · {months >= 1 ? `${months} ${months === 1 ? "month" : "months"}` : `${baby.ageDays} days`} · {baby.familyHugs} family {baby.familyHugs === 1 ? "hug" : "hugs"}</small>
        </span>
      </div>
      {words.length > 0 && (
        <>
          <h3 className="dm-set-label">{words.length} {words.length === 1 ? "word" : "words"}</h3>
          <div className="dm-baby-word-list">
            {words.map((w) => <button key={w.word} type="button" onClick={() => sayWord(w.word, baby.stage)}>{w.word}</button>)}
          </div>
        </>
      )}
      <h3 className="dm-set-label">Our story</h3>
      {memories.isPending ? (
        <div className="dm-baby-loading small"><span className="dm-older-spinner" /></div>
      ) : (
        <ol className="dm-baby-timeline">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="dm-baby-mem-art">{e.art}</span>
              <span className="dm-baby-mem-copy">
                <strong>{e.title}</strong>
                <small>
                  {new Date(e.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  {e.sub ? ` · ${e.sub}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BabyRequestForm({ peer, onRequested, onClose }: { peer: Peer; onRequested: (message: Models["DirectMessageDto"]) => void; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("girl");
  const send = useMutation({
    mutationFn: () => api("messagesStartBaby", { params: { id: peer.id }, body: { name: name.trim(), gender } }),
    onSuccess: (message) => {
      haptic("success");
      toast(`Request sent to ${peer.displayName}.`);
      onRequested(message);
    },
    onError: (e) => toast(e.message, true),
  });
  return (
    <Modal title="Our baby" className="dm-baby-sheet" onClose={onClose}>
      <form className="dm-baby-request" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !send.isPending) send.mutate(); }}>
        <Art className="dm-baby-stork" src="/baby/stork.webp" emoji="🕊️" />
        <h2>Raise a little one together</h2>
        <p>Ask {peer.displayName} to have a baby with you. Your child grows over the coming months as you talk, feed and play together.</p>
        <div className="dm-baby-gender" role="radiogroup" aria-label="Girl or boy">
          {(["girl", "boy"] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={gender === g} className={gender === g ? "selected" : ""} onClick={() => { haptic("tap"); setGender(g); }}>
              <Art src={childArt(g, 1, 0)} emoji="👶" />
              <span>{g === "girl" ? "Girl" : "Boy"}</span>
            </button>
          ))}
        </div>
        <div className="dm-set-group">
          <input className="dm-set-input" value={name} maxLength={24} placeholder="Baby's name" aria-label="Baby's name" onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="dm-baby-primary" disabled={!name.trim() || send.isPending}>
          <Baby size={18} /> {send.isPending ? "Sending…" : `Ask ${peer.displayName.split(" ")[0]}`}
        </button>
      </form>
    </Modal>
  );
}

function BabyPending({ baby, peer, onChanged, onClose }: { baby: BabyState; peer: Peer; onChanged: (baby: BabyState | null) => void; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const mine = baby.requestedBy === user?.id;
  const accept = useMutation({
    mutationFn: () => api("babyAccept", { params: { babyId: baby.id } }),
    onSuccess: (next) => { haptic("success"); onChanged(next); },
    onError: (e) => toast(e.message, true),
  });
  const decline = useMutation({
    mutationFn: () => api("babyDecline", { params: { babyId: baby.id } }),
    onSuccess: () => { onChanged(null); toast(mine ? "Request withdrawn." : "Request declined."); },
    onError: (e) => toast(e.message, true),
  });
  return (
    <Modal title="Our baby" className="dm-baby-sheet" onClose={onClose}>
      <div className="dm-baby-request">
        <Art className="dm-baby-stork flying" src="/baby/stork.webp" emoji="🕊️" />
        <h2>{mine ? `Waiting for ${peer.displayName.split(" ")[0]}…` : `${peer.displayName} wants a baby with you`}</h2>
        <p>{baby.gender === "girl" ? "A little girl" : "A little boy"} named <strong>{baby.name}</strong> is on the way.</p>
        {!mine && (
          <button type="button" className="dm-baby-primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
            👶 {accept.isPending ? "Welcoming…" : `Welcome ${baby.name}`}
          </button>
        )}
        <button type="button" className="dm-baby-secondary" disabled={decline.isPending} onClick={() => decline.mutate()}>
          {mine ? "Withdraw request" : "Not now"}
        </button>
      </div>
    </Modal>
  );
}

/** The request as it appears in the chat, with Accept for the other person. */
export function BabyInviteCard({ invite, own, peer, onOpen }: { invite: Invite; own: boolean; peer: Peer; onOpen?: () => void }) {
  const current = useBaby(peer.id);
  const client = useQueryClient();
  const { user } = useSession();
  const toast = useToast();
  const live = current.data?.baby?.id === invite.id ? current.data.baby : null;
  const status = live?.status ?? (invite.status === "pending" && current.data ? "declined" : invite.status);
  const accept = useMutation({
    mutationFn: () => api("babyAccept", { params: { babyId: invite.id } }),
    onSuccess: (next) => {
      haptic("success");
      client.setQueryData<Models["BabyStateDto"]>(["messages", user?.id, "baby", peer.id], { baby: next });
      onOpen?.();
    },
    onError: (e) => toast(e.message, true),
  });
  const decline = useMutation({
    mutationFn: () => api("babyDecline", { params: { babyId: invite.id } }),
    onSuccess: () => void current.refetch(),
    onError: (e) => toast(e.message, true),
  });
  const text =
    status === "pending"
      ? own ? `You asked ${peer.displayName.split(" ")[0]} to have a baby` : `${peer.displayName.split(" ")[0]} wants to have a baby with you`
      : status === "active" ? `${invite.name} was born 🎉`
        : status === "ended" ? `${invite.name} said goodbye` : "Baby request closed";
  return (
    <div className={`dm-baby-invite ${status}`}>
      <Art className="dm-baby-invite-art" src={status === "active" ? childArt(invite.gender as Gender, 1, 0) : "/baby/stork.webp"} emoji={status === "active" ? "👶" : "🕊️"} />
      <strong>{text}</strong>
      <small>{invite.gender === "girl" ? "Girl" : "Boy"} · {invite.name}</small>
      {status === "pending" && !own && (
        <span className="dm-baby-invite-actions">
          <button type="button" className="secondary" disabled={decline.isPending || accept.isPending} onClick={() => decline.mutate()}>Not now</button>
          <button type="button" disabled={accept.isPending || decline.isPending} onClick={() => accept.mutate()}>Welcome {invite.name}</button>
        </span>
      )}
      {status === "active" && onOpen && (
        <button type="button" className="dm-baby-invite-open" onClick={onOpen}>Open <ChevronRight size={15} /></button>
      )}
    </div>
  );
}

/** Small card for chat info: your child at a glance. */
export function BabyCard({ peer, onOpen }: { peer: Peer; onOpen: () => void }) {
  const state = useBaby(peer.id);
  const baby = state.data?.baby;
  if (state.isPending) return null;
  const gender = (baby?.gender ?? "girl") as Gender;
  return (
    <button type="button" className="dm-baby-card" onClick={onOpen}>
      <span className="dm-baby-card-art">
        {baby?.status === "active" ? (
          <Art src={childArt(gender, baby.stage, baby.outfit)} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
        ) : (
          <Art src="/baby/stork.webp" emoji="🕊️" />
        )}
      </span>
      <span className="dm-set-text">
        <strong>{baby?.status === "active" ? baby.name : baby ? "A baby is on the way" : "Have a baby together"}</strong>
        <small>
          {baby?.status === "active"
            ? `${baby.stageName} · ${baby.ageDays} ${baby.ageDays === 1 ? "day" : "days"} · ${moodLabel(baby)}`
            : baby ? `Waiting for an answer · ${baby.name}` : "Raise a little one by talking, feeding and playing"}
        </small>
      </span>
      <ChevronRight size={18} className="dm-set-chevron" aria-hidden="true" />
    </button>
  );
}

type BubbleSpot = { side: "left" | "right"; y: number };
const SPOT_KEY = "circle-baby-bubble:";
function savedSpot(peerId: string): BubbleSpot {
  try {
    const spot = JSON.parse(localStorage.getItem(SPOT_KEY + peerId) ?? "null") as BubbleSpot | null;
    if (spot && (spot.side === "left" || spot.side === "right") && spot.y >= 0 && spot.y <= 1) return spot;
  } catch {
    /* storage unavailable */
  }
  return { side: "right", y: 0.62 };
}
/** The little character: a full-body sticker with a name tag under it. */
const FLOAT_W = 76;
const FLOAT_H = 112;
const EDGE = 8;

/**
 * Your child stands over the chat like a little sticker pet: drag it anywhere and it hops to the
 * nearest side. Tap it to open the baby screen. The spot is remembered per chat.
 */
export function BabyBubble({ peer, onOpen }: { peer: Peer; onOpen: () => void }) {
  const state = useBaby(peer.id);
  const baby = state.data?.baby;
  const [spot, setSpot] = useState<BubbleSpot>(() => (typeof window === "undefined" ? { side: "right", y: 0.62 } : savedSpot(peer.id)));
  /** While dragging: position, and a tilt that follows the movement like the child is swinging. */
  const [drag, setDrag] = useState<{ x: number; y: number; tilt: number } | null>(null);
  const [landed, setLanded] = useState(0);
  const press = useRef<{ id: number; x: number; y: number; dx: number; dy: number; moved: boolean; lastX: number } | null>(null);
  const self = useRef<HTMLButtonElement>(null);
  const seen = useSeen(baby?.id);
  const now = useNow(60_000);
  if (baby?.status !== "active") return null;
  const gender = baby.gender as Gender;
  const night = baby.asleep;
  const pose = childPose(baby, gender);
  const badge = moodBadge(baby, monthsOld(baby.bornAt, now).birthday);
  /** Something new to tell (a new word, growing up…) until the baby screen is opened. */
  const news = unseenMoment(baby, seen, now);
  /** The area the character may use: below the header, above the composer. */
  const bounds = () => {
    const area = self.current?.parentElement;
    const rect = area?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const head = (area?.querySelector(".dm-thread-head")?.getBoundingClientRect().height ?? 64)
      + (area?.querySelector(".dm-gamebar")?.getBoundingClientRect().height ?? 0);
    const foot = area?.querySelector(".tg-composer, .dm-request, .dm-blocked-state")?.getBoundingClientRect().height ?? 72;
    return { rect, top: head + EDGE, bottom: rect.height - foot - FLOAT_H - EDGE };
  };
  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: e.clientX - box.left, dy: e.clientY - box.top, moved: false, lastX: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    if (!p.moved) haptic("tap");
    p.moved = true;
    const { rect, top, bottom } = bounds();
    const tilt = Math.max(-18, Math.min(18, (e.clientX - p.lastX) * 1.6));
    p.lastX = e.clientX;
    setDrag((d) => ({
      x: Math.min(rect.width - FLOAT_W, Math.max(0, e.clientX - rect.left - p.dx)),
      y: Math.min(Math.max(bottom, top), Math.max(top, e.clientY - rect.top - p.dy)),
      // Ease the swing so it doesn't jitter.
      tilt: (d?.tilt ?? 0) * 0.6 + tilt * 0.4,
    }));
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved) {
      haptic("tap");
      // With news, the baby screen does the talking.
      if (!news) {
        playBabySound(night ? "snore" : baby.mood === "happy" ? "coo" : baby.mood === "hungry" ? "whine" : baby.mood === "sick" ? "cough"
          : baby.mood === "sleepy" ? "yawn" : "cry", baby.stage);
      }
      onOpen();
      return;
    }
    const { rect, top, bottom } = bounds();
    const current = drag ?? { x: 0, y: top };
    const next: BubbleSpot = {
      side: current.x + FLOAT_W / 2 < rect.width / 2 ? "left" : "right",
      y: bottom > top ? Math.min(1, Math.max(0, (current.y - top) / (bottom - top))) : 0,
    };
    setSpot(next);
    setDrag(null);
    setLanded((n) => n + 1);
    try {
      localStorage.setItem(SPOT_KEY + peer.id, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const style = (drag
    ? { left: drag.x, top: drag.y, "--tilt": `${drag.tilt}deg` }
    : { [spot.side]: EDGE, top: `calc(var(--bubble-top, 72px) + (100% - var(--bubble-top, 72px) - var(--bubble-bottom, 192px)) * ${spot.y})` }) as CSSProperties;
  return (
    <button
      ref={self}
      type="button"
      className={`dm-pet stage-${baby.stage} ${drag ? "dragging" : ""} ${baby.mood} ${night ? "night" : ""} side-${spot.side}`}
      style={style}
      aria-label={`${baby.name}: ${moodLabel(baby).toLowerCase()}${news ? `, says ${momentLine(news)}` : ""}. Drag to move, tap to open.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => { press.current = null; setDrag(null); }}
    >
      <span className="dm-pet-shadow" aria-hidden="true" />
      <span key={landed} className={`dm-pet-body ${landed ? "landed" : ""}`}>
        <Art className="dm-pet-figure" src={pose.src} fallback={pose.fallback} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
      </span>
      {news && !drag ? (
        <span className="dm-pet-say" aria-hidden="true">{momentLine(news)}</span>
      ) : badge ? (
        <span className="dm-pet-badge" aria-hidden="true">{badge}</span>
      ) : (
        <span className="dm-pet-heart" aria-hidden="true">💗</span>
      )}
      <span className="dm-pet-name">{baby.name}</span>
    </button>
  );
}
