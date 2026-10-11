"use client";
import { useSyncExternalStore } from 'react';
const KEY='circle.profile.layout';
function get(): 'classic'|'grid' { try {return localStorage.getItem(KEY)==='grid'?'grid':'classic';} catch {return 'classic';} }
function subscribe(fn:()=>void) { window.addEventListener('storage',fn);window.addEventListener('circle-profile-layout',fn);return()=>{window.removeEventListener('storage',fn);window.removeEventListener('circle-profile-layout',fn);}; }
export function useProfileLayout() {
  const layout=useSyncExternalStore(subscribe,get,()=> 'classic' as const);
  return [layout,(value:'classic'|'grid')=>{try{localStorage.setItem(KEY,value);}catch{}window.dispatchEvent(new Event('circle-profile-layout'));}] as const;
}
