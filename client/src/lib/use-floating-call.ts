"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from 'react';

/** A movable call preview. A tap restores it; a drag docks it to the nearest edge. */
export function useFloatingCall(minimized:boolean,restore:()=>void) {
  const [position,setPosition]=useState<{x:number;y:number}|null>(null);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number;moved:boolean}|null>(null);
  const limit=(x:number,y:number,width:number,height:number)=>{
    const viewport=window.visualViewport;
    return {x:Math.max(8,Math.min(x,window.innerWidth-width-8)),y:Math.max((viewport?.offsetTop??0)+8,Math.min(y,(viewport?.offsetTop??0)+(viewport?.height??window.innerHeight)-height-8))};
  };
  useEffect(()=>{
    if(!minimized)return;
    const resize=()=>{const node=document.querySelector<HTMLDialogElement>('.call-minimized[open]');if(!node)return;const box=node.getBoundingClientRect();setPosition(current=>limit(current?.x??box.x,current?.y??box.y,box.width,box.height));};
    const observer=new ResizeObserver(resize),node=document.querySelector('.call-minimized[open]');if(node)observer.observe(node);
    resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
    return()=>{observer.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);};
  },[minimized]);
  const end=(event:ReactPointerEvent<HTMLDialogElement>,cancelled=false)=>{
    const start=drag.current;if(!start||start.id!==event.pointerId)return;drag.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(!start.moved&&!cancelled){restore();return;}
    const box=event.currentTarget.getBoundingClientRect();setPosition(limit(box.left+box.width/2<window.innerWidth/2?8:window.innerWidth-box.width-8,box.top,box.width,box.height));
  };
  return {
    style:minimized&&position?{inset:'auto',left:position.x,top:position.y,right:'auto',bottom:'auto',margin:0,transform:'none'} as CSSProperties:undefined,
    onPointerDown:(event:ReactPointerEvent<HTMLDialogElement>)=>{
      if(!minimized||event.button>0||(event.target as Element).closest('button,a,input,select,textarea'))return;
      const box=event.currentTarget.getBoundingClientRect();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top,moved:false};
      event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove:(event:ReactPointerEvent<HTMLDialogElement>)=>{
      const start=drag.current;if(!start||start.id!==event.pointerId)return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      if(Math.hypot(dx,dy)>5)start.moved=true;
      if(start.moved){const box=event.currentTarget.getBoundingClientRect();setPosition(limit(start.left+dx,start.top+dy,box.width,box.height));}
    },
    onPointerUp:(event:ReactPointerEvent<HTMLDialogElement>)=>end(event),
    onPointerCancel:(event:ReactPointerEvent<HTMLDialogElement>)=>end(event,true),
  };
}
