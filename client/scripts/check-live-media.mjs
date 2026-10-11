// Read-only check. Signed URLs remain in memory and never appear in output.
import assert from "node:assert/strict";
const origin = process.env.MEDIA_CHECK_ORIGIN ?? "http://localhost:3002";
const get = async (path) => { const response = await fetch(origin + path); assert.equal(response.status, 200); return response.json(); };
const [home, reels] = await Promise.all([get("/api/feed/global?limit=20"), get("/api/feed/reels?limit=20")]);
const homeVideos = new Map(home.items.flatMap((post) => post.media.filter((m) => m.type === "VIDEO" && m.status === "READY").map((m) => [m.id, m])));
for (const media of reels.items.flatMap((post) => post.media.filter((m) => m.type === "VIDEO" && m.status === "READY"))) {
  const same = homeVideos.get(media.id); if (same) assert.ok(media.url === same.url, "Home and Reels media sources differ");
  let parsed; try { parsed = new URL(media.url); } catch { throw new Error("Invalid media URL"); }
  assert.ok(["http:", "https:"].includes(parsed.protocol));
  const range = async (start, end) => {
    const response = await fetch(media.url, { headers: { Range: `bytes=${start}-${end}`, Origin: "http://localhost:3000" } });
    assert.equal(response.status, 206); assert.match(response.headers.get("content-type"), /^video\/mp4/);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    const contentRange = response.headers.get("content-range"), bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get("content-length")), bytes.length);
    return { response, bytes, total: Number(contentRange.split("/")[1]) };
  };
  const initial = await range(0, 1023);
  let offset = 0, moov = null, mdatAt = Infinity, moovAt = Infinity;
  while (offset < initial.total) {
    const { bytes } = await range(offset, Math.min(offset + 15, initial.total - 1));
    let size = bytes.readUInt32BE(0); const type = bytes.toString("ascii", 4, 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(8));
    if (!size) size = initial.total - offset;
    assert.ok(size >= 8 && size <= initial.total - offset);
    if (type === "mdat") mdatAt = offset;
    if (type === "moov") { moovAt = offset; if (size <= 2_000_000) moov = (await range(offset, offset + size - 1)).bytes; }
    offset += size;
  }
  const codecs = new Set();
  const visit = (bytes, start = 0, end = bytes.length) => {
    for (let at = start; at + 8 <= end;) {
      const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
      if (size < 8 || at + size > end) break;
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) visit(bytes, at + 8, at + size);
      else if (type === "stsd") {
        const entry = bytes.toString("ascii", at + 20, at + 24);
        if (["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4a"].includes(entry)) codecs.add(entry);
      }
      at += size;
    }
  };
  if (moov) visit(moov);
  console.log(JSON.stringify({ mediaId: media.id, sameHomeSource: !!same, bytes: initial.total, status: initial.response.status, mime: initial.response.headers.get("content-type"), range: initial.response.headers.get("content-range"), cors: initial.response.headers.get("access-control-allow-origin"), codecs: [...codecs], fastStart: moovAt < mdatAt }));
}
