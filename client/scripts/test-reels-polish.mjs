import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { compileVideoFixtures } from "./transpile-video-fixtures.mjs";

const directory = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(directory, ".reels-polish-tests-"));
const dom = new JSDOM("<div id='root'></div>", {url:"http://localhost/reels",pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver,Element:dom.window.Element,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,"navigator",{configurable:true,value:dom.window.navigator});
window.matchMedia = media => ({media,matches:false,addEventListener(){},removeEventListener(){}});
const paused = new WeakMap();
Object.defineProperty(window.HTMLMediaElement.prototype,"paused",{configurable:true,get(){return paused.get(this) ?? true;}});
window.HTMLMediaElement.prototype.load = function() {};
window.HTMLMediaElement.prototype.pause = function() { paused.set(this,true); this.dispatchEvent(new window.Event("pause")); };
const nativePlay = function() { paused.set(this,false); this.dispatchEvent(new window.Event("playing")); return Promise.resolve(); };
window.HTMLMediaElement.prototype.play = nativePlay;
const host = document.getElementById("root"), root = createRoot(host);
const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false,gcTime:0}}});
globalThis.polishUser = {id:"me"};
globalThis.polishToasts = [];
let calls = [], settle;
globalThis.polishApi = (operation, options) => { calls.push({operation,options}); return new Promise(resolve => {settle=resolve;}); };
const media = {id:"video-one",url:"https://example.invalid/one.mp4?signature=stable",type:"VIDEO",status:"READY"};
let checks=0;
const pass = name => {checks++;console.log("PASS "+name);};
try {
  await compileVideoFixtures(directory,temp);
  await writeFile(join(temp,"polish-shims.mjs"), `
    export const api = (...args) => globalThis.polishApi(...args);
    export const useSession = () => ({user:globalThis.polishUser});
    export const useToast = () => (...args) => globalThis.polishToasts.push(args);
    export const broadcastSession = () => {};
    export const changeSession = () => {};
    export const useFollowRequestDecision = () => {};
    export const followRequestErrorMessage = () => "Error";
    export const sharePath = () => {};
    export const SendPostButton = () => null;
    export const usePostEngagement = () => ({});
    export const relativeTime = () => "now";
    export const useFeatures = () => ({ config: undefined, on: () => true, readOnly: false, canWrite: () => true });
    const Empty = () => null;
    export default Empty;
    export const Avatar=Empty,ErrorState=Empty,LoadingSkeleton=Empty,LoadMore=Empty,SignInPrompt=Empty,ConfirmDialog=Empty,PageHeader=Empty,Dropdown=Empty,Modal=Empty,CommentInput=Empty;
  `);
  for (const component of ["settings","follow-button","post-card"]) {
    let source = await readFile(join(directory,"src/components",component+".tsx"),"utf8");
    source = source.replace("from './photo-gallery'", 'from "./polish-shims.mjs"').replace('from "next/link"','from "./video-link.mjs"')
      .replace('from "@/lib/video-preferences"','from "./video-preferences.mjs"')
      .replace('from "./video-player-core"','from "./video-player-core.mjs"');
    for (const dependency of ["@/lib/api/client","@/lib/follow-requests","@/lib/use-post-engagement","./social-controls","./providers","./ui","./report-dialog","./comments","./post-composer","./photo-gallery","@/lib/platform-config"])
      source = source.replace(`from "${dependency}"`,'from "./polish-shims.mjs"');
    await writeFile(join(temp,component+".mjs"),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
  }
  const {default:Player} = await import(pathToFileURL(join(temp,"video-player-core.mjs")));
  const {VideoPlaybackSettings} = await import(pathToFileURL(join(temp,"settings.mjs")));
  const {default:FollowButton} = await import(pathToFileURL(join(temp,"follow-button.mjs")));
  const {PostMedia} = await import(pathToFileURL(join(temp,"post-card.mjs")));
  const prefs = await import(pathToFileURL(join(temp,"video-preferences.mjs")));
  const render = children => act(async () => root.render(React.createElement(QueryClientProvider,{client},children)));
  await render([React.createElement(Player,{key:"player",media,mode:"reels",label:"Reel"}),React.createElement(VideoPlaybackSettings,{key:"settings"})]);
  assert.equal(prefs.getVideoPreferences().startMuted,true);
  const video = host.querySelector("video"), toggle = host.querySelector('[role="switch"]');
  assert.equal(toggle.checked,false);
  await act(async () => toggle.click());
  assert.equal(video.muted,false); assert.equal(prefs.getVideoPreferences().startMuted,false);
  await act(async () => host.querySelector('[aria-label="Mute"]').click());
  assert.equal(toggle.checked,false); assert.equal(video.muted,true);
  window.localStorage.setItem(prefs.VIDEO_PREFERENCES_KEY,JSON.stringify({startMuted:false}));
  await act(async () => window.dispatchEvent(new window.StorageEvent("storage",{key:prefs.VIDEO_PREFERENCES_KEY})));
  assert.equal(toggle.checked,true); assert.equal(video.muted,false);
  await act(async () => host.querySelector('[aria-label="Pause video"]').click());
  await act(async () => toggle.click());
  assert.equal(video.paused,true);
  pass("Settings, player controls and cross-tab storage share one audio preference without overriding manual pause");

  await render(React.createElement(PostMedia,{postId:"post / exact",media:[{...media,id:"media / exact"}]}));
  const expand = host.querySelector('[aria-label="Open in Reels"]');
  assert.equal(expand.getAttribute("href"),"/reels?start=post%20%2F%20exact&media=media%20%2F%20exact");
  assert.equal(expand.closest("button"),null);
  assert.ok(host.querySelector('[aria-label="Play video"]')); assert.ok(host.querySelector('[aria-label="Seek video"]'));
  pass("the actual feed media component links the exact encoded post and media IDs, with independent playback controls");

  client.setQueryData(["profile","creator"],{id:"creator",isFollowing:false,isFollowRequested:false});
  client.setQueryData(["discovery","suggestions"],{items:[]});
  await render(React.createElement(FollowButton,{key:"follow",id:"creator",following:false,variant:"badge"}));
  const badge = host.querySelector('[aria-label="Follow creator"]');
  await act(async () => {badge.click();badge.click();});
  assert.equal(calls.length,1); assert.equal(calls[0].operation,"followsFollow");
  assert.deepEqual(calls[0].options.params,{id:"creator"});
  await act(async () => {settle({status:"REQUESTED"});await new Promise(resolve=>setTimeout(resolve,20));});
  assert.ok(host.querySelector('[aria-label="Follow request pending"]').disabled);
  assert.equal(client.getQueryData(["profile","creator"]).isFollowRequested,true);
  assert.equal(client.getQueryState(["discovery","suggestions"]).isInvalidated,true);
  await act(async () => host.querySelector("button").click()); assert.equal(calls.length,1);
  pass("private follow requests use the existing API once, disable repeat requests and synchronize profile/suggestion caches");
  await render(React.createElement(FollowButton,{key:"public",id:"public",following:false,variant:"badge"}));
  await act(async () => host.querySelector("button").click());
  await act(async () => {settle({status:"FOLLOWING"});await new Promise(resolve=>setTimeout(resolve,20));});
  assert.ok(host.querySelector('[aria-label="Following creator"]').disabled);
  await render(React.createElement(FollowButton,{key:"self",id:"me",following:false,variant:"badge"}));
  assert.equal(host.querySelector("button"),null);
  pass("public follows show a check state and the current user's own Reel has no follow action");

  await render(null);
  await act(async () => prefs.setVideoStartMuted(false));
  let resolveFallback, attempts=0;
  window.HTMLMediaElement.prototype.play = function() {
    attempts++;
    if (attempts===1) return Promise.reject(new DOMException("Denied","NotAllowedError"));
    if (attempts===2) return new Promise(resolve=>{resolveFallback=resolve;});
    return nativePlay.call(this);
  };
  const renderReel = active => render(React.createElement(Player,{key:"race",media,mode:"reels",active,label:"Race Reel"}));
  await renderReel(true);
  assert.equal(attempts,2,"one unmuted attempt and one muted fallback");
  const raceVideo = host.querySelector("video");
  await renderReel(false); await renderReel(true);
  assert.equal(raceVideo.paused,false); assert.equal(raceVideo.muted,false);
  await act(async () => resolveFallback());
  assert.equal(raceVideo.paused,false,"a late fallback completion cannot pause a newer playback owner");
  assert.equal(prefs.getVideoPreferences().startMuted,false);
  pass("rapid leave/re-entry ignores stale autoplay fallback completion and preserves the newest playback attempt");
  await act(async () => root.unmount());
  client.clear();
  console.log(`\n${checks} Reels polish groups passed with mocked API/media. No live follow operations or native decoding were tested.`);
} finally {
  dom.window.close();
  assert.ok(resolve(temp).startsWith(resolve(directory)+sep) && temp.includes(".reels-polish-tests-"));
  await rm(temp,{recursive:true,force:true});
}
