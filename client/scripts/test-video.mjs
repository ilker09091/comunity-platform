import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { JSDOM } from "jsdom";
import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { compileVideoFixtures } from "./transpile-video-fixtures.mjs";

const rootPath = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(rootPath, ".video-tests-"));
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
let loads = 0, plays = 0, pauses = 0, reject = null;
dom.window.HTMLMediaElement.prototype.load = function () { loads++; };
dom.window.HTMLMediaElement.prototype.pause = function () { pauses++; };
dom.window.HTMLMediaElement.prototype.play = function () { plays++; return reject ? Promise.reject(reject) : Promise.resolve(); };
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const host = document.getElementById("root");
const root = createRoot(host);
try {
  await compileVideoFixtures(rootPath, temp);
  const { MediaVideo } = await import(pathToFileURL(join(temp, "media-video.mjs")));
  const url = "https://example.invalid/video.mp4?signature=preserve-exactly";
  // Reproduce the original defect: cleanup strips a still-mounted source.
  const legacy = document.createElement("video");
  legacy.setAttribute("src", url); legacy.removeAttribute("src"); legacy.load();
  assert.equal(legacy.getAttribute("src"), null);
  await act(async () => root.render(React.createElement(StrictMode, null, React.createElement(MediaVideo, { src: url, preload: "metadata" }))));
  assert.equal(host.querySelector("video").getAttribute("src"), url, "Strict Mode must restore the signed source");
  const stableVideo = host.querySelector("video"), stableLoads = loads;
  await act(async () => root.render(React.createElement(StrictMode, null, React.createElement(MediaVideo, { src: url, preload: "auto" }))));
  assert.equal(host.querySelector("video"), stableVideo);
  assert.equal(loads, stableLoads, "preload/parent updates must not reload sources");
  const { default: ReelPlayer } = await import(pathToFileURL(join(temp, "reel-player.mjs")));
  const props = { media: { url, id: "fixture" }, active: true, preload: "auto", label: "Fixture" };
  reject = new DOMException("Autoplay denied", "NotAllowedError");
  await act(async () => root.render(React.createElement(StrictMode, null, React.createElement(ReelPlayer, props))));
  assert.equal(host.querySelector("video").getAttribute("src"), url);
  assert.match(host.textContent, /Tap to play/);
  assert.equal(host.querySelector('[role="status"]'), null, "autoplay rejection must stop the loading overlay");
  reject = null;
  const beforeManual = plays;
  await act(async () => host.querySelector('[aria-label="Play video"]').click());
  assert.ok(plays > beforeManual, "manual fallback must invoke native play");
  assert.doesNotMatch(host.textContent, /Tap to play/);
  const element = host.querySelector("video"), beforeInactive = pauses;
  await act(async () => root.render(React.createElement(StrictMode, null, React.createElement(ReelPlayer, { ...props, active: false }))));
  assert.equal(host.querySelector("video"), element);
  assert.ok(pauses > beforeInactive, "inactive video must pause");
  await act(async () => root.unmount());
  assert.equal(element.getAttribute("src"), null, "unmount releases the source and decoder");
  console.log("6 video DOM checks passed: legacy defect, Strict Mode recovery, stable source, autoplay fallback, manual play, inactive/unmount cleanup. Native decoding was not tested.");
} finally {
  dom.window.close();
  assert.ok(resolve(temp).startsWith(resolve(rootPath) + sep) && temp.includes(".video-tests-"));
  await rm(temp, { recursive: true, force: true });
}
