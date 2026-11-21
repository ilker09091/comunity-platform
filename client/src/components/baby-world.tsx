"use client";
/**
 * The baby's little world: five places (bedroom, kitchen, bathroom, garden, park) drawn as wide
 * panoramas with a parallax foreground. Tap the floor and the child walks there with the camera
 * following; tap things to use them (bed, wardrobe, toy box, high chair, fridge, tub, swing, ball,
 * slide, pond, ice-cream stand, sky). Both parents see where the other one is and can send
 * hearts, waves, kisses and stars that float up on the other phone.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { playBabySound } from "@/lib/baby-sounds";
import { playSfx, setAmbience, type Ambience, type Sfx } from "@/lib/baby-sfx";
import { Avatar } from "./ui";

export type Scene = "nursery" | "kitchen" | "bathroom" | "garden" | "park";
export const SCENES: { id: Scene; name: string; emoji: string; outdoor: boolean }[] = [
  { id: "nursery", name: "Room", emoji: "🧸", outdoor: false },
  { id: "kitchen", name: "Kitchen", emoji: "🍳", outdoor: false },
  { id: "bathroom", name: "Bath", emoji: "🛁", outdoor: false },
  { id: "garden", name: "Garden", emoji: "🌷", outdoor: true },
  { id: "park", name: "Park", emoji: "🎡", outdoor: true },
];
type Signal = Models["BabySignalDto"]["kind"];
const SIGNAL_EMOJI: Record<Signal, string> = { heart: "💗", wave: "👋", kiss: "😘", star: "⭐" };

const W = "/baby/world";
/** Child height as a share of the scene height, per stage. */
const CHILD_H = [0.36, 0.43, 0.5, 0.55];
/** Where the child stands: distance from the bottom of the scene (share of its height). */
const FLOOR = 0.05;
/** Walking speed in scene-heights per second. */
const SPEED = 0.5;

/** A thing in a scene: center x (share of the scene width), bottom and height (share of the height). */
type Prop = { id: string; x: number; bottom: number; h: number; src?: string; z?: number };
const PROPS: Record<Scene, Prop[]> = {
  nursery: [
    { id: "wardrobe", x: 0.47, bottom: 0.33, h: 0.5, src: `${W}/nursery/wardrobe.webp` },
    { id: "bed", x: 0.17, bottom: 0.08, h: 0.42, src: `${W}/nursery/bed.webp`, z: 3 },
    { id: "lamp", x: 0.335, bottom: 0.1, h: 0.3, src: `${W}/nursery/lamp-off.webp`, z: 3 },
    { id: "toybox", x: 0.69, bottom: 0.08, h: 0.2, src: `${W}/nursery/toybox.webp`, z: 3 },
  ],
  kitchen: [
    { id: "fridge", x: 0.91, bottom: 0.36, h: 0.6 },
    { id: "highchair", x: 0.5, bottom: 0.08, h: 0.5, src: `${W}/kitchen/highchair.webp`, z: 3 },
  ],
  bathroom: [
    { id: "sink", x: 0.3, bottom: 0.4, h: 0.3 },
    { id: "tub", x: 0.6, bottom: 0.07, h: 0.34, src: `${W}/bathroom/tub.webp`, z: 3 },
    { id: "towel", x: 0.88, bottom: 0.08, h: 0.2, src: `${W}/bathroom/towel.webp`, z: 3 },
  ],
  garden: [
    { id: "swing", x: 0.34, bottom: 0.22, h: 0.56, src: `${W}/garden/swing-frame.webp` },
    { id: "sandbox", x: 0.6, bottom: 0.12, h: 0.16, src: `${W}/garden/sandbox.webp` },
    { id: "pot", x: 0.92, bottom: 0.08, h: 0.2, src: `${W}/garden/flower-pot.webp`, z: 3 },
  ],
  park: [
    { id: "kiosk", x: 0.14, bottom: 0.42, h: 0.42 },
    { id: "slide", x: 0.42, bottom: 0.3, h: 0.42, src: `${W}/park/slide.webp` },
    { id: "pond", x: 0.78, bottom: 0.42, h: 0.14 },
  ],
};
/** Where the child stops to use a thing. */
const USE_AT: Record<string, number> = {
  wardrobe: 0.47, bed: 0.3, lamp: 0.3, toybox: 0.62, fridge: 0.82, highchair: 0.5, sink: 0.3, tub: 0.6, towel: 0.82,
  swing: 0.34, sandbox: 0.6, pot: 0.86, kiosk: 0.2, slide: 0.3, pond: 0.72,
};
const AMBIENCE: Partial<Record<Scene, Ambience>> = { garden: "garden", park: "park", bathroom: "bath", kitchen: "kitchen" };
const startX = (scene: Scene) => (scene === "nursery" ? 0.55 : scene === "kitchen" ? 0.3 : scene === "bathroom" ? 0.4 : 0.5);

