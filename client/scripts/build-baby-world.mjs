// Turns the generated "baby world" images in public/baby/raw (random exec-*.png names) into the
// files the game uses, under public/baby/world/ (and a few shop items under public/baby/).
//
//   node scripts/build-baby-world.mjs            (from client/)
//
// - Files are matched by the start of their random name, so re-running is safe.
// - Scenes become WebP panoramas (day/night/foreground); props are trimmed to their drawn area.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const RAW = path.join(root, "public", "baby", "raw");
const OUT = path.join(root, "public", "baby");

/** Random-name prefix → output path (relative to public/baby) and how to process it. */
const MAP = {
  // Scenes: 2:1 panoramas (day, night) and transparent foreground frames.
  e24bd530: ["world/scene/nursery/bg-day", "scene"],
  fcb85d47: ["world/scene/nursery/bg-night", "scene"],
  cecbc139: ["world/scene/nursery/fg", "fg"],
  "8fa7a6a9": ["world/scene/kitchen/bg-day", "scene"],
  "31c8caed": ["world/scene/kitchen/bg-night", "scene"],
  "10afdbed": ["world/scene/kitchen/fg", "fg"],
  "10e89dad": ["world/scene/bathroom/bg-day", "scene"],
  "332dd279": ["world/scene/bathroom/bg-night", "scene"],
  "69ca9de1": ["world/scene/bathroom/fg", "fg"],
  "7438cee5": ["world/scene/garden/bg-day", "scene"],
  "0f278cc8": ["world/scene/garden/bg-night", "scene"],
  "62da436b": ["world/scene/garden/fg", "fg"],
  db2cdb4e: ["world/scene/park/bg-day", "scene"],
  "9efaeee6": ["world/scene/park/bg-night", "scene"],
  bd1e977e: ["world/scene/park/fg", "fg"],
  "979c51e0": ["world/scene/nursery/bg-ocean-day", "scene"],
  bb9b8690: ["world/scene/nursery/bg-ocean-night", "scene"],
  "7c380f2b": ["world/scene/nursery/bg-space-day", "scene"],
  "5936a472": ["world/scene/nursery/bg-space-night", "scene"],
  d73ff443: ["world/scene/nursery/bg-garden-day", "scene"],
  "79d456c9": ["world/scene/nursery/bg-garden-night", "scene"],
  // Props
  fb2772de: ["world/nursery/bed", "prop"],
  "9888a73d": ["world/nursery/bed-blanket", "prop"],
  c629fd18: ["world/nursery/lamp-off", "prop"],
  eab8725b: ["world/nursery/lamp-on", "prop"],
  "0de3fbb8": ["world/nursery/wardrobe", "prop"],
  "317cff79": ["world/nursery/wardrobe-open", "prop"],
  "8f758f59": ["world/nursery/toybox", "prop"],
  d5aca0a5: ["world/kitchen/highchair", "prop"],
  "45a86032": ["world/kitchen/fridge-closed", "prop"],
  "7c6185d5": ["world/kitchen/fridge-open", "prop"],
  "6dd5ab79": ["world/kitchen/plate", "prop"],
  "113b92cd": ["world/bathroom/tub", "prop"],
  "5e357989": ["world/bathroom/sink", "prop"],
  "3ab968d8": ["world/bathroom/duck", "prop"],
  f4fb4882: ["world/bathroom/towel", "prop"],
  "00119924": ["world/bathroom/bubble", "prop"],
  "3d5c3c0a": ["world/bathroom/foam", "prop"],
  e1dc7e7b: ["world/garden/swing-frame", "prop"],
  "591c16ed": ["world/garden/swing-seat", "prop-untrimmed"],
  da505755: ["world/garden/sandbox", "prop"],
  "94f0f68a": ["world/garden/ball", "prop"],
  "709bf503": ["world/garden/butterfly-1", "prop"],
  "4f9b7c61": ["world/garden/butterfly-2", "prop"],
  ac24d406: ["world/garden/flower-pot", "prop"],
  dfb33874: ["world/garden/puppy-idle", "prop"],
  "5e4ba80f": ["world/garden/puppy-run-1", "prop"],
  f2ef7e2d: ["world/garden/puppy-run-2", "prop"],
  "369a2b2c": ["world/garden/puppy-happy", "prop"],
  ca6428d7: ["world/park/slide", "prop"],
  d18c1feb: ["world/park/duck-1", "prop"],
  cc36a9c4: ["world/park/duck-2", "prop"],
  "31a205e2": ["world/park/bread", "prop"],
  "69151bdb": ["world/park/icecream", "prop"],
  "0459935e": ["world/park/kite", "prop"],
  a8087abe: ["world/park/balloon", "prop"],
  // Shop items in the same style (the shop reads these paths).
  fc707133: ["toy-6", "item"],
  "23904924": ["toy-7", "item"],
  f64fde36: ["toy-8", "item"],
  "8da41ba2": ["toy-9", "item"],
  "5eccfd25": ["toy-10", "item"],
  "2b6f61a6": ["toy-11", "item"],
  "779b2738": ["hang-bunting", "wide"],
  c3bfe987: ["hang-lights", "wide"],
};

const files = fs.readdirSync(RAW).filter((f) => f.startsWith("exec-"));
const find = (prefix) => files.find((f) => f.slice(5).startsWith(prefix));

let done = 0;
const missing = [];
for (const [prefix, [name, kind]] of Object.entries(MAP)) {
  const file = find(prefix);
  if (!file) { missing.push(prefix); continue; }
  const src = path.join(RAW, file);
  const dest = path.join(OUT, `${name}.webp`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let img = sharp(src);
  if (kind === "scene") {
    img = img.resize({ width: 2048, height: 1024, fit: "cover" }).webp({ quality: 80 });
  } else if (kind === "fg") {
    // A wide strip; the game pins it to the bottom of the scene at full width.
    img = img.resize({ width: 2048 }).webp({ quality: 82, alphaQuality: 90 });
  } else if (kind === "prop-untrimmed") {
    img = img.resize({ height: 900, withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 90 });
  } else if (kind === "item") {
    img = sharp(await sharp(src).trim({ threshold: 8 }).toBuffer())
      .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 86, alphaQuality: 90 });
  } else if (kind === "wide") {
    img = sharp(await sharp(src).trim({ threshold: 8 }).toBuffer()).resize({ width: 1024, withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 90 });
  } else {
    img = sharp(await sharp(src).trim({ threshold: 8 }).toBuffer()).resize(700, 700, { fit: "inside", withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 90 });
  }
  await img.toFile(dest);
  done++;
}
console.log(`${done} file(s) written.${missing.length ? ` Not found: ${missing.join(", ")}` : ""}`);
