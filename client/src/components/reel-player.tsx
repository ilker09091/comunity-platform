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
  sessionId?: string; postId?: string; selected?: boolean; position?:number;
}) {
  const observer = useRef<ReelWatchObserver | null>(null);
  const element = useRef<HTMLVideoElement | null>(null);
  const tracking = props.selected ?? props.active;
  useEffect(() => {
    if (!props.sessionId || !props.postId || !tracking || !props.active) return;
    const sender=watchSender(props.sessionId, props.postId, props.media.id,props.position);
    const tracker = new ReelWatchObserver(sender);
    let since=0;
    const impression=window.setInterval(()=>{
      const video=element.current,box=video?.getBoundingClientRect();
      if(!props.active||document.hidden||!box||box.width<=0||box.height<=0){since=0;return;}
      const view=window.visualViewport;
      const area=Math.max(0,Math.min(box.right,view?.width??innerWidth)-Math.max(0,box.left))*Math.max(0,Math.min(box.bottom,(view?.height??innerHeight)+(view?.offsetTop??0))-Math.max(view?.offsetTop??0,box.top));
      if(area/(box.width*box.height)<.6){since=0;return;}
      if(!since)since=performance.now();
      if(performance.now()-since>=750){sender.expose(Math.min(60000,Math.floor(performance.now()-since)));window.clearInterval(impression);}
    },125);
    observer.current = tracker;
    const visibility = () => { if (element.current) tracker.observe(document.hidden ? 'pause' : 'tick', element.current, performance.now(), !document.hidden); };
    const leave = () => tracker.finish();
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave);
    return () => { window.clearInterval(impression);tracker.finish(); observer.current = null; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); };
  }, [props.sessionId, props.postId, props.media.id, props.position,props.active,tracking]);
  const onPlayback = useCallback((kind: PlaybackSignal, video: HTMLVideoElement) => {
    element.current = video; observer.current?.observe(kind, video, performance.now(), !document.hidden);
  }, []);
  return <VideoPlayerCore {...props} current={props.selected} onPlayback={onPlayback} mode="reels" />;
}
