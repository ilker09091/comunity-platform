// Generates src/app/dark-generated.css: dark-mode overrides for colours hard-coded in the
// stylesheets (light backgrounds, dark text, light borders). Design tokens are switched in
// dark.css; this covers everything that bypasses them. Re-run after CSS changes:
//   npm run theme:dark
import { readFile, writeFile } from "node:fs/promises";

const SOURCES = [
  "globals.css", "profile-editor.css", "video-experience.css", "social-media.css", "messages-stories.css",
  "profile-ig.css", "interaction-fixes.css", "instagram-overlays.css", "mobile-messaging.css",
  "call-experience.css", "admin/admin.css",
];
// Surfaces that are dark by design (video, calls, stories, viewers) keep their colours.
const SKIP = /reel|story|stories|call|screen-|photo-viewer|ig-photo|viewer|video|player|crop|camera|lightbox|initial-loading|share-sheet|reel-share|splash|fiktok|spoiler|preview-media|preview-avatar|aurora/i;
const ROOT = 'html[data-theme="dark"]';

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function parseColor(token) {
  const lower = token.toLowerCase();
  if (NAMED[lower]) return NAMED[lower];
  let m = lower.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  m = lower.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], alpha];
  }
  return null;
}
const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const neutral = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 18;
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b/g;

function mapBackground(token) {
  const c = parseColor(token);
  if (!c || luminance(c) < 0.62) return null;
  if (neutral(c)) {
    if (c[3] < 1) return `rgb(23 25 30 / ${+c[3].toFixed(3)})`;
    return luminance(c) > 0.93 ? "var(--surface)" : "var(--surface-muted)";
  }
  return `color-mix(in srgb, ${token} 14%, var(--surface))`;
}
function mapBorder(token) {
  const c = parseColor(token);
  if (!c || luminance(c) < 0.62) return null;
  // Pure white borders are "cut-out" rings around avatars and badges: they take the surface colour.
  if (neutral(c)) return luminance(c) > 0.97 && c[3] === 1 ? "var(--surface)" : "var(--border)";
  return `color-mix(in srgb, ${token} 32%, var(--surface))`;
}
function mapText(token) {
  const c = parseColor(token);
  if (!c || c[3] < 0.5) return null;
  const l = luminance(c);
  if (l > 0.3) return null;
  if (neutral(c)) return l < 0.06 ? "var(--text)" : "var(--text-2)";
  return `color-mix(in srgb, ${token} 50%, #fff)`;
}
function transform(prop, value) {
  let mapper = null;
  if (/^background(-color|-image)?$/.test(prop)) mapper = mapBackground;
  else if (/^(border(-top|-right|-bottom|-left)?(-color)?|outline(-color)?|box-shadow|column-rule-color)$/.test(prop)) {
    mapper = prop === "box-shadow" ? (t) => (parseColor(t) && luminance(parseColor(t)) > 0.93 && neutral(parseColor(t)) && parseColor(t)[3] === 1 ? "var(--surface)" : null) : mapBorder;
  } else if (prop === "color" || prop === "caret-color" || prop === "-webkit-text-fill-color") mapper = mapText;
  // Pure white strokes/fills draw icons on coloured badges and stay white; light greys are chart lines.
  else if (prop === "stroke" || prop === "fill")
    mapper = (t) => { const c = parseColor(t); return c && neutral(c) && luminance(c) > 0.62 && luminance(c) < 0.97 ? "var(--border)" : null; };
  if (!mapper) return null;
  let changed = false;
  const next = value.replace(COLOR, (token) => {
    const mapped = mapper(token);
    if (mapped) changed = true;
    return mapped ?? token;
  });
  return changed ? next : null;
}

function prefix(selector) {
  return selector.split(",").map((part) => {
    const s = part.trim();
    if (!s) return s;
    if (/^html\b/.test(s)) return s.replace(/^html/, ROOT);
    if (/^:root\b/.test(s)) return s.replace(/^:root/, ':root[data-theme="dark"]');
    return `${ROOT} ${s}`;
  }).join(", ");
}

