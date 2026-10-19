"use client";
import { useEffect, useRef, useState } from "react";
import { Avatar, Modal } from "./ui";
import type { Models } from "@/lib/api/client";

export function ImageViewer({src,alt,onClose}:{src:string;alt:string;onClose:()=>void}) {
  const [failed,setFailed]=useState(false);
  return <Modal title={alt} onClose={onClose} className="image-viewer-dialog">
    <div className="image-viewer-content">{failed?<p role="alert">This image is no longer available. Close and reopen it to refresh.</p>:<img src={src} alt={alt} onError={()=>setFailed(true)} draggable={false}/>}</div>
  </Modal>;
}
export function ProfilePhoto({user}:{user:Models["UserProfileDto"]}) {
  const [open,setOpen]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const origin=useRef<{x:number;y:number}|null>(null),held=useRef(false);
  const touched=useRef(false);
  const cancel=()=>{clearTimeout(timer.current);origin.current=null;};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  return <>
    <button type="button" className="profile-photo-button" aria-label={`Enlarge ${user.displayName}'s profile photo`} disabled={!user.avatarUrl}
      onPointerDown={event=>{
        touched.current=event.pointerType==='touch';
        if(event.pointerType!=="touch")return;
        origin.current={x:event.clientX,y:event.clientY};held.current=false;
        timer.current=setTimeout(()=>{held.current=true;setOpen(true);},450);
      }}
      onPointerMove={event=>{const start=origin.current;if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)cancel();}}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={event=>event.preventDefault()}
      onClick={event=>{if(held.current){event.preventDefault();held.current=false;return;}if(touched.current&&event.detail>0)return;setOpen(true);}}>
      <Avatar user={user} size={150}/>
    </button>
    {open&&user.avatarUrl&&<ImageViewer src={user.avatarUrl} alt={`${user.displayName}'s profile photo`} onClose={()=>setOpen(false)}/>}
  </>;
}