export type WorldMode = "walk" | "bath" | "bed" | "chair";
type Fun =
  | { kind: "swing"; key: number }
  | { kind: "slide"; key: number }
  | { kind: "ball"; key: number; to: number }
  | { kind: "bread"; key: number }
  | { kind: "kite"; key: number; x: number }
  | { kind: "brush"; key: number }
  | null;

/** Check-ins every few seconds while open: where the other parent is, and their signals. */
function useTogether(babyId: string, scene: Scene, onSignal: (kind: Signal) => void) {
  const [state, setState] = useState<{ here: boolean; scene: Scene | null }>({ here: false, scene: null });
  const cursor = useRef<number | undefined>(undefined);
  const sceneRef = useRef(scene);
  const signalRef = useRef(onSignal);
  useLayoutEffect(() => {
    sceneRef.current = scene;
    signalRef.current = onSignal;
  });
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const r = await api("babyHere", { params: { babyId }, body: { scene: sceneRef.current, since: cursor.current } });
          if (stopped) return;
          cursor.current = r.cursor;
          setState({ here: r.partnerHere, scene: (r.partnerScene as Scene | null) ?? null });
          r.signals.forEach((s, i) => window.setTimeout(() => signalRef.current(s.kind), i * 350));
        } catch {
          /* offline: try again next tick */
        }
      }
      if (!stopped) timer = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [babyId]);
  // Moving to another place is told right away.
  useEffect(() => {
    if (cursor.current === undefined) return;
    void api("babyHere", { params: { babyId }, body: { scene, since: cursor.current } }).then((r) => {
      cursor.current = r.cursor;
      setState({ here: r.partnerHere, scene: (r.partnerScene as Scene | null) ?? null });
    }).catch(() => undefined);
  }, [babyId, scene]);
  return state;
}

