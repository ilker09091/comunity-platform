import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const original = "public/circlelogo.jpeg";
const hash = data => createHash("sha256").update(data).digest("hex");
const before = hash(await readFile(original));
const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
// Remove only connected near-white JPEG background. Retained RGB artwork stays unchanged.
const visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
let head = 0, tail = 0;
const visit = index => {
  if (visited[index]) return;
  visited[index] = 1;
  const offset = index * 4, rgb = [data[offset], data[offset + 1], data[offset + 2]];
  if (Math.min(...rgb) >= 242 && Math.max(...rgb) - Math.min(...rgb) <= 12) queue[tail++] = index;
};
for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
while (head < tail) {
  const index = queue[head++], x = index % width, y = Math.floor(index / width);
  data[index * 4 + 3] = 0;
  if (x) visit(index - 1); if (x + 1 < width) visit(index + 1);
  if (y) visit(index - width); if (y + 1 < height) visit(index + width);
}
let left = width, top = height, right = 0, bottom = 0;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
  left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y);
}
const padding = 12;
left = Math.max(0,left-padding); top = Math.max(0,top-padding);
right = Math.min(width-1,right+padding); bottom = Math.min(height-1,bottom+padding);
const region = { left, top, width: right-left+1, height: bottom-top+1 };
const logo = await sharp(data,{raw:{width,height,channels:4}}).extract(region).png({compressionLevel:9}).toBuffer();
await sharp(logo).toFile("public/circle-logo.png");
// Keep the same artwork for the small icon; pad rather than distort into a square.
const side = Math.max(region.width, region.height);
const square = await sharp(logo).extend({left:Math.floor((side-region.width)/2),right:Math.ceil((side-region.width)/2),top:Math.floor((side-region.height)/2),bottom:Math.ceil((side-region.height)/2),background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
await sharp(square).resize(128,128).png().toFile("src/app/icon.png");
// ICO supports PNG entries; replace the starter favicon with the same compact symbol.
const favicon = await sharp(square).resize(48,48).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
header[6]=48; header[7]=48;
header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
header.writeUInt32LE(favicon.length,14); header.writeUInt32LE(22,18);
await writeFile("src/app/favicon.ico",Buffer.concat([header,favicon]));
if (hash(await readFile(original)) !== before) throw new Error("Original logo was modified");
console.log(JSON.stringify({original:{width,height,hasAlpha:false},crop:region,originalUnchanged:true}));
