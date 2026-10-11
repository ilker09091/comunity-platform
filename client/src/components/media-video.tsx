"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject, type VideoHTMLAttributes } from "react";

/** Keep API-issued URLs intact: their query strings contain a media signature. */
export function useVideoSource(ref: RefObject<HTMLVideoElement | null>, source?: string) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React may retain the DOM node through Strict Mode's setup/cleanup replay.
    // Setup must restore anything cleanup released, even when the prop is unchanged.
    if (source && video.getAttribute("src") !== source) {
      video.setAttribute("src", source);
      video.load();
    }
    return () => {
      video.pause();
      // React may already have removed the attribute before effect cleanup. Explicitly
      // load the empty source to cancel the previous request and release its decoder.
      if (source || video.hasAttribute("src")) { video.removeAttribute("src"); video.load(); }
    };
  }, [ref, source]);
}

/** Deliberately exclude error.message, currentSrc and URLs from diagnostics. */
export function videoDiagnostic(video: HTMLVideoElement, event: string, rejection?: unknown) {
  if (process.env.NODE_ENV === "production") return;
  const name = rejection instanceof Error ? rejection.name : undefined;
  console.debug("[Circle video]", {
    event,
    code: video.error?.code ?? null,
    readyState: video.readyState,
    networkState: video.networkState,
    ...(name && ["AbortError", "NotAllowedError", "NotSupportedError"].includes(name) ? { rejection: name } : {}),
  });
}

export const MediaVideo = forwardRef<HTMLVideoElement, Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { src?: string }>(
  function MediaVideo({ src, ...props }, forwardedRef) {
    const ref = useRef<HTMLVideoElement>(null);
    useImperativeHandle(forwardedRef, () => ref.current!, []);
    useVideoSource(ref, src);
    return <video {...props} src={src} ref={ref} />;
  },
);