export function BabyWorld({
  baby, peer, scene, night, mode, child, childStage, bath, decor, overlay, fx,
  onScene, onBed, onWardrobe, onToys, onFeedSpot, onBath, onIceCream, onLeaveChair,
}: {
  baby: Models["BabyDto"];
  peer: Models["MessagePeerDto"];
  scene: Scene;
  night: boolean;
  mode: WorldMode;
  /** The tappable child (with its own reactions). */
  child: ReactNode;
  childStage: number;
  /** The bath game, shown in the tub. */
  bath?: ReactNode;
  /** Wall and floor decorations bought in the shop (bedroom only). */
  decor?: ReactNode;
  /** Name tag, coins and sound switch. */
  overlay?: ReactNode;
  /** Celebration effects; they follow the child. */
  fx?: ReactNode;
  onScene: (scene: Scene) => void;
  onBed: () => void;
  onWardrobe: () => void;
  onToys: () => void;
  onFeedSpot: () => void;
  onBath: () => void;
  onIceCream: () => void;
  onLeaveChair: () => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 400 });
  const [pos, setPos] = useState<{ x: number; dur: number; face: 1 | -1 }>({ x: startX(scene), dur: 0, face: 1 });
  const [walking, setWalking] = useState(false);
  const [fun, setFun] = useState<Fun>(null);
  const [fading, setFading] = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [fridgeOpen, setFridgeOpen] = useState(false);
  const [lampOn, setLampOn] = useState(false);
  const [ballX, setBallX] = useState(0.78);
  const [puppy, setPuppy] = useState<{ x: number; state: "idle" | "run" | "happy"; face: 1 | -1 }>({ x: 0.66, state: "idle", face: -1 });
  const [rain, setRain] = useState<{ emoji: string; key: number; mine: boolean }[]>([]);
  const arrive = useRef(0);
  /** Keys that restart animations (a counter, so nothing impure runs while rendering). */
  const seq = useRef(0);
  const nextKey = () => ++seq.current;
  const steps = useRef(0);
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); }, []);

  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const pending = timers.current;
    return () => {
      observer.disconnect();
      pending.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(arrive.current);
      window.clearInterval(steps.current);
    };
  }, []);

  // Sounds of the place, quieter at night.
  useEffect(() => {
    const amb = AMBIENCE[scene];
    const outdoorNight = night && (scene === "garden" || scene === "park");
    void setAmbience(mode === "bath" ? "bath" : outdoorNight ? null : amb ?? null, mode === "bath" ? 0.2 : 0.16);
  }, [scene, night, mode]);
  useEffect(() => () => void setAmbience(null), []);

  const together = useTogether(baby.id, scene, (kind) => {
    setRain((r) => [...r.slice(-8), { emoji: SIGNAL_EMOJI[kind], key: nextKey(), mine: false }]);
    haptic("success");
    void playSfx(kind === "kiss" ? "pop" : kind === "star" ? "sparkle" : "pop", { volume: 0.6 });
    if (kind === "kiss") playBabySound("kiss", childStage);
  });
  const send = (kind: Signal) => {
    haptic("tap");
    setRain((r) => [...r.slice(-8), { emoji: SIGNAL_EMOJI[kind], key: nextKey(), mine: true }]);
    void playSfx("pop", { volume: 0.4 });
    void api("babySignal", { params: { babyId: baby.id }, body: { kind } }).catch(() => undefined);
  };

  const S = size.h * 2; // panorama width
  const cam = Math.max(0, Math.min(S - size.w, pos.x * S - size.w / 2));
  const outdoor = scene === "garden" || scene === "park";

  /** Walks to `x` (share of the scene width), then runs `then`. */
  const walkTo = (x: number, then?: () => void) => {
    if (mode !== "walk") return;
    const target = Math.max(0.06, Math.min(0.94, x));
    const dist = Math.abs(target - pos.x) * 2; // in scene heights
    const dur = dist / SPEED;
    window.clearTimeout(arrive.current);
    window.clearInterval(steps.current);
    setFun((f) => (f?.kind === "ball" || f?.kind === "kite" ? f : null));
    if (dur < 0.08) { then?.(); return; }
    setPos({ x: target, dur, face: target >= pos.x ? 1 : -1 });
    setWalking(true);
    const stepSound: Sfx = outdoor ? "step-grass" : "step";
    steps.current = window.setInterval(() => void playSfx(stepSound, { volume: 0.25, pitch: 1.15 }), 300);
    // The puppy trots after the child outdoors.
    if (scene === "garden") setPuppy((p) => ({ x: target + (target >= p.x ? -0.07 : 0.07), state: "run", face: target >= p.x ? 1 : -1 }));
    arrive.current = window.setTimeout(() => {
      window.clearInterval(steps.current);
      setWalking(false);
      if (scene === "garden") setPuppy((p) => ({ ...p, state: "idle" }));
      then?.();
    }, dur * 1000);
  };

  const go = (next: Scene) => {
    if (next === scene) return;
    haptic("tap");
    void playSfx(SCENES.find((s) => s.id === next)?.outdoor ? "open" : "whoosh", { volume: 0.4 });
    setFading(true);
    later(() => {
      window.clearTimeout(arrive.current);
      window.clearInterval(steps.current);
      setWalking(false);
      setFun(null);
      setWardrobeOpen(false);
      setFridgeOpen(false);
      setPos({ x: startX(next), dur: 0, face: 1 });
      onScene(next);
      later(() => setFading(false), 60);
    }, 260);
  };

  /** Taps on the scene itself: the floor walks there, the sky flies a kite. */
  const onSceneTap = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (mode === "chair") { onLeaveChair(); return; }
    if (mode !== "walk") return;
    if (scene === "park" && y < 0.32) {
      haptic("tap");
      setFun({ kind: "kite", key: nextKey(), x });
      void playSfx("whoosh", { volume: 0.35 });
      playBabySound("giggle", childStage);
      return;
    }
    if (y > 0.6) walkTo(x);
  };

  const tapProp = (id: string) => {
    if (mode === "chair" && id !== "highchair") { onLeaveChair(); return; }
    if (mode !== "walk" && !(mode === "bed" && id === "bed")) return;
    haptic("tap");
    const at = USE_AT[id] ?? pos.x;
    const act = () => {
      switch (id) {
        case "bed": onBed(); break;
        case "wardrobe":
          setWardrobeOpen(true);
          void playSfx("open", { volume: 0.45 });
          onWardrobe();
          later(() => setWardrobeOpen(false), 5000);
          break;
        case "toybox": void playSfx("pop", { volume: 0.5 }); onToys(); break;
        case "lamp": setLampOn((v) => !v); void playSfx("toggle", { volume: 0.5 }); break;
        case "fridge":
          setFridgeOpen(true);
          void playSfx("open", { volume: 0.45 });
          later(() => setFridgeOpen(false), 4500);
          onFeedSpot();
          break;
        case "highchair": onFeedSpot(); break;
        case "tub": onBath(); break;
        case "sink":
          setFun({ kind: "brush", key: nextKey() });
          void playSfx("scrub", { volume: 0.5 });
          later(() => void playSfx("scrub", { volume: 0.5 }), 450);
          later(() => playBabySound("giggle", childStage), 900);
          later(() => setFun(null), 2200);
          break;
        case "towel": void playSfx("pop", { volume: 0.4 }); playBabySound("coo", childStage); break;
        case "swing":
          setFun({ kind: "swing", key: nextKey() });
          void playSfx("whoosh", { volume: 0.3 });
          later(() => playBabySound("giggle", childStage), 600);
          later(() => playBabySound("tickle", childStage), 2600);
          break;
        case "sandbox": void playSfx("scrub", { volume: 0.4 }); playBabySound("coo", childStage); break;
        case "pot": void playSfx("sparkle", { volume: 0.4 }); playBabySound("coo", childStage); break;
        case "slide":
          setFun({ kind: "slide", key: nextKey() });
          later(() => void playSfx("whoosh", { volume: 0.45 }), 1300);
          later(() => playBabySound("tickle", childStage), 1500);
          later(() => setFun(null), 2900);
          break;
        case "pond":
          setFun({ kind: "bread", key: nextKey() });
          later(() => void playSfx("splash", { volume: 0.3 }), 800);
          later(() => void playSfx("duck", { volume: 0.55 }), 1300);
          later(() => playBabySound("giggle", childStage), 1700);
          later(() => setFun(null), 4200);
          break;
        case "kiosk": onIceCream(); break;
      }
    };
    walkTo(at, act);
  };

  const kickBall = () => {
    if (mode !== "walk") return;
    const from = ballX;
    walkTo(from - 0.04 * (pos.x <= from ? 1 : -1), () => {
      const to = Math.max(0.12, Math.min(0.9, from + (pos.x <= from ? 1 : -1) * (0.15 + Math.random() * 0.15)));
      haptic("tap");
      void playSfx("bong", { volume: 0.35 });
      setFun({ kind: "ball", key: nextKey(), to });
      setBallX(to);
      playBabySound("giggle", childStage);
      // The puppy chases it and brings joy.
      setPuppy({ x: to - 0.05, state: "run", face: to >= puppy.x ? 1 : -1 });
      later(() => setPuppy((p) => ({ ...p, state: "happy" })), 1100);
      later(() => setPuppy((p) => ({ ...p, state: "idle" })), 2600);
    });
  };

  const childH = size.h * CHILD_H[Math.min(3, Math.max(0, childStage - 1))];
  const childW = (childH * 600) / 720;
  const swinging = fun?.kind === "swing" && mode === "walk";
  const sliding = fun?.kind === "slide" && mode === "walk";
  const prop = (id: string) => PROPS[scene].find((p) => p.id === id)!;
  const box = (p: Prop): CSSProperties => ({ left: `${p.x * 100}%`, bottom: `${p.bottom * 100}%`, height: `${p.h * 100}%`, zIndex: p.z ?? 1 });
  const bg = scene === "nursery" && baby.decor.room
    ? `${W}/scene/nursery/bg-${baby.decor.room.replace("room-", "")}-${night ? "night" : "day"}.webp`
    : `${W}/scene/${scene}/bg-${night ? "night" : "day"}.webp`;
  const partnerName = peer.displayName.split(" ")[0];
  const partnerSceneName = SCENES.find((s) => s.id === together.scene)?.name.toLowerCase();

  return (
    <div className="w-world">
      <div
        ref={view}
        className={`w-view ${night ? "night" : "day"} ${fading ? "fading" : ""} scene-${scene}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--px", String(((e.clientX - r.left) / r.width - 0.5) * 2));
        }}
      >
        <div
          className="w-scene"
          style={{ width: S, transform: `translate3d(${-cam}px,0,0)`, transition: `transform ${pos.dur}s linear` }}
          onClick={onSceneTap}
        >
          <img className="w-bg" src={bg} alt="" draggable={false} />
          {night && lampOn && scene === "nursery" && <span className="w-lamp-glow" style={{ left: `${prop("lamp").x * 100}%` }} />}

          {/* Props */}
          {PROPS[scene].map((p) => {
            const src = p.id === "lamp" ? `${W}/nursery/lamp-${lampOn || (night && baby.asleep) ? "on" : "off"}.webp`
              : p.id === "wardrobe" && wardrobeOpen ? `${W}/nursery/wardrobe-open.webp` : p.src;
            return (
              <button key={p.id} type="button" className={`w-prop ${p.id} ${src ? "" : "hotspot"}`} style={box(p)} onClick={() => tapProp(p.id)} aria-label={p.id}>
                {src && <img src={src} alt="" draggable={false} />}
              </button>
            );
          })}
          {scene === "kitchen" && fridgeOpen && (
            <img className="w-fridge-open" src={`${W}/kitchen/fridge-open.webp`} alt="" style={box(prop("fridge"))} />
          )}
          {scene === "nursery" && decor}

          {/* Garden life: the swing seat, ball, butterflies and the puppy */}
          {scene === "garden" && (
            <>
              <span className={`w-swing-seat ${swinging ? "go" : ""}`} key={swinging ? fun.key : "rest"} style={{ left: `${prop("swing").x * 100}%`, bottom: `${(prop("swing").bottom + prop("swing").h * 0.1) * 100}%`, height: `${prop("swing").h * 0.76 * 100}%` }}>
                <img src={`${W}/garden/swing-seat.webp`} alt="" draggable={false} />
                {swinging && <span className="w-on-swing" style={{ height: childH * 0.92, width: childW * 0.92 }}>{child}</span>}
              </span>
              <button type="button" className={`w-ball ${fun?.kind === "ball" ? "rolling" : ""}`} key={fun?.kind === "ball" ? fun.key : "ball"} style={{ left: `${ballX * 100}%` }} onClick={kickBall} aria-label="Kick the ball">
                <img src={`${W}/garden/ball.webp`} alt="" draggable={false} />
              </button>
              {[0, 1].map((i) => (
                <button key={i} type="button" className={`w-butterfly b${i}`} onClick={(e) => {
                  e.currentTarget.classList.remove("shoo");
                  void e.currentTarget.offsetWidth;
                  e.currentTarget.classList.add("shoo");
                  void playSfx("sparkle", { volume: 0.45 });
                  playBabySound("coo", childStage);
                }} aria-label="Butterfly">
                  <img src={`${W}/garden/butterfly-1.webp`} alt="" draggable={false} />
                  <img src={`${W}/garden/butterfly-2.webp`} alt="" draggable={false} />
                </button>
              ))}
              <button
                type="button"
                className={`w-puppy ${puppy.state}`}
                style={{ left: `${puppy.x * 100}%`, transition: `left ${puppy.state === "run" ? 1.1 : 0}s ease-out`, "--face": puppy.face } as CSSProperties}
                onClick={() => {
                  haptic("tap");
                  setPuppy((p) => ({ ...p, state: "happy" }));
                  void playSfx("pop", { volume: 0.5 });
                  playBabySound("giggle", childStage);
                  later(() => setPuppy((p) => ({ ...p, state: "idle" })), 1500);
                }}
                aria-label="Puppy"
              >
                <img src={`${W}/garden/puppy-${puppy.state === "run" ? "run-1" : puppy.state === "happy" ? "happy" : "idle"}.webp`} alt="" draggable={false} />
                {puppy.state === "run" && <img className="alt" src={`${W}/garden/puppy-run-2.webp`} alt="" draggable={false} />}
              </button>
            </>
          )}

          {/* Park life: ducks on the pond, bread, a kite in the sky */}
          {scene === "park" && (
            <>
              <span className={`w-duck ${fun?.kind === "bread" ? "eat" : ""}`} key={fun?.kind === "bread" ? fun.key : "duck"}>
                <img src={`${W}/park/${fun?.kind === "bread" ? "duck-2" : "duck-1"}.webp`} alt="" draggable={false} />
              </span>
              {fun?.kind === "bread" && <img key={`b${fun.key}`} className="w-bread" src={`${W}/park/bread.webp`} alt="" />}
              {fun?.kind === "kite" && (
                <span key={fun.key} className="w-kite" style={{ left: `${Math.min(0.9, Math.max(0.2, fun.x)) * 100}%` }}>
                  <img src={`${W}/park/kite.webp`} alt="" draggable={false} />
                </span>
              )}
              <img className="w-balloon" src={`${W}/park/balloon.webp`} alt="" draggable={false} />
            </>
          )}

          {/* The bath */}
          {scene === "bathroom" && mode === "bath" && (
            <div className="w-bath" style={{ left: `${prop("tub").x * 100}%`, bottom: `${prop("tub").bottom * 100}%`, height: `${prop("tub").h * 2.2 * 100}%` }}>
              {bath}
              <img className="w-tub-front" src={`${W}/bathroom/tub.webp`} alt="" draggable={false} />
            </div>
          )}
          {scene === "bathroom" && <img className="w-duck-toy" src={`${W}/bathroom/duck.webp`} alt="" draggable={false} onClick={() => { void playBabySound("squeak", childStage); haptic("tap"); }} />}
          {scene === "bathroom" && fun?.kind === "brush" && (
            <span className="w-brush" style={{ left: `${prop("sink").x * 100}%` }} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => <img key={i} src={`${W}/bathroom/bubble.webp`} alt="" style={{ "--i": i } as CSSProperties} />)}
            </span>
          )}

          {/* Asleep in bed */}
          {scene === "nursery" && mode === "bed" && (
            <div className="w-in-bed" style={{ left: `${prop("bed").x * 100}%`, bottom: `${prop("bed").bottom * 100}%`, height: `${prop("bed").h * 100}%` }}>
              <span className="w-bed-child" style={{ height: childH * 0.9, width: childW * 0.9 }}>{child}</span>
              <img className="w-blanket" src={`${W}/nursery/bed-blanket.webp`} alt="" draggable={false} />
            </div>
          )}

          {/* In the high chair */}
          {scene === "kitchen" && mode === "chair" && (
            <div className="w-in-chair" style={{ left: `${prop("highchair").x * 100}%`, bottom: `${prop("highchair").bottom * 100}%`, height: `${prop("highchair").h * 100}%` }}>
              <span className="w-chair-child" style={{ height: childH * 0.95, width: childW * 0.95 }}>{child}</span>
              <img className="w-tray" src={`${W}/kitchen/highchair.webp`} alt="" draggable={false} />
              <img className="w-plate" src={`${W}/kitchen/plate.webp`} alt="" draggable={false} />
              {fx}
            </div>
          )}

          {/* Walking around */}
          {mode === "walk" && !swinging && (
            <div
              className={`w-walker ${walking ? "walking" : ""} ${sliding ? "sliding" : ""}`}
              key={sliding ? fun.key : "walker"}
              style={{
                left: `${(sliding ? prop("slide").x : pos.x) * 100}%`,
                bottom: `${FLOOR * 100}%`,
                width: childW,
                height: childH,
                transition: `left ${pos.dur}s linear`,
                "--face": pos.face,
              } as CSSProperties}
            >
              <span className="w-shadow" aria-hidden="true" />
              {child}
              {fx}
            </div>
          )}

          {/* The other parent is in the same place: their face floats nearby */}
          {together.here && together.scene === scene && (
            <span className="w-partner" style={{ left: `${Math.min(0.92, Math.max(0.08, pos.x + (pos.x > 0.5 ? -0.16 : 0.16))) * 100}%` }} aria-label={`${partnerName} is here`}>
              <Avatar user={peer} size={38} />
              <i>💗</i>
            </span>
          )}

          {/* Foreground frame for depth */}
          <img className="w-fg" src={`${W}/scene/${scene}/fg.webp`} alt="" draggable={false} />
        </div>

        {/* Signals floating up */}
        <span className="w-rain" aria-hidden="true">
          {rain.map((r) => (
            <i key={r.key} className={r.mine ? "mine" : ""} style={{ "--x": `${(r.key * 37) % 70 + 15}%` } as CSSProperties}
              onAnimationEnd={() => setRain((list) => list.filter((x) => x.key !== r.key))}>{r.emoji}</i>
          ))}
        </span>

        <div className="w-together">
          <span className={`w-together-who ${together.here ? "here" : ""}`}>
            <Avatar user={peer} size={22} />
            <span>{together.here ? `${partnerName} · ${partnerSceneName ?? "here"}` : `${partnerName} is away`}</span>
          </span>
          <span className="w-signals">
            {(Object.keys(SIGNAL_EMOJI) as Signal[]).map((k) => (
              <button key={k} type="button" onClick={() => send(k)} aria-label={`Send ${partnerName} a ${k}`}>{SIGNAL_EMOJI[k]}</button>
            ))}
          </span>
        </div>
        {overlay}
      </div>

      <nav className="w-places" aria-label="Places">
        {SCENES.map((s) => (
          <button key={s.id} type="button" className={s.id === scene ? "active" : ""} aria-current={s.id === scene} onClick={() => go(s.id)} disabled={mode === "bath" || (mode === "bed" && s.id !== "nursery")}>
            <span aria-hidden="true">{s.emoji}</span>
            <small>{s.name}</small>
            {together.here && together.scene === s.id && <Avatar user={peer} size={16} />}
          </button>
        ))}
      </nav>
    </div>
  );
}
