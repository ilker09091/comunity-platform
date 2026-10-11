"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { videoPlayback } from "@/lib/video-playback-coordinator";
export default function VideoPlaybackBoundary() {
  const route = usePathname();
  useEffect(() => { videoPlayback.setRoute(route); }, [route]);
  return null;
}
