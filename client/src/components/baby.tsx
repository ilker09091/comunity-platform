"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Baby, ChevronRight, Shirt, ToyBrick, Utensils, Volume2, VolumeX } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { babySoundOn, playBabySound, setBabySoundOn, type BabySound } from "@/lib/baby-sounds";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Modal } from "./ui";

type BabyState = Models["BabyDto"];
type Invite = Models["BabyInviteDto"];
type Peer = Models["MessagePeerDto"];
type Gender = "girl" | "boy";

/*
 * Artwork lives in /public/baby (sliced from the sheets in /public/baby/raw). Until a file
 * exists, every picture falls back to an emoji, so the feature works before the art is ready.
 */
const FOODS = ["🍼", "🥣", "🍎", "🍌", "🍪", "🍕", "🍰", "🥕", "🍲", "🧃", "🍦", "🥪"];
const FOOD_NAMES = ["Milk", "Baby food", "Apple", "Banana", "Cookie", "Pizza", "Cake", "Carrot", "Soup", "Juice", "Ice cream", "Sandwich"];
/** Little babies only get baby food. */
const FOODS_BY_STAGE = [[0, 1, 2, 3], FOODS.map((_, i) => i), FOODS.map((_, i) => i), FOODS.map((_, i) => i)];
const TOYS = ["🧸", "🦆", "🧱", "⚽", "🪁", "📖"];
const TOY_NAMES = ["Teddy", "Duck", "Blocks", "Ball", "Kite", "Book"];
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

const childArt = (gender: Gender, stage: number, pose: number | "sleep" | "eat" | "sad") => `/baby/${gender}-${stage}-${pose}.webp`;

/** A picture that quietly becomes an emoji when its file is missing. */
function Art({ src, emoji, className, alt = "" }: { src: string; emoji: string; className?: string; alt?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <span className={`${className ?? ""} dm-baby-emoji`} role={alt ? "img" : undefined} aria-label={alt || undefined}>{emoji}</span>;
  return <img className={className} src={src} alt={alt} draggable={false} onError={() => setFailed(src)} />;
}

const isNight = (date = new Date()) => date.getHours() >= 22 || date.getHours() < 7;

export function useBaby(peerId: string, live = false) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["messages", user?.id, "baby", peerId],
    queryFn: ({ signal }) => api("messagesBaby", { params: { id: peerId }, signal }),
    staleTime: live ? 5_000 : 60_000,
    refetchInterval: live ? 20_000 : false,
  });
}

function Meter({ label, icon, value, tone }: { label: string; icon: string; value: number; tone: string }) {
  return (
    <div className="dm-baby-meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span aria-hidden="true">{icon}</span>
      <span className="dm-baby-meter-copy">
        <small>{label}</small>
        <span className="dm-baby-meter-bar"><i style={{ width: `${value}%`, background: tone }} /></span>
      </span>
      <b>{value}%</b>
    </div>
  );
}

