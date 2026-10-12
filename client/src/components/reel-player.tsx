"use client";
import type { Models } from "@/lib/api/client";
import VideoPlayerCore from "./video-player-core";
import { useCallback, useEffect, useRef } from 'react';
import { ReelWatchObserver, type PlaybackSignal } from '@/lib/reel-watch';
import { watchSender } from '@/lib/reel-watch-transport';
export type PreloadLevel = "auto" | "metadata" | "none";
export default function ReelPlayer(props: {
  media: Models["MediaDto"]; active: boolean; preload: PreloadLevel;
  label: string; onRefreshSource?: () => Promise<unknown>; onAspectRatio?: (ratio: number) => void;
  sessionId?: string; postId?: string; selected?: boolean;
}) {
  const observer = useRef<ReelWatchObserver | null>(null);
  const element = useRef<HTMLVideoElement | null>(null);
  const tracking = props.selected ?? props.active;
  useEffect(() => {
    if (!props.sessionId || !props.postId || !tracking) return;
    const tracker = new ReelWatchObserver(watchSender(props.sessionId, props.postId, props.media.id));
    observer.current = tracker;
    const visibility = () => { if (element.current) tracker.observe(document.hidden ? 'pause' : 'tick', element.current, performance.now(), !document.hidden); };
    const leave = () => tracker.finish();
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave);
    return () => { tracker.finish(); observer.current = null; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); };
  }, [props.sessionId, props.postId, props.media.id, tracking]);
  const onPlayback = useCallback((kind: PlaybackSignal, video: HTMLVideoElement) => {
    element.current = video; observer.current?.observe(kind, video, performance.now(), !document.hidden);
  }, []);
  return <VideoPlayerCore {...props} current={props.selected} onPlayback={onPlayback} mode="reels" />;
}