/** Minimal CSS walker: rules, nested @media/@supports, skips other at-rules. */
const FAMILY = (prop) => /^background/.test(prop) ? "background" : /^(border|outline|box-shadow)/.test(prop) ? "border"
  : /^(color|caret-color|-webkit-text-fill-color)$/.test(prop) ? "color" : /^(stroke|fill)$/.test(prop) ? prop : null;

/** Minimal CSS walker: collects every rule with its @media/@supports wrappers. */
function collect(css, rules, wrappers = []) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@layer")) {
      if (!/prefers-color-scheme/.test(head)) collect(body, rules, [...wrappers, head]);
      continue;
    }
    if (head.startsWith("@") || !head || /^(from|to|\d+%)/.test(head)) continue;
    const declarations = [];
    for (const raw of body.split(/;(?![^(]*\))/)) {
      const k = raw.indexOf(":");
      if (k < 0) continue;
      const prop = raw.slice(0, k).trim().toLowerCase();
      let value = raw.slice(k + 1).trim();
      if (!prop || prop.startsWith("--")) continue;
      const important = /!important\s*$/.test(value);
      value = value.replace(/\s*!important\s*$/, "");
      declarations.push({ prop, value, important });
    }
    rules.push({ wrappers, head, selectors: head.split(",").map((x) => x.trim()).filter(Boolean), declarations });
  }
}

function generate(rules) {
  const out = [], overridden = new Map();
  for (const rule of rules) {
    if (SKIP.test(rule.head)) continue;
    const declarations = [];
    for (const { prop, value, important } of rule.declarations) {
      const next = transform(prop, value);
      if (!next) continue;
      declarations.push(`${prop}: ${next}${important ? " !important" : ""}`);
      for (const selector of rule.selectors) {
        const families = overridden.get(selector) ?? new Set();
        families.add(FAMILY(prop));
        overridden.set(selector, families);
      }
    }
    if (declarations.length) out.push({ wrappers: rule.wrappers, rule: `${prefix(rule.head)} { ${declarations.join("; ")}; }`, order: out.length });
  }
  // A generated base rule (e.g. `input.switch`) outranks its own state rules (`input.switch:checked`).
  // Re-assert those state rules with the dark prefix so checked/active/hover keep their colours.
  const bases = [...overridden.keys()].sort((a, b) => b.length - a.length);
  for (const rule of rules) {
    if (SKIP.test(rule.head)) continue;
    for (const selector of rule.selectors) {
      const base = bases.find((b) => selector !== b && selector.startsWith(b) && /^[:.[]/.test(selector.slice(b.length)));
      if (!base) continue;
      const families = overridden.get(base);
      const declarations = rule.declarations
        .filter(({ prop, value }) => families.has(FAMILY(prop)) && !transform(prop, value))
        .map(({ prop, value, important }) => `${prop}: ${value}${important ? " !important" : ""}`);
      if (declarations.length) out.push({ wrappers: rule.wrappers, rule: `${prefix(selector)} { ${declarations.join("; ")}; }` });
    }
  }
  return out;
}

const out = [];
for (const file of SOURCES) {
  const css = (await readFile(new URL(`../src/app/${file}`, import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  collect(css, rules);
  out.push({ wrappers: [], rule: `/* ${file} */` });
  out.push(...generate(rules));
}
const text = ["/* Generated by scripts/build-dark-theme.mjs — do not edit by hand. */"];
for (const { wrappers, rule } of out) text.push(wrappers.reduceRight((inner, w) => `${w} { ${inner} }`, rule));
await writeFile(new URL("../src/app/dark-generated.css", import.meta.url), text.join("\n") + "\n");
console.log(`dark-generated.css: ${out.length - SOURCES.length} rules`);
