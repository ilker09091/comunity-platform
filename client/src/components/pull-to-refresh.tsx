"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { haptic } from "@/lib/haptics";

const THRESHOLD = 70; // px to trigger
const MAX_PULL = 110; // px max visual pull
const RESIST = 0.5; // resistance factor

export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const triggered = useRef(false);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (window.scrollY > 2) return;
      startY.current = e.touches[0].clientY;
      triggered.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) { setPull(0); return; }
      e.preventDefault();
      const resisted = Math.min(MAX_PULL, delta * RESIST);
      setPull(resisted);
      if (!triggered.current && resisted >= THRESHOLD) { triggered.current = true; haptic("tap"); }
    };
    const onEnd = async () => {
      if (startY.current === null) return;
      startY.current = null;
      if (triggered.current) {
        setRefreshing(true);
        setPull(THRESHOLD);
        try { await onRefresh(); } finally {
          setRefreshing(false); setPull(0); triggered.current = false;
        }
      } else { setPull(0); }
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
  return (
    <div ref={container} className="ptr-root">
      <div className="ptr-indicator" style={{ height: `${pull}px`, opacity: pull / THRESHOLD }} aria-hidden={!pull}>
        {refreshing ? <Loader2 size={22} className="spin" /> : (
          <ArrowDown size={22} style={{ transform: `rotate(${pull >= THRESHOLD ? 180 : 0}deg)`, transition: "transform 180ms ease" }} />
        )}
      </div>
      <div className="ptr-content" style={{ transform: `translateY(${pull}px)`, transition: startY.current === null ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined }}>
        {children}
      </div>
    </div>
  );
}
