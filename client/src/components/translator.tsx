"use client";
/**
 * Turkish mode: rewrites interface text (text, placeholders, labels and titles) on the page and
 * keeps doing it as screens change. People's own words (messages, posts, captions, names, notes)
 * are skipped, so nothing they wrote is ever changed.
 */
import { useEffect } from "react";
import { getLang, toTurkish } from "@/lib/i18n";

/** Where people's own words live: never translated. */
const SKIP_ATTR = "[translate='no']";
const SKIP = [
  "[translate='no']", "script", "style", "textarea", "code", "[contenteditable='true']",
  ".post-content", ".post-caption", ".quoted-content", ".dm-bubble", ".dm-row-preview", ".dm-row-copy strong",
  ".dm-peer-name", ".dm-talk-line p", ".comment-text", ".comment-body", ".note-bubble:not(.empty)", ".note-text",
  ".story-caption", ".dm-baby-speech", ".dm-baby-word-list", ".dm-baby-tag strong", ".post-author strong",
  ".user-identity strong", ".suggested-user strong", ".profile-card h2", ".notice-text strong", ".dm-note-bubble",
  ".dm-sidebar-head h2", ".dm-sidebar-head strong", ".auth2-screens", ".dm-tot-options", ".dm-tot-results",
].join(",");
const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;

/** Interface labels that sit inside people's words (e.g. "Q", "Truth" before a question). */
const ALLOW = ".dm-talk-line p > b";

function skipped(el: Element | null) {
  if (!el) return false;
  if (el.matches(ALLOW)) return false;
  return !!el.closest(SKIP);
}

function translateText(node: Text) {
  const value = node.nodeValue;
  if (!value || skipped(node.parentElement)) return;
  const next = toTurkish(value);
  if (next !== null && next !== value) node.nodeValue = next;
}

function translateAttrs(el: Element) {
  // Placeholders and labels are interface text even on inputs and message areas.
  if (el.closest(SKIP_ATTR)) return;
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const next = toTurkish(value);
    if (next !== null && next !== value) el.setAttribute(name, next);
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  translateAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text);
    else translateAttrs(n as Element);
  }
}

function translateTitle() {
  const next = toTurkish(document.title.replace(/ \| Circle$/, ""));
  if (next) document.title = `${next} | Circle`;
}

export function Translator() {
  useEffect(() => {
    // Tell the service worker, so notifications speak the same language.
    navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "circle:lang", lang: getLang() })).catch(() => undefined);
    if (getLang() !== "tr") return;
    document.documentElement.lang = "tr";
    let observer: MutationObserver | null = null;
    let titleObserver: MutationObserver | null = null;
    let frame = 0;
    let cancelled = false;
    // Start only once React has taken over the server-rendered page (changing text before that
    // breaks hydration): after load, when the browser is idle.
    const idle = (fn: () => void) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 1500 });
      else setTimeout(fn, 300);
    };
    const start = () => {
      if (cancelled) return;
      translateTree(document.body);
      translateTitle();
      const pending = new Set<Node>();
      const flush = () => {
        frame = 0;
        for (const node of pending) if (node.isConnected) translateTree(node);
        pending.clear();
      };
      observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "childList") r.addedNodes.forEach((n) => pending.add(n));
          else pending.add(r.target);
        }
        if (!frame) frame = requestAnimationFrame(flush);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
      titleObserver = new MutationObserver(translateTitle);
      const title = document.querySelector("title");
      if (title) titleObserver.observe(title, { childList: true });
    };
    const begin = () => idle(() => idle(start));
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", begin);
      observer?.disconnect();
      titleObserver?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
