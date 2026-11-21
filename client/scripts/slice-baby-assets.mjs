// Cuts the ChatGPT sheets in public/baby/raw into the single images the baby feature uses.
//
//   node scripts/slice-baby-assets.mjs            (from client/)
//
// - Removes a flat background (transparent, magenta or any solid color) by flood fill from the
//   edges, so whites inside the drawing (eyes, clothes) are kept.
// - Finds every figure as a connected shape, sorts them into the grid order, and puts each one
//   on a fixed canvas: characters stand bottom-centered at one scale per stage, so switching
//   outfits never makes the child jump or change size.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const RAW = path.join(root, "public", "baby", "raw");
const OUT = path.join(root, "public", "baby");
const CHAR = { width: 600, height: 720, pad: 24 };

async function load(file) {
  const { data, info } = await sharp(path.join(RAW, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Makes the flat background transparent by flood filling from the borders. */
function removeBackground(img, tolerance = 48) {
  const { data, width, height } = img;
  const at = (x, y) => (y * width + x) * 4;
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => at(x, y));
  if (corners.every((i) => data[i + 3] < 16)) return img; // already transparent
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, i) => s + data[i + c], 0) / 4));
  const near = (i) => data[i + 3] > 0 && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) <= tolerance;
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, 0, x, height - 1);
  for (let y = 0; y < height; y++) stack.push(0, y, width - 1, y);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!near(i)) continue;
    data[i + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return img;
}

/** Bounding boxes of the drawn shapes (small bits like tears are merged into their neighbour). */
function shapes(img, expected) {
  const { data, width, height } = img;
  const label = new Int32Array(width * height).fill(-1);
  const boxes = [];
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] < 24) continue;
    const box = { x0: width, y0: height, x1: 0, y1: 0, area: 0 };
    const stack = [start];
    label[start] = boxes.length;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width, y = (p - x) / width;
      box.area++;
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (label[q] === -1 && data[q * 4 + 3] >= 24) { label[q] = boxes.length; stack.push(q); }
      }
    }
    boxes.push(box);
  }
  const big = boxes.filter((b) => b.area > width * height * 0.002).sort((a, b) => b.area - a.area);
  const main = big.slice(0, expected);
  for (const b of boxes) {
    if (main.includes(b) || b.area < 30) continue;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const host = main.reduce((best, m) => {
      const d = Math.hypot(Math.max(m.x0 - cx, 0, cx - m.x1), Math.max(m.y0 - cy, 0, cy - m.y1));
      return d < best.d ? { m, d } : best;
    }, { m: null, d: Infinity });
    if (host.m && host.d < Math.max(width, height) * 0.06) {
      host.m.x0 = Math.min(host.m.x0, b.x0); host.m.y0 = Math.min(host.m.y0, b.y0);
      host.m.x1 = Math.max(host.m.x1, b.x1); host.m.y1 = Math.max(host.m.y1, b.y1);
    }
  }
  return main;
}

/** Puts shapes in reading order: rows top to bottom, then left to right. */
function gridOrder(boxes, cols, rows) {
  const byY = [...boxes].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const ordered = [];
  for (let r = 0; r < rows; r++) ordered.push(...byY.slice(r * cols, r * cols + cols).sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1)));
  return ordered;
}

/** Falls back to equal cells when the shapes can't be told apart. */
function cellBoxes(img, cols, rows) {
  const boxes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = Math.floor((c * img.width) / cols), x1 = Math.floor(((c + 1) * img.width) / cols) - 1;
    const y0 = Math.floor((r * img.height) / rows), y1 = Math.floor(((r + 1) * img.height) / rows) - 1;
    const box = { x0: x1, y0: y1, x1: x0, y1: y0 };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] < 24) continue;
      box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
    }
    boxes.push(box);
  }
  return boxes;
}

