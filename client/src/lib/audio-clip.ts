"use client";

/** Small enough to pass any upload proxy, plenty for a 15 s clip that the server re-encodes to AAC. */
const SAMPLE_RATE = 22_050;

/**
 * Works for songs and for videos (their sound track). Cuts `seconds` of `file` starting at `start` in the browser and returns it as a mono 16-bit WAV
 * (about 650 KB for 15 s). Uploading the whole song instead could be rejected by proxies (413).
 */
export async function clipToWav(file: File, start: number, seconds: number, rate = SAMPLE_RATE): Promise<File> {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context || typeof OfflineAudioContext === "undefined") throw new Error("unsupported");
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const length = Math.max(1, Math.round(seconds * rate));
    const offline = new OfflineAudioContext(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0, Math.max(0, start), seconds);
    const rendered = await offline.startRendering();
    const name = file.name.replace(/\.[^.]+$/, "") || "song";
    return new File([encodeWav(rendered.getChannelData(0), rate)], `${name}.wav`, { type: "audio/wav" });
  } finally {
    void context.close().catch(() => {});
  }
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
