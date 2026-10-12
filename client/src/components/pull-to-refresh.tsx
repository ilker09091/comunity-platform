"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { haptic } from "@/lib/haptics";

const THRESHOLD = 70; // px to trigger
const MAX_PULL = 110; // px max visual pull
const RESIST = 0.5; // resistance factor
const SLOP = 6; // px of downward movement before the gesture is treated as a pull

/**
 * Pull-to-refresh for feeds. While mounted, the browser's own pull-to-refresh (Chrome Android,
 * iOS Safari) is switched off so the two never fire together and reload the whole page.
 */
export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const previous = targets.map((t) => t.style.overscrollBehaviorY);
    for (const t of targets) t.style.overscrollBehaviorY = "none";
    return () => targets.forEach((t, i) => (t.style.overscrollBehaviorY = previous[i]));
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const reset = () => {
      startY.current = null;
      pulling.current = false;
      setDragging(false);
    };
    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length > 1 || window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = false;
      triggered.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      // The page scrolled or the finger moved up: this is a normal scroll, never block it.
      if (window.scrollY > 0 || (!pulling.current && delta < SLOP)) {
        if (window.scrollY > 0 || delta < 0) reset();
        return;
      }
      if (!pulling.current) {
        pulling.current = true;
        setDragging(true);
      }
      if (e.cancelable) e.preventDefault();
      const resisted = Math.min(MAX_PULL, Math.max(0, delta - SLOP) * RESIST);
      setPull(resisted);
      if (!triggered.current && resisted >= THRESHOLD) {
        triggered.current = true;
        haptic("tap");
      }
    };
    const onEnd = async () => {
      if (startY.current === null) return;
      const wasPulling = pulling.current;
      reset();
      if (wasPulling && triggered.current) {
        setRefreshing(true);
        setPull(THRESHOLD * 0.8);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPull(0);
          triggered.current = false;
        }
      } else setPull(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh, refreshing]);

  const ready = pull >= THRESHOLD;
  return (
    <div ref={container} className="ptr-root">
      <div className="ptr-indicator" style={{ height: `${pull}px`, opacity: Math.min(1, pull / THRESHOLD) }} aria-hidden={!pull && !refreshing}>
        {refreshing ? (
          <Loader2 size={22} className="spin" aria-label="Refreshing" />
        ) : (
          <ArrowDown size={22} style={{ transform: `rotate(${ready ? 180 : 0}deg)`, transition: "transform 180ms ease" }} />
        )}
      </div>
      <div
        className="ptr-content"
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: dragging ? undefined : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
