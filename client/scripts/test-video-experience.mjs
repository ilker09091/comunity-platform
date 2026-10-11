import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { compileVideoFixtures } from "./transpile-video-fixtures.mjs";

const rootPath = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(rootPath, ".video-experience-tests-"));
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
window.matchMedia = media => ({ matches: false, media, addEventListener() {}, removeEventListener() {} });
globalThis.videoTestRoute = "/";
let observer, observers = 0, plays = 0, refreshes = 0;
const paused = new WeakMap(), loads = new WeakMap();
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); observer = this; observers++; }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  emit(changes) { this.callback(changes.map(([target, ratio]) => ({ target, intersectionRatio: ratio, isIntersecting: ratio > 0 }))); }
};
Object.defineProperty(dom.window.HTMLMediaElement.prototype, "paused", { configurable: true, get() { return paused.get(this) ?? true; } });
dom.window.HTMLMediaElement.prototype.load = function () { loads.set(this, (loads.get(this) ?? 0) + 1); };
dom.window.HTMLMediaElement.prototype.pause = function () { paused.set(this, true); this.dispatchEvent(new window.Event("pause")); };
dom.window.HTMLMediaElement.prototype.play = function () { plays++; paused.set(this, false); this.dispatchEvent(new window.Event("playing")); return Promise.resolve(); };
const host = document.getElementById("root"), root = createRoot(host);
let checks = 0;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  await compileVideoFixtures(rootPath, temp);
  const { default: Player } = await import(pathToFileURL(join(temp, "video-player-core.mjs")));
  const { videoPlayback, fitVideoBounds } = await import(pathToFileURL(join(temp, "video-playback-coordinator.mjs")));
  const { getVideoPreferences, setVideoStartMuted, VIDEO_PREFERENCES_KEY } = await import(pathToFileURL(join(temp, "video-preferences.mjs")));
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), url: `https://example.invalid/${i}.mp4?signature=unchanged`, type: "VIDEO", status: "READY", width: null, height: null }));
  const render = async (mode = "feed") => act(async () => root.render(React.createElement(StrictMode, null, items.map((media, i) => React.createElement(Player, { key: media.id, media, mode, active: mode === "feed" || i === 0, label: "Video " + i, onRefreshSource: async () => { refreshes++; } })))));
  await render();
  const videos = [...host.querySelectorAll("video")];
  assert.ok(videos.every(v => !v.hasAttribute("src")));
  assert.equal(plays, 0);
  const baseline = observers;
  await act(async () => observer.emit([[videos[0], .65], [videos[1], .7]]));
  assert.equal(observers, baseline, "one shared observer serves all five players");
  assert.ok(videoPlayback.owns(videos[1]));
  assert.equal(videos.filter(v => !v.paused).length, 1);
  assert.ok(videos[1].getAttribute("src").endsWith("signature=unchanged"));
  pass("lazy source attachment and one shared observer select only the most visible video");

  await act(async () => videos[1].parentElement.querySelector('[aria-label="Pause video"]').click());
  const manualPlays = plays;
  await render();
  await act(async () => observer.emit([[videos[0], .72], [videos[1], .7]]));
  assert.equal(plays, manualPlays); assert.equal(videos[1].paused, true);
  const modal = document.createElement("dialog"); modal.setAttribute("open", "");
  await act(async () => document.body.append(modal));
  assert.ok(videos.every(v => v.paused));
  await act(async () => modal.remove());
  assert.equal(videos[1].paused, true); assert.equal(plays, manualPlays);
  pass("manual pause survives rerenders, observer updates and modal open/close");

  await act(async () => observer.emit([[videos[1], 0], [videos[0], .8]]));
  assert.ok(videoPlayback.owns(videos[0]));
  await act(async () => observer.emit([[videos[0], .65], [videos[1], .9]]));
  assert.ok(videoPlayback.owns(videos[1])); assert.equal(videos[1].paused, false);
  await act(async () => observer.emit([[videos[0], .95], [videos[1], .9]]));
  assert.ok(videoPlayback.owns(videos[1]), "small visibility differences do not oscillate selection");
  await act(async () => observer.emit([[videos[0], .95], [videos[1], .6]]));
  assert.ok(videoPlayback.owns(videos[0]));
  pass("viewport re-entry resets manual pause and selection hysteresis prevents oscillation");

  await act(async () => document.body.append(modal));
  assert.ok(videos.every(v => v.paused));
  await act(async () => modal.remove());
  assert.equal(videos.filter(v => !v.paused).length, 1);
  await act(async () => videoPlayback.setRoute("/reels"));
  assert.ok(videos.every(v => v.paused));
  await act(async () => videoPlayback.setRoute("/"));
  assert.equal(videos.filter(v => !v.paused).length, 1);
  pass("native modals and route transitions stop background playback");
  const sheet = document.createElement("aside"); sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
  await act(async () => document.body.append(sheet));
  assert.ok(videos.every(v => v.paused));
  await act(async () => sheet.remove());
  assert.equal(videos.filter(v => !v.paused).length, 1);
  pass("a mobile modal bottom sheet also blocks background autoplay");

  Object.defineProperties(videos[0], { videoWidth: { configurable: true, value: 1280 }, videoHeight: { configurable: true, value: 720 }, duration: { configurable: true, value: 60 } });
  await act(async () => { videos[0].dispatchEvent(new window.Event("loadedmetadata")); videos[0].currentTime = 13; videos[0].dispatchEvent(new window.Event("timeupdate")); });
  assert.equal(parseFloat(videos[0].parentElement.style.aspectRatio), 16 / 9);
  await act(async () => videos[0].parentElement.querySelector('[aria-label="Pause video"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  assert.equal(videos[0].currentTime, 18);
  const sameVideo = videos[0], sameLoads = loads.get(videos[0]);
  await render(); assert.equal(host.querySelector("video"), sameVideo); assert.equal(loads.get(sameVideo), sameLoads);
  pass("native metadata determines aspect ratio, keyboard seeks work and rerenders preserve the source");

  await act(async () => observer.emit(videos.map((v, i) => [v, i === 2 ? .9 : 0])));
  await act(async () => observer.emit(videos.map((v, i) => [v, i === 3 ? .9 : 0])));
  await act(async () => observer.emit(videos.map((v, i) => [v, i === 4 ? .9 : 0])));
  assert.ok(videos.filter(v => v.hasAttribute("src")).length <= 3);
  assert.equal(videos[0].getAttribute("src"), null);
  assert.ok(loads.get(videos[0]) > sameLoads, "source eviction explicitly cancels the previous media resource");
  Object.defineProperty(videos[0], "duration", { configurable: true, value: NaN });
  await act(async () => observer.emit(videos.map((v, i) => [v, i === 0 ? .9 : 0])));
  videos[0].currentTime = 0;
  await act(async () => { videos[0].dispatchEvent(new window.Event("loadstart")); videos[0].dispatchEvent(new window.Event("timeupdate")); });
  assert.ok(videos[0].parentElement.querySelector(".video-seek").disabled, "unknown duration cannot be scrubbed");
  Object.defineProperty(videos[0], "duration", { configurable: true, value: 60 });
  await act(async () => videos[0].dispatchEvent(new window.Event("loadedmetadata")));
  assert.equal(videos[0].currentTime, 18);
  assert.equal(videos.filter(v => !v.paused).length, 1);
  pass("the source budget evicts old downloads and restores playback position on re-entry");

  Object.defineProperty(videos[0], "error", { configurable: true, value: { code: 2 } });
  await act(async () => videos[0].dispatchEvent(new window.Event("error")));
  assert.match(host.textContent, /Check your connection/);
  await act(async () => videos[0].parentElement.querySelector('.video-error button').click());
  assert.equal(refreshes, 1); assert.equal(host.querySelector("video"), videos[0]);
  pass("download errors offer a source-refresh retry without replacing the video element");

  await act(async () => observer.emit(videos.map(v => [v, 0])));
  Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
  await render();
  const beforeSaveData = plays;
  await act(async () => observer.emit([[videos[1], .9]]));
  assert.equal(plays, beforeSaveData, "Save-Data never automatically starts downloading playback");
  await act(async () => videos[1].parentElement.querySelector('[aria-label="Play video"]').click());
  assert.ok(plays > beforeSaveData); assert.equal(videos.filter(v => !v.paused).length, 1);
  pass("Save-Data suppresses autoplay while a trusted manual play remains usable");
  Object.defineProperty(navigator, "connection", { configurable: true, value: undefined });
  await render();

  const nativePlay = dom.window.HTMLMediaElement.prototype.play;
  let mutedFallback = false;
  dom.window.HTMLMediaElement.prototype.play = function () {
    if (!this.muted) return Promise.reject(new DOMException("Denied", "NotAllowedError"));
    mutedFallback = true; return nativePlay.call(this);
  };
  await act(async () => { observer.emit([[videos[1], 0], [videos[2], 0]]); });
  await act(async () => videos[2].parentElement.querySelector('[aria-label="Unmute"]').click());
  await act(async () => observer.emit([[videos[2], .9]]));
  assert.ok(mutedFallback); assert.equal(videos[2].muted, true); assert.ok(videoPlayback.owns(videos[2]));
  assert.equal(getVideoPreferences().startMuted, false);
  assert.equal(JSON.parse(window.localStorage.getItem(VIDEO_PREFERENCES_KEY)).startMuted, false);
  assert.match(videos[2].parentElement.textContent, /Tap Unmute for sound/);
  const settledPlays = plays;
  await render(); await render();
  assert.equal(plays, settledPlays, "unrelated renders never restart browser-muted playback");
  dom.window.HTMLMediaElement.prototype.play = nativePlay;
  pass("unmuted autoplay rejection retries muted once and preserves the persisted sound preference");

  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
  assert.ok(videos.every(v => v.paused));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
  assert.equal(videos.filter(v => !v.paused).length, 1);
  pass("hiding the tab pauses every decoder and restoring it resumes only the owner");

  for (const [width, height] of [[1920,1080],[1440,900],[1280,800],[1024,768],[768,1024],[390,844],[375,812]]) {
    for (const ratio of [9/16,16/9,1,4/3]) {
      for (const comments of [false,true]) {
        if (width < 900) continue;
        const stageWidth = width - 72 - (comments ? 384 : 0), bounds = fitVideoBounds(ratio,stageWidth - 264,height - 48);
        assert.ok(bounds.width <= stageWidth - 264 + .01); assert.ok(bounds.height <= height - 48 + .01);
        assert.ok(Math.abs(bounds.width / bounds.height - ratio) < .000001);
        assert.ok(stageWidth / 2 + bounds.width / 2 + 14 + 52 <= stageWidth - 60 + .01, "engagement rail clears the navigation arrows");
      }
    }
  }
  pass("desktop sizing preserves four source ratios and clears controls at every requested desktop viewport");
  await act(async () => setVideoStartMuted(true));
  globalThis.videoTestRoute = "/reels";
  await render("reels");
  assert.ok(videos.every(v => v.loop), "all reels use native looping");
  // This fixture deliberately reuses the feed DOM node, including its manual-pause intent.
  await act(async () => videos[0].parentElement.querySelector('[aria-label="Play video"]').click());
  assert.equal(videos.filter(v => !v.paused).length, 1);
  await act(async () => videos[0].parentElement.querySelector('[aria-label="Unmute"]').click());
  assert.ok(videos.every(v => !v.muted));
  assert.equal(getVideoPreferences().startMuted,false);
  assert.equal(JSON.parse(window.localStorage.getItem(VIDEO_PREFERENCES_KEY)).startMuted,false);
  const reloadedStore = await import(pathToFileURL(join(temp, "video-preferences.mjs")) + "?reload");
  assert.equal(reloadedStore.getVideoPreferences().startMuted,false, "a fresh store reads the saved preference");
  videos[0].currentTime = 59.8;
  await act(async () => videos[0].dispatchEvent(new window.Event("timeupdate")));
  assert.equal(videos[0].parentElement.querySelector(".video-time").textContent,"00:59 / 01:00");
  const loopPlays = plays, loopLoads = loads.get(videos[0]);
  videos[0].currentTime = 0;
  await act(async () => { videos[0].dispatchEvent(new window.Event("timeupdate")); videos[0].dispatchEvent(new window.Event("ended")); });
  assert.equal(videos[0].parentElement.querySelector(".video-time").textContent,"00:00 / 01:00");
  assert.equal(plays,loopPlays); assert.equal(loads.get(videos[0]),loopLoads); assert.equal(host.querySelector("video"),videos[0]);
  assert.equal(videos[0].muted,false);
  await act(async () => videos[0].parentElement.querySelector('[aria-label="Pause video"]').click());
  await act(async () => { setVideoStartMuted(true); videos[0].dispatchEvent(new window.Event("ended")); });
  await render("reels");
  assert.equal(videos[0].paused,true); assert.equal(plays,loopPlays);
  pass("native looping resets progress without reload, global audio persists and manual pause survives audio changes");
  await act(async () => root.unmount());
  assert.equal(observer.targets.size, 0);
  assert.ok(videos.every(v => !v.hasAttribute("src")));
  pass("unmount disconnects observers and releases every source");
  console.log(`\n${checks} video experience groups passed with mocked media/IntersectionObserver. No native decoding or rendered viewport claims.`);
} finally {
  dom.window.close();
  assert.ok(resolve(temp).startsWith(resolve(rootPath) + sep) && temp.includes(".video-experience-tests-"));
  await rm(temp, { recursive: true, force: true });
}
