"use client";
import { useEffect, useRef } from "react";

const FORWARD_FLAG = "__doubleTapForwarded";

/**
 * Returns an `onClickCapture` handler for a wrapping element. A single click
 * is forwarded after a short delay; a second click within the delay cancels
 * the forward and fires `onDoubleTap` instead. This lets double-tap-to-like
 * work without first pausing the underlying video player on the single click.
 */
export function useDoubleTap(onDoubleTap: () => void, delayMs = 280) {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  return (event: React.MouseEvent<HTMLElement>) => {
    const native = event.nativeEvent as MouseEvent & { [FORWARD_FLAG]?: boolean };
    if (native[FORWARD_FLAG]) return; // our own re-dispatch — let it through
    const target = event.target as HTMLElement;
    // Let interactive controls (buttons, inputs, links) handle their own clicks.
    if (target.closest("[data-player-controls], input, a, .video-controls")) return;
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
      event.stopPropagation();
      event.preventDefault();
      onDoubleTap();
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const forwardTarget = target;
    pending.current = setTimeout(() => {
      pending.current = null;
      const forwarded = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window });
      (forwarded as MouseEvent & { [FORWARD_FLAG]?: boolean })[FORWARD_FLAG] = true;
      forwardTarget.dispatchEvent(forwarded);
    }, delayMs);
  };
}
