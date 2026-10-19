"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, upload, type Models } from "./api/client";
import { useToast } from "@/components/providers";

export function useMediaAttachment(videoOnly = false) {
  const [uploaded, setUploaded] = useState<Models["MediaDto"] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl,setPreviewUrl]=useState<string|null>(null);
  const [previewType,setPreviewType]=useState<'IMAGE'|'VIDEO'|null>(null);
  const local=useRef<string|null>(null),owned=useRef<string|null>(null),generation=useRef(0),busy=useRef(false);
  useEffect(()=>()=>{
    generation.current++;
    if(local.current)URL.revokeObjectURL(local.current);
    if(owned.current)void api('mediaRemove',{params:{id:owned.current}}).catch(()=>{});
  },[]);
  const toast = useToast();
  const status = useQuery({
    queryKey: ["attachment", uploaded?.id],
    queryFn: ({ signal }) =>
      api("mediaGet", { params: { id: uploaded!.id }, signal }),
    enabled: !!uploaded && uploaded.status === "PROCESSING",
    refetchInterval: (q) =>
      q.state.data?.status === "READY" || q.state.data?.status === "FAILED"
        ? false
        : 1500,
    retry: false,
  });
  const media = status.data ?? uploaded;
  const select = async (file?: File) => {
    if (!file || busy.current || owned.current) return;
    if (videoOnly && !file.type.startsWith("video/"))
      return toast("Please select a video.", true);
    setUploading(true);
    busy.current=true;
    const run=++generation.current;
    if(local.current)URL.revokeObjectURL(local.current);
    local.current=URL.createObjectURL(file);setPreviewUrl(local.current);setPreviewType(file.type.startsWith('video/')?'VIDEO':'IMAGE');
    setProgress(0);
    try {
      const media=(await upload(file, value=>{if(run===generation.current)setProgress(value);})) as Models['MediaDto'];
      if(run!==generation.current){void api('mediaRemove',{params:{id:media.id}}).catch(()=>{});return;}
      owned.current=media.id;setUploaded(media);
    } catch (e) {
      if(run===generation.current){
        if(local.current)URL.revokeObjectURL(local.current);local.current=null;setPreviewUrl(null);setPreviewType(null);
        toast(e instanceof Error ? e.message : "Upload failed.", true);
      }
    } finally {
      if(run===generation.current){busy.current=false;setUploading(false);}
    }
  };
  const clear = () => {
    const id=owned.current??uploaded?.id;
    generation.current++;busy.current=false;setUploading(false);
    if(local.current)URL.revokeObjectURL(local.current);local.current=null;setPreviewUrl(null);setPreviewType(null);owned.current=null;
    if (id)
      void api("mediaRemove", { params: { id } }).catch(() => {});
    setUploaded(null);
  };
  return {
    media,
    uploading,
    progress,
    previewUrl,previewType,
    select,
    clear,
    // Once attached, it belongs to the message/story and must not be discarded.
    attached: () => {owned.current=null;if(local.current)URL.revokeObjectURL(local.current);local.current=null;setPreviewUrl(null);setPreviewType(null);setUploaded(null);},
    busy: uploading || media?.status === "PROCESSING",
    error:
      status.error?.message ??
      (media?.status === "FAILED"
        ? "Media processing failed. Remove it and try another file."
        : null),
  };
}
