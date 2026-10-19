import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const directory=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(join(directory,'.discovery-tests-'));
const dom=new JSDOM('<button id="opener">Photo</button><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
window.matchMedia=media=>({matches:true,media,addEventListener(){},removeEventListener(){}});
window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');this.querySelector('button')?.focus();};
window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');document.getElementById('opener').focus();};
window.HTMLElement.prototype.setPointerCapture=function(){};
const host=document.getElementById('root'),root=createRoot(host);
let groups=0;const pass=label=>{groups++;console.log('PASS '+label);};
try {
  for(const name of ['components/ui','components/photo-gallery','components/profile-grid','lib/profile-layout','lib/reel-watch','lib/api/client','lib/api/operations']) {
    let code=await readFile(join(directory,'src',name+(name.startsWith('lib')?'.ts':'.tsx')),'utf8');
    code=code.replace('from "next/link"','from "./link.mjs"').replace("from 'next/link'",'from "./link.mjs"').replace('from "./ui"','from "./ui.mjs"')
      .replaceAll('from "@/lib/api/client"','from "./client.mjs"').replace('from "./operations"','from "./operations.mjs"');
    await writeFile(join(temp,name.split('/').at(-1)+'.mjs'),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
  }
  await writeFile(join(temp,'link.mjs'),'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children);}');
  const {ReelWatchObserver}=await import(pathToFileURL(join(temp,'reel-watch.mjs')));
  let events=[];const observer=new ReelWatchObserver(e=>events.push(e));
  const sample=(time,extra={})=>({currentTime:time,duration:10,paused:false,seeking:false,...extra});
  observer.observe('playing',sample(0),0);
  for(let i=1;i<=8;i++)observer.observe('tick',sample(i*.25),i*250);
  assert.equal(events[0].type,'VIDEO_START');assert.equal(events.filter(e=>e.type==='WATCH_MILESTONE').length,1);assert.equal(events[1].watchedMs,2000);
  for(let i=9;i<=36;i++)observer.observe('tick',sample(i*.25),i*250);
  observer.observe('tick',sample(.05),10050);
  assert.equal(events.filter(e=>e.type==='VIDEO_COMPLETE').length,1);assert.equal(events.filter(e=>e.type==='VIDEO_REPLAY').length,1);
  observer.finish();observer.finish();assert.equal(events.filter(e=>e.type==='VIDEO_SKIP').length,1);
  assert.ok(events.length<10,'40 playback ticks only send meaningful milestones');
  pass('foreground playback sends start, meaningful milestone, completion, replay and one skip without per-tick writes');
  events=[];const seek=new ReelWatchObserver(e=>events.push(e));seek.observe('playing',sample(0),0);seek.observe('seeking',sample(9,{seeking:true}),250);seek.observe('tick',sample(9),300);seek.observe('pause',sample(9,{paused:true}),10000);seek.observe('tick',sample(9),20000,false);seek.finish();
  assert.equal(events.reduce((n,e)=>n+e.watchedMs,0),0);assert.ok(!events.some(e=>e.type==='VIDEO_COMPLETE'));
  const short=[];const tiny=new ReelWatchObserver(e=>short.push(e));tiny.observe('playing',{...sample(0),duration:1},0);tiny.observe('tick',{...sample(.25),duration:1},250);tiny.observe('tick',{...sample(.5),duration:1},500);assert.equal(short[1].watchedMs,500);
  pass('seeking, pausing, tab hiding and stalled clocks do not manufacture watched time; short-video thresholds work');

  const {default:Gallery,PhotoViewer}=await import(pathToFileURL(join(temp,'photo-gallery.mjs')));
  const photos=[{id:'portrait',url:'https://example.invalid/p.jpg',width:900,height:1600,type:'IMAGE',status:'READY'},{id:'wide',url:'https://example.invalid/w.jpg',width:1600,height:900,type:'IMAGE',status:'READY'}];
  const render=element=>act(async()=>root.render(element));
  await render(React.createElement(Gallery,{photos}));assert.equal(host.querySelector('.photo-gallery').style.getPropertyValue('--photo-ratio'),'0.5625');assert.equal(host.querySelectorAll('.photo-preview').length,2);
  await render(React.createElement(Gallery,{photos:[photos[1]]}));assert.equal(host.querySelector('.photo-gallery').style.getPropertyValue('--photo-ratio'),String(16/9));
  await render(React.createElement(Gallery,{photos}));await act(async()=>host.querySelector('.photo-preview').click());assert.ok(host.querySelector('dialog[open]'));assert.equal(document.documentElement.style.overflow,'hidden');
  await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight'})));assert.match(host.querySelector('h2').textContent,/Photo 2/);assert.equal(host.querySelector('.photo-stage img').getAttribute('src'),photos[1].url);
  await act(async()=>host.querySelector('dialog').dispatchEvent(new window.Event('cancel',{cancelable:true})));assert.equal(host.querySelector('dialog'),null);assert.equal(document.documentElement.style.overflow,'');assert.equal(document.activeElement.id,'opener');
  pass('9:16 and 16:9 galleries preserve metadata ratios; fullscreen, initial-focus arrow keys, Escape and scroll/focus restoration work');

  await render(React.createElement(PhotoViewer,{photos,onClose(){}}));const stage=host.querySelector('.photo-stage'),img=stage.querySelector('img');
  for(const [node,values] of [[stage,{clientWidth:400,clientHeight:600}],[img,{offsetWidth:337,offsetHeight:600}]])for(const [key,value] of Object.entries(values))Object.defineProperty(node,key,{configurable:true,value});
  stage.getBoundingClientRect=()=>({left:0,top:0,width:400,height:600});
  const pointer=(type,id,x,y)=>{const event=new window.Event(type,{bubbles:true});for(const [key,value] of Object.entries({pointerId:id,clientX:x,clientY:y,pointerType:'touch'}))Object.defineProperty(event,key,{value});stage.dispatchEvent(event);};
  await act(async()=>{pointer('pointerdown',1,150,300);pointer('pointerdown',2,250,300);pointer('pointermove',2,350,300);});assert.match(img.style.transform,/scale\(2\)/);
  await act(async()=>{pointer('pointerup',2,350,300);pointer('pointermove',1,180,330);pointer('pointerup',1,180,330);});assert.ok(!img.style.transform.includes('translate3d(0px,0px'),'zoomed dragging pans');
  await act(async()=>host.querySelector('[aria-label="Reset zoom"]').click());assert.match(img.style.transform,/scale\(1\)/);
  await act(async()=>stage.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-10000,clientX:200,clientY:300,cancelable:true})));assert.match(img.style.transform,/scale\(6\)/);
  await act(async()=>host.querySelector('[aria-label="Reset zoom"]').click());
  await act(async()=>{pointer('pointerdown',1,300,300);pointer('pointermove',1,100,300);pointer('pointerup',1,100,300);});assert.match(host.querySelector('h2').textContent,/Photo 2/);
  pass('two-finger pinch, bounded wheel zoom, drag panning, reset and unzoomed touch swipe work');

  const {useProfileLayout}=await import(pathToFileURL(join(temp,'profile-layout.mjs')));
  function Preference(){const [layout,set]=useProfileLayout();return React.createElement('button',{onClick:()=>set(layout==='classic'?'grid':'classic')},layout);}
  await render(React.createElement(Preference));assert.equal(host.textContent,'classic');await act(async()=>host.querySelector('button').click());assert.equal(localStorage.getItem('circle.profile.layout'),'grid');await render(null);await render(React.createElement(Preference));assert.equal(host.textContent,'grid');
  pass('profile defaults to classic and the viewer preference survives remounts');
  const {default:Grid}=await import(pathToFileURL(join(temp,'profile-grid.mjs')));
  const author={id:'creator',username:'source'};const base={id:'photo-post',kind:'POST',author,content:'Text survives',media:[photos[0]],likeCount:7,commentCount:2};
  const video={...base,id:'video-post',media:[{id:'video',type:'VIDEO',status:'FAILED',durationMs:65000,url:'https://example.invalid/v.mp4'}]};
  await render(React.createElement(Grid,{posts:[base,video,{...base,id:'text',media:[]},{...base,id:'repost',kind:'REPOST',author:{id:'sharer',username:'sharer'},referencedPost:base}]}));
  assert.equal(host.querySelectorAll('a').length,4);assert.equal(host.querySelector('a[href="/reels?start=video-post&media=video"]').querySelector('.grid-duration').textContent,'1:05');assert.match(host.textContent,/Text survives/);assert.match(host.textContent,/Video unavailable/);assert.match(host.querySelector('.grid-attribution').textContent,/@source/);assert.equal(host.querySelectorAll('img').length,2);
  pass('grid keeps text and real images, exact Reel URLs, duration and original repost attribution; unavailable media has an explicit fallback');
  await act(async()=>root.unmount());console.log(`\n${groups} media/discovery groups passed with simulated media and gestures; native iOS remains untested.`);
} finally {dom.window.close();assert.ok(resolve(temp).startsWith(resolve(directory)+sep)&&temp.includes('.discovery-tests-'));await rm(temp,{recursive:true,force:true});}