function cut(img, cols, rows, file) {
  const expected = cols * rows;
  const found = shapes(img, expected);
  if (found.length === expected) return gridOrder(found, cols, rows);
  console.warn(`  ! ${file}: found ${found.length} shapes, expected ${expected}; using equal cells instead`);
  return cellBoxes(img, cols, rows);
}

async function crop(img, box) {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 })
    .png()
    .toBuffer();
}

/** Characters: one scale per group (a stage), feet on the same baseline. */
async function writeCharacters(img, boxes, groups, names) {
  for (const group of groups) {
    const maxW = Math.max(...group.map((i) => boxes[i].x1 - boxes[i].x0 + 1));
    const maxH = Math.max(...group.map((i) => boxes[i].y1 - boxes[i].y0 + 1));
    const scale = Math.min((CHAR.width - CHAR.pad * 2) / maxW, (CHAR.height - CHAR.pad * 2) / maxH);
    for (const i of group) {
      const b = boxes[i];
      const w = Math.max(1, Math.round((b.x1 - b.x0 + 1) * scale)), h = Math.max(1, Math.round((b.y1 - b.y0 + 1) * scale));
      const figure = await sharp(await crop(img, b)).resize(w, h).png().toBuffer();
      await sharp({ create: { width: CHAR.width, height: CHAR.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: figure, left: Math.round((CHAR.width - w) / 2), top: CHAR.height - CHAR.pad - h }])
        .webp({ quality: 86, alphaQuality: 90 })
        .toFile(path.join(OUT, `${names[i]}.webp`));
    }
  }
}

async function writeItems(img, boxes, names, size) {
  for (let i = 0; i < boxes.length; i++) {
    await sharp(await crop(img, boxes[i]))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 86, alphaQuality: 90 })
      .toFile(path.join(OUT, `${names[i]}.webp`));
  }
}

const jobs = [];
for (const g of ["girl", "boy"]) {
  for (let s = 1; s <= 4; s++) {
    jobs.push({ file: `${g}-stage${s}.png`, cols: 3, rows: 2, kind: "chars",
      names: Array.from({ length: 6 }, (_, o) => `${g}-${s}-${o}`), groups: [[0, 1, 2, 3, 4, 5]] });
  }
  const moods = ["sleep", "eat", "sad"];
  jobs.push({ file: `${g}-moods.png`, cols: 4, rows: 3, kind: "chars",
    names: moods.flatMap((m) => [1, 2, 3, 4].map((s) => `${g}-${s}-${m}`)),
    // Each column is one stage: same scale within a column.
    groups: [0, 1, 2, 3].map((c) => [c, c + 4, c + 8]) });
}
jobs.push({ file: "food.png", cols: 4, rows: 3, kind: "items", size: 256, names: Array.from({ length: 12 }, (_, i) => `food-${i}`) });
jobs.push({ file: "toys.png", cols: 3, rows: 2, kind: "items", size: 256, names: Array.from({ length: 6 }, (_, i) => `toy-${i}`) });
jobs.push({ file: "stork.png", cols: 1, rows: 1, kind: "items", size: 512, names: ["stork"] });

fs.mkdirSync(OUT, { recursive: true });
let done = 0, missing = [];
for (const job of jobs) {
  if (!fs.existsSync(path.join(RAW, job.file))) { missing.push(job.file); continue; }
  console.log(`- ${job.file}`);
  const img = removeBackground(await load(job.file));
  const boxes = cut(img, job.cols, job.rows, job.file);
  if (job.kind === "chars") await writeCharacters(img, boxes, job.groups, job.names);
  else await writeItems(img, boxes, job.names, job.size);
  done++;
}
for (const room of ["room-day", "room-night"]) {
  const file = `${room}.png`;
  if (!fs.existsSync(path.join(RAW, file))) { missing.push(file); continue; }
  console.log(`- ${file}`);
  await sharp(path.join(RAW, file)).resize({ width: 1024, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(OUT, `${room}.webp`));
  done++;
}
console.log(`\n${done} sheet(s) processed.${missing.length ? ` Missing: ${missing.join(", ")}` : ""}`);