type Picker = "feed" | "play" | "wardrobe" | null;
type Moment = { kind: "feed" | "play" | "dress" | "born"; emoji: string; key: number } | null;

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
  const [picker, setPicker] = useState<Picker>(null);
  const [moment, setMoment] = useState<Moment>(null);
  const [goodbye, setGoodbye] = useState(false);
  const [soundOn, setSoundOn] = useState(babySoundOn);
  /** Tapping the child: a wiggle (keyed so every tap replays it) and a sound. */
  const [poke, setPoke] = useState(0);
  const say = (sound: BabySound) => playBabySound(sound, baby?.stage ?? 1);
  // Opening the screen: a hungry or sad child cries for you, a happy one coos.
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || baby?.status !== "active") return;
    greeted.current = true;
    const timer = window.setTimeout(() => {
      playBabySound(isNight() ? "snore" : baby.mood === "hungry" ? "whine" : baby.mood === "sad" ? "cry" : "coo", baby.stage);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [baby?.status, baby?.mood, baby?.stage]);
  const put = (next: BabyState | null) => client.setQueryData<Models["BabyStateDto"]>(key, { baby: next });
  const celebrate = (kind: NonNullable<Moment>["kind"], emoji: string) => {
    haptic("success");
    setMoment({ kind, emoji, key: Date.now() });
  };
  const feed = useMutation({
    mutationFn: (item: number) => api("babyFeed", { params: { babyId: baby!.id }, body: { item } }),
    onSuccess: (next, item) => { put(next); setPicker(null); celebrate("feed", FOODS[item]); playBabySound("nom", next.stage); },
    onError: (e) => toast(e.message, true),
  });
  const play = useMutation({
    mutationFn: (item: number) => api("babyPlay", { params: { babyId: baby!.id }, body: { item } }),
    onSuccess: (next, item) => { put(next); setPicker(null); celebrate("play", TOYS[item]); playBabySound("giggle", next.stage); },
    onError: (e) => toast(e.message, true),
  });
  const dress = useMutation({
    mutationFn: (outfit: number) => api("babyOutfit", { params: { babyId: baby!.id }, body: { outfit } }),
    onMutate: (outfit) => { if (baby) put({ ...baby, outfit }); },
    onSuccess: (next) => {
      put(next);
      celebrate("dress", "✨");
      playBabySound("sparkle", next.stage);
      window.setTimeout(() => playBabySound("coo", next.stage), 380);
    },
    onError: (e) => { toast(e.message, true); void state.refetch(); },
  });
  const end = useMutation({
    mutationFn: () => api("babyEnd", { params: { babyId: baby!.id } }),
    onSuccess: () => { setGoodbye(false); put(null); toast("You said goodbye."); },
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

  const night = isNight();
  const gender = baby.gender as Gender;
  const moodPose = moment?.kind === "feed" ? "eat" : night ? "sleep" : baby.mood !== "happy" ? "sad" : baby.outfit;
  const progress = baby.nextStageXp ? Math.min(100, Math.round(((baby.xp - baby.stageXp) / (baby.nextStageXp - baby.stageXp)) * 100)) : 100;
  const feedsLeft = baby.limits.feeds - baby.mine.feeds;
  const playsLeft = baby.limits.plays - baby.mine.plays;
  const age = baby.ageDays === 0 ? "Born today" : `${baby.ageDays} ${baby.ageDays === 1 ? "day" : "days"} old`;
  const bubble = night ? "💤" : baby.mood === "hungry" ? "🍼" : baby.mood === "sad" ? "🥺" : null;
  const care = (who: "mine" | "theirs") => [
    { icon: "🍼", value: baby[who].feeds, max: baby.limits.feeds, label: "Fed" },
    { icon: "🧸", value: baby[who].plays, max: baby.limits.plays, label: "Played" },
    { icon: "💬", value: baby[who].chats, max: baby.limits.chats, label: "Talked" },
    { icon: "🎮", value: baby[who].games, max: baby.limits.games, label: "Games" },
  ];

  return (
    <Modal title={baby.name} className="dm-baby-sheet" onClose={onClose}>
      <div className="dm-baby">
        <div className={`dm-baby-room ${night ? "night" : "day"}`}>
          <Art className="dm-baby-room-art" src={`/baby/room-${night ? "night" : "day"}.webp`} emoji="" />
          <button
            type="button"
            key={`${moment?.key ?? 0}-${poke}`}
            className={`dm-baby-child stage-${baby.stage} ${moment ? `moment ${moment.kind}` : ""} ${poke && !moment ? "poked" : ""} ${baby.mood} ${night ? "sleeping" : ""}`}
            aria-label={`Tap ${baby.name}`}
            onClick={() => {
              haptic("tap");
              setMoment(null);
              setPoke((n) => n + 1);
              say(night ? "snore" : baby.mood === "hungry" ? "whine" : baby.mood === "sad" ? "cry" : "giggle");
            }}
          >
            <Art className="dm-baby-figure" src={childArt(gender, baby.stage, moodPose)} emoji={STAGE_EMOJI[gender][baby.stage - 1]} alt={baby.name} />
            {bubble && !moment && <span className="dm-baby-bubble" aria-hidden="true">{bubble}</span>}
            {poke > 0 && !moment && baby.mood === "happy" && !night && (
              <span className="dm-baby-giggle" aria-hidden="true">
                {[0, 1, 2].map((i) => <i key={i} style={{ "--i": i } as CSSProperties}>{i === 1 ? "💗" : "✨"}</i>)}
              </span>
            )}
          </button>
          <button
            type="button"
            className="dm-baby-mute"
            aria-label={soundOn ? "Mute baby sounds" : "Turn on baby sounds"}
            aria-pressed={!soundOn}
            onClick={() => {
              setBabySoundOn(!soundOn);
              setSoundOn(!soundOn);
              if (!soundOn) playBabySound("coo", baby.stage);
            }}
          >
            {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          {moment && (
            <span key={`m${moment.key}`} className={`dm-baby-moment ${moment.kind}`} aria-hidden="true">
              {moment.kind === "feed" ? (
                <Art className="dm-baby-moment-item" src={`/baby/food-${FOODS.indexOf(moment.emoji)}.webp`} emoji={moment.emoji} />
              ) : moment.kind === "play" ? (
                <Art className="dm-baby-moment-item" src={`/baby/toy-${TOYS.indexOf(moment.emoji)}.webp`} emoji={moment.emoji} />
              ) : null}
              {Array.from({ length: 6 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties}>{moment.kind === "dress" ? "✨" : "💗"}</i>)}
            </span>
          )}
          <div className="dm-baby-tag">
            <strong>{baby.name}</strong>
            <span>{age} · {baby.stageName}</span>
          </div>
        </div>

        <div className="dm-baby-growth">
          <div className="dm-baby-growth-head">
            <span>{baby.nextStageXp ? `Growing up · ${progress}%` : "All grown up 🎓"}</span>
            {baby.nextStageXp && <small>{(baby.nextStageXp - baby.xp).toLocaleString()} XP to go</small>}
          </div>
          <span className="dm-baby-growth-bar"><i style={{ width: `${progress}%` }} /></span>
        </div>

        <div className="dm-baby-meters">
          <Meter label="Tummy" icon="🍼" value={baby.fullness} tone="#fd7e14" />
          <Meter label="Happiness" icon="💗" value={baby.happiness} tone="#e64980" />
        </div>

        <div className="dm-baby-actions">
          <button type="button" className={picker === "feed" ? "active" : ""} disabled={feedsLeft <= 0} onClick={() => setPicker(picker === "feed" ? null : "feed")}>
            <Utensils size={20} />
            <span>Feed</span>
            <small>{feedsLeft > 0 ? `${feedsLeft} left today` : "Full for today"}</small>
          </button>
          <button type="button" className={picker === "play" ? "active" : ""} disabled={playsLeft <= 0 || night} onClick={() => setPicker(picker === "play" ? null : "play")}>
            <ToyBrick size={20} />
            <span>Play</span>
            <small>{night ? "Sleeping" : playsLeft > 0 ? `${playsLeft} left today` : "Tired for today"}</small>
          </button>
          <button type="button" className={picker === "wardrobe" ? "active" : ""} onClick={() => setPicker(picker === "wardrobe" ? null : "wardrobe")}>
            <Shirt size={20} />
            <span>Wardrobe</span>
            <small>{OUTFITS[gender][baby.stage - 1][baby.outfit]}</small>
          </button>
        </div>

        {picker === "feed" && (
          <div className="dm-baby-picker" role="group" aria-label="Choose food">
            {FOODS_BY_STAGE[baby.stage - 1].map((i) => (
              <button key={i} type="button" disabled={feed.isPending} onClick={() => feed.mutate(i)}>
                <Art src={`/baby/food-${i}.webp`} emoji={FOODS[i]} />
                <small>{FOOD_NAMES[i]}</small>
              </button>
            ))}
          </div>
        )}
        {picker === "play" && (
          <div className="dm-baby-picker" role="group" aria-label="Choose a toy">
            {TOYS.map((emoji, i) => (
              <button key={i} type="button" disabled={play.isPending} onClick={() => play.mutate(i)}>
                <Art src={`/baby/toy-${i}.webp`} emoji={emoji} />
                <small>{TOY_NAMES[i]}</small>
              </button>
            ))}
          </div>
        )}
        {picker === "wardrobe" && (
          <div className="dm-baby-picker wardrobe" role="radiogroup" aria-label="Outfits">
            {OUTFITS[gender][baby.stage - 1].map((name, i) => (
              <button key={i} type="button" role="radio" aria-checked={baby.outfit === i} className={baby.outfit === i ? "selected" : ""}
                disabled={dress.isPending} onClick={() => baby.outfit !== i && dress.mutate(i)}>
                <Art src={childArt(gender, baby.stage, i)} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
                <small>{name}</small>
              </button>
            ))}
          </div>
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
          {baby.name} grows when you talk, feed and play. Caring on the same day as {peerName} gives a bonus. Daily limits reset at midnight (UTC).
        </p>
        <button type="button" className="dm-baby-goodbye" onClick={() => setGoodbye(true)}>Say goodbye to {baby.name}</button>
      </div>
      {goodbye && (
        <ConfirmDialog
          title={`Say goodbye to ${baby.name}?`}
          description={`${baby.name} will leave for both of you, with all growth and outfits. This can't be undone.`}
          confirmLabel="Say goodbye"
          pending={end.isPending}
          onConfirm={() => end.mutate()}
          onClose={() => setGoodbye(false)}
        />
      )}
    </Modal>
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
            ? `${baby.stageName} · ${baby.ageDays} ${baby.ageDays === 1 ? "day" : "days"} · ${baby.mood === "happy" ? "Happy" : baby.mood === "hungry" ? "Hungry" : "Misses you"}`
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
  if (baby?.status !== "active") return null;
  const gender = baby.gender as Gender;
  const night = isNight();
  const pose = night ? "sleep" : baby.mood === "happy" ? baby.outfit : "sad";
  const badge = night ? "💤" : baby.mood === "hungry" ? "🍼" : baby.mood === "sad" ? "🥺" : null;
  /** The area the character may use: below the header, above the composer. */
  const bounds = () => {
    const area = self.current?.parentElement;
    const rect = area?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const head = area?.querySelector(".dm-thread-head")?.getBoundingClientRect().height ?? 64;
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
      playBabySound(night ? "snore" : baby.mood === "happy" ? "coo" : baby.mood === "hungry" ? "whine" : "cry", baby.stage);
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
      aria-label={`${baby.name}: ${night ? "sleeping" : baby.mood === "happy" ? "happy" : baby.mood === "hungry" ? "hungry" : "misses you"}. Drag to move, tap to open.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => { press.current = null; setDrag(null); }}
    >
      <span className="dm-pet-shadow" aria-hidden="true" />
      <span key={landed} className={`dm-pet-body ${landed ? "landed" : ""}`}>
        <Art className="dm-pet-figure" src={childArt(gender, baby.stage, pose)} emoji={STAGE_EMOJI[gender][baby.stage - 1]} />
      </span>
      {badge ? (
        <span className="dm-pet-badge" aria-hidden="true">{badge}</span>
      ) : (
        <span className="dm-pet-heart" aria-hidden="true">💗</span>
      )}
      <span className="dm-pet-name">{baby.name}</span>
    </button>
  );
}
