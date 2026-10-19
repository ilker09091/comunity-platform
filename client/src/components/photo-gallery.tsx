"use client";
import { useEffect, useLayoutEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Expand, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import type { Models } from "@/lib/api/client";
import { Modal } from "./ui";

type Photo = Models["MediaDto"];
type Transform = { scale: number; x: number; y: number };
const original: Transform = { scale: 1, x: 0, y: 0 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function PhotoViewer({ photos, initial = 0, onClose }: { photos: Photo[]; initial?: number; onClose: () => void }) {
  const [index, setIndex] = useState(initial);
  const [transform, setTransform] = useState(original);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const viewport = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const current = useRef(transform);
  useLayoutEffect(()=>{current.current=transform;},[transform]);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ base: Transform; x: number; y: number; distance: number; multi: boolean; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const pointerType = useRef('mouse');
  const change = (delta: number) => { setIndex(i => clamp(i + delta, 0, photos.length - 1)); setTransform(original); points.current.clear(); gesture.current = null; };
  const update = (value: Transform) => {
    const node = image.current, box = viewport.current;
    if (!node || !box) return;
    const scale = clamp(value.scale, 1, 6);
    const x = Math.max(0, (node.offsetWidth * scale - box.clientWidth) / 2);
    const y = Math.max(0, (node.offsetHeight * scale - box.clientHeight) / 2);
    setTransform({ scale, x: clamp(value.x, -x, x), y: clamp(value.y, -y, y) });
  };
  const zoom = (scale: number, x = 0, y = 0) => {
    const old = current.current, next = clamp(scale, 1, 6), ratio = next / old.scale;
    update({ scale: next, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio });
  };
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); change(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); change(-1); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(current.current.scale * 1.4); }
    else if (event.key === '-') { event.preventDefault(); zoom(current.current.scale / 1.4); }
  });
  useEffect(() => {
    const before = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener('keydown', onKey);
    return () => { document.documentElement.style.overflow = before; window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      zoom(current.current.scale * Math.exp(-event.deltaY * .002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    };
    box.addEventListener("wheel", wheel, { passive: false });
    return () => box.removeEventListener("wheel", wheel);
    // The handler deliberately reads transform from a ref, preserving one listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const begin = () => {
    const p = [...points.current.values()], a = p[0], b = p[1];
    if (a) gesture.current = { base: current.current, x: b ? (a.x+b.x)/2 : a.x, y: b ? (a.y+b.y)/2 : a.y,
      distance: b ? Math.hypot(a.x-b.x,a.y-b.y) : 0, multi: !!b, moved: false };
  };
  const photo = photos[index];
  return <Modal title={`Photo ${index+1} of ${photos.length}`} onClose={onClose} className="photo-viewer">
    <div className="photo-stage" ref={viewport} tabIndex={0} aria-label="Photo, pinch or use plus and minus to zoom"
      onDoubleClick={() => { if (pointerType.current === "touch") return; zoom(current.current.scale > 1 ? 1 : 2.5); }}
      onPointerDown={event => { pointerType.current=event.pointerType;event.currentTarget.setPointerCapture(event.pointerId); points.current.set(event.pointerId,{x:event.clientX,y:event.clientY}); begin(); }}
      onPointerMove={event => {
        if (!points.current.has(event.pointerId)) return;
        points.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
        const p=[...points.current.values()], g=gesture.current;
        if (!g || !p[0]) return;
        if (p[1]) {
          const rect=event.currentTarget.getBoundingClientRect(), cx=(p[0].x+p[1].x)/2, cy=(p[0].y+p[1].y)/2;
          const scale=clamp(g.base.scale*Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)/Math.max(1,g.distance),1,6), ratio=scale/g.base.scale;
          const ax=g.x-rect.left-rect.width/2, ay=g.y-rect.top-rect.height/2;
          update({scale,x:ax-(ax-g.base.x)*ratio+cx-g.x,y:ay-(ay-g.base.y)*ratio+cy-g.y});g.multi=true;g.moved=true;
        } else {
          const dx=p[0].x-g.x, dy=p[0].y-g.y;
          if (Math.abs(dx)+Math.abs(dy)>8) g.moved=true;
          if (g.base.scale>1) update({...g.base,x:g.base.x+dx,y:g.base.y+dy});
        }
      }}
      onPointerUp={event => {
        const g=gesture.current;
        points.current.delete(event.pointerId);
        if (g && !g.multi && g.base.scale===1 && Math.abs(event.clientX-g.x)>65 && Math.abs(event.clientX-g.x)>Math.abs(event.clientY-g.y)) change(event.clientX<g.x?1:-1);
        else if (g && !g.multi && !g.moved && event.pointerType==='touch') { const now=performance.now(); if(now-lastTap.current<300) { zoom(current.current.scale>1?1:2.5);lastTap.current=0; } else lastTap.current=now; }
        if (points.current.size) { begin(); if (gesture.current) gesture.current.multi=true; } else gesture.current=null;
      }}
      onPointerCancel={() => {points.current.clear();gesture.current=null;}}>
      {loaded !== photo.id && failed !== photo.id && <Loader2 className="photo-loader spin" aria-label="Loading photo" />}
      {failed===photo.id ? <p role="alert">This photo could not load. <button className="button secondary small" onClick={() => {setFailed(null);setRetry(n=>n+1);}}>Retry</button></p> : null}
      <img key={`${photo.id}:${retry}`} ref={image} src={photo.url} alt={`Photo ${index+1}`} width={photo.width??undefined} height={photo.height??undefined}
        draggable={false} onLoad={() => setLoaded(photo.id)} onError={() => setFailed(photo.id)}
        style={{transform:`translate3d(${transform.x}px,${transform.y}px,0) scale(${transform.scale})`,opacity:loaded===photo.id?1:0,cursor:transform.scale>1?'grab':'zoom-in'}} />
    </div>
    <div className="photo-controls">
      <button type="button" className="icon-button" aria-label="Previous photo" disabled={index===0} onClick={() => change(-1)}><ChevronLeft /></button>
      <span aria-live="polite">{index+1} / {photos.length}</span>
      <button type="button" className="icon-button" aria-label="Next photo" disabled={index===photos.length-1} onClick={() => change(1)}><ChevronRight /></button>
      <span className="photo-control-divider" />
      <button type="button" className="icon-button" aria-label="Zoom out" disabled={transform.scale===1} onClick={() => zoom(transform.scale/1.4)}><Minus /></button>
      <button type="button" className="icon-button" aria-label="Zoom in" disabled={transform.scale===6} onClick={() => zoom(transform.scale*1.4)}><Plus /></button>
      <button type="button" className="icon-button" aria-label="Reset zoom" onClick={() => setTransform(original)}><RotateCcw size={18}/></button>
    </div>
  </Modal>;
}

export default function PhotoGallery({ photos }: { photos: Photo[] }) {
  const [index,setIndex]=useState(0), [view,setView]=useState<number|null>(null);
  const [intrinsic,setIntrinsic]=useState<{width:number;height:number}|null>(null);
  const track=useRef<HTMLDivElement>(null);
  const first=photos[0], ratio=first?.width && first.height ? first.width/first.height : intrinsic ? intrinsic.width/intrinsic.height : 1;
  if (!first) return null;
  const go=(n:number) => track.current?.scrollTo({left:n*track.current.clientWidth,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  return <div className="photo-gallery" style={{'--photo-ratio':String(ratio)} as CSSProperties}>
    <div className="photo-carousel" ref={track} aria-label="Post photos" onScroll={event => { const el=event.currentTarget;setIndex(Math.round(el.scrollLeft/Math.max(1,el.clientWidth))); }}>
      {photos.map((photo,i) => <button key={photo.id} type="button" className="photo-preview" onClick={() => setView(i)} aria-label={`Enlarge photo ${i+1} of ${photos.length}`}>
        {/* A photo shaped differently from the frame sits on a soft blurred copy of itself, not grey bars. */}
        {i>0 && photo.width && photo.height && Math.abs(photo.width/photo.height-ratio)/ratio>.02 && <img className="photo-backdrop" src={photo.url} alt="" aria-hidden="true" loading="lazy" decoding="async"/>}
        <img className="photo-main" src={photo.url} alt={`Photo ${i+1} shared in this post`} loading="lazy" decoding="async" width={photo.width??undefined} height={photo.height??undefined}
          onLoad={event => {if(i===0 && !first.width) {const img=event.currentTarget;setIntrinsic({width:img.naturalWidth,height:img.naturalHeight});}}}/>
        <span className="photo-expand"><Expand size={15}/></span>
      </button>)}
    </div>
    {photos.length>1 && <div className="gallery-controls"><button type="button" className="icon-button" aria-label="Previous image" disabled={index===0} onClick={() => go(index-1)}><ChevronLeft size={18}/></button><span aria-live="polite">{index+1} / {photos.length}</span><button type="button" className="icon-button" aria-label="Next image" disabled={index===photos.length-1} onClick={() => go(index+1)}><ChevronRight size={18}/></button></div>}
    {view!==null && <PhotoViewer photos={photos} initial={view} onClose={() => setView(null)}/>}
  </div>;
}
