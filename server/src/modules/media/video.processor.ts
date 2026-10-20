import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/app.config.js';

export interface VideoMetadata {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** What ffprobe tells us about an uploaded file. Width/height are as displayed (rotation applied). */
export interface VideoProbe extends VideoMetadata {
  formatName: string;
  videoCodec: string;
  pixelFormat: string | null;
  audioCodec: string | null;
  rotation: number;
  bitRateKbps: number | null;
}

export const VIDEO_PROCESSOR = Symbol('VIDEO_PROCESSOR');

/**
 * Video probing and compression. Every upload ends up as H.264/AAC MP4 (web-optimised with
 * `+faststart`), scaled to fit the configured box, with metadata such as GPS location stripped.
 */
export interface VideoProcessor {
  /** Returns null when the file has no decodable video stream. */
  probe(filePath: string): Promise<VideoProbe | null>;
  /** Compresses (or, when already efficient, just repackages) `input` into `output`. */
  compress(input: string, output: string, probe: VideoProbe, onProgress?: (percent: number) => void): Promise<'remuxed' | 'transcoded'>;
  /** Duration of the first audio stream, or null when the file has no decodable audio. */
  probeAudio(filePath: string): Promise<{ durationMs: number } | null>;
  /** Cuts `durationMs` of audio starting at `startMs` into a web-optimised AAC `.m4a` (metadata stripped). */
  clipAudio(input: string, output: string, startMs: number, durationMs: number): Promise<void>;
  /**
   * Puts `audio` (looped to the video's length, faded out at the end) on `video`: replacing the
   * original sound, or mixed under it. The picture is copied, not re-encoded.
   */
  addSoundtrack(video: string, audio: string, output: string, options: { mix: boolean; durationMs: number }): Promise<void>;
  /** One still frame at `atMs` as a JPEG (link previews). */
  frame(input: string, output: string, atMs: number): Promise<void>;
}

const require = createRequire(import.meta.url);
/** Optional dev dependencies that ship ffmpeg/ffprobe binaries (absent in production images). */
function bundled(pkg: 'ffmpeg-static' | 'ffprobe-static'): string | null {
  try {
    const mod = require(pkg) as string | { path: string };
    return typeof mod === 'string' ? mod : mod.path;
  } catch {
    return null;
  }
}

@Injectable()
export class FfmpegVideoProcessor implements VideoProcessor {
  private readonly logger = new Logger(FfmpegVideoProcessor.name);
  private readonly ffmpeg: string;
  private readonly ffprobe: string;

  constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {
    const v = config.media.video;
    this.ffmpeg = v.ffmpegPath ?? bundled('ffmpeg-static') ?? 'ffmpeg';
    this.ffprobe = v.ffprobePath ?? bundled('ffprobe-static') ?? 'ffprobe';
  }

  async probe(filePath: string): Promise<VideoProbe | null> {
    let out: string;
    try {
      out = await this.run(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], 60_000);
    } catch {
      return null; // not a media file ffprobe understands
    }
    const json = JSON.parse(out) as {
      streams?: Array<Record<string, unknown> & { codec_type?: string; disposition?: { attached_pic?: number } }>;
      format?: { format_name?: string; duration?: string; bit_rate?: string };
    };
    const video = json.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    if (!video) return null;
    const codec = String(video.codec_name ?? '');
    // Still images (cover art, PNG/JPEG sequences of one frame) are not videos.
    if (['mjpeg', 'png', 'bmp', 'gif', 'webp'].includes(codec) && Number(video.nb_frames ?? 0) <= 1) return null;
    const audio = json.streams?.find((s) => s.codec_type === 'audio');
    const sideRotation = (video.side_data_list as Array<{ rotation?: number }> | undefined)?.find((d) => typeof d.rotation === 'number')?.rotation;
    const tagRotation = Number((video.tags as Record<string, string> | undefined)?.rotate ?? 0);
    const rotation = ((Math.round(Number(sideRotation ?? tagRotation) || 0) % 360) + 360) % 360;
    const w = Number(video.width) || null;
    const h = Number(video.height) || null;
    const swap = rotation === 90 || rotation === 270;
    const duration = Number(json.format?.duration ?? video.duration);
    const bitRate = Number(json.format?.bit_rate);
    return {
      formatName: json.format?.format_name ?? '',
      videoCodec: codec,
      pixelFormat: (video.pix_fmt as string | undefined) ?? null,
      audioCodec: audio ? String(audio.codec_name ?? '') : null,
      rotation,
      width: swap ? h : w,
      height: swap ? w : h,
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
      bitRateKbps: Number.isFinite(bitRate) && bitRate > 0 ? Math.round(bitRate / 1000) : null,
    };
  }

  /** Output size: fits the configured landscape/portrait box, even dimensions, never upscaled. */
  targetSize(probe: VideoProbe): { width: number; height: number } | null {
    if (!probe.width || !probe.height) return null;
    const v = this.config.media.video;
    const long = Math.max(probe.width, probe.height);
    const short = Math.min(probe.width, probe.height);
    const scale = Math.min(1, v.maxLongSide / long, v.maxShortSide / short);
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    return { width: even(probe.width * scale), height: even(probe.height * scale) };
  }

  /** Already web-friendly and small enough: repackage without re-encoding (fast, lossless). */
  canRemux(probe: VideoProbe): boolean {
    const v = this.config.media.video;
    const target = this.targetSize(probe);
    return (
      /mp4|mov/.test(probe.formatName) &&
      probe.videoCodec === 'h264' &&
      probe.pixelFormat === 'yuv420p' &&
      (probe.audioCodec === null || probe.audioCodec === 'aac') &&
      probe.rotation === 0 &&
      !!target &&
      target.width === probe.width &&
      target.height === probe.height &&
      probe.bitRateKbps !== null &&
      probe.bitRateKbps <= v.maxBitrateKbps + v.audioBitrateKbps
    );
  }

  async compress(input: string, output: string, probe: VideoProbe, onProgress?: (percent: number) => void): Promise<'remuxed' | 'transcoded'> {
    try {
      return await this.encode(input, output, probe, true, onProgress);
    } catch (error) {
      if (probe.audioCodec === null) throw error;
      // Some phones add audio tracks ffmpeg cannot decode (e.g. Apple spatial audio): keep the video, drop the sound.
      this.logger.warn({ message: 'Compression with audio failed; retrying without audio', error: (error as Error).message });
      return this.encode(input, output, { ...probe, audioCodec: null }, false, onProgress);
    }
  }

  private async encode(input: string, output: string, probe: VideoProbe, withAudio: boolean, onProgress?: (percent: number) => void): Promise<'remuxed' | 'transcoded'> {
    const v = this.config.media.video;
    const common = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', ...(withAudio ? ['-map', '0:a:0?'] : ['-an']), '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart'];
    const progress = ['-progress', 'pipe:1', '-nostats'];
    if (this.canRemux(probe)) {
      await this.run(this.ffmpeg, [...common, '-c', 'copy', ...progress, '-f', 'mp4', output], this.timeout(probe), this.progressParser(probe, onProgress));
      return 'remuxed';
    }
    const target = this.targetSize(probe);
    const filters = [target ? `scale=${target.width}:${target.height}:flags=bicubic` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2', 'setsar=1', 'format=yuv420p'];
    await this.run(
      this.ffmpeg,
      [
        ...common,
        '-vf', filters.join(','),
        '-fpsmax', String(v.maxFps),
        '-c:v', 'libx264',
        '-preset', v.preset,
        '-crf', String(v.crf),
        '-maxrate', `${v.maxBitrateKbps}k`,
        '-bufsize', `${v.maxBitrateKbps * 2}k`,
        '-profile:v', 'high',
        ...(withAudio ? ['-c:a', 'aac', '-b:a', `${v.audioBitrateKbps}k`, '-ac', '2', '-ar', '48000'] : []),
        ...progress,
        '-f', 'mp4',
        output,
      ],
      this.timeout(probe),
      this.progressParser(probe, onProgress),
    );
    return 'transcoded';
  }

  /** Generous ceiling so a stuck process never blocks the queue forever. */
  private timeout(probe: VideoProbe) {
    return Math.max(10 * 60_000, (probe.durationMs ?? 0) * 20);
  }

  private progressParser(probe: VideoProbe, onProgress?: (percent: number) => void) {
    if (!onProgress || !probe.durationMs) return undefined;
    const total = probe.durationMs * 1000;
    return (chunk: string) => {
      const match = /out_time_(?:us|ms)=(\d+)/.exec(chunk);
      if (match) onProgress(Math.min(99, Math.max(0, Math.floor((Number(match[1]) / total) * 100))));
    };
  }

  async probeAudio(filePath: string): Promise<{ durationMs: number } | null> {
    let out: string;
    try {
      out = await this.run(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], 60_000);
    } catch {
      return null;
    }
    const json = JSON.parse(out) as {
      streams?: Array<{ codec_type?: string; duration?: string }>;
      format?: { duration?: string };
    };
    const audio = json.streams?.find((s) => s.codec_type === 'audio');
    const seconds = Number(audio?.duration ?? json.format?.duration);
    return audio && Number.isFinite(seconds) && seconds > 0 ? { durationMs: Math.round(seconds * 1000) } : null;
  }

  async clipAudio(input: string, output: string, startMs: number, durationMs: number): Promise<void> {
    await this.run(
      this.ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', (startMs / 1000).toFixed(3), '-t', (durationMs / 1000).toFixed(3), '-i', input,
        '-map', '0:a:0', '-vn', '-map_metadata', '-1',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-af', `afade=t=out:st=${Math.max(0, durationMs / 1000 - 0.6).toFixed(2)}:d=0.6`,
        '-movflags', '+faststart', '-f', 'mp4', output,
      ],
      120_000,
    );
  }

  async frame(input: string, output: string, atMs: number): Promise<void> {
    await this.run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (atMs / 1000).toFixed(3), '-i', input,
      '-frames:v', '1', '-vf', 'scale=1200:-2', '-q:v', '3', '-f', 'image2', output], 30_000);
  }

  async addSoundtrack(video: string, audio: string, output: string, options: { mix: boolean; durationMs: number }): Promise<void> {
    const seconds = Math.max(1, options.durationMs / 1000);
    const fade = `afade=t=out:st=${Math.max(0, seconds - 1).toFixed(2)}:d=1`;
    const audioMap = options.mix
      ? ['-filter_complex', `[0:a:0]volume=0.35[a0];[1:a:0]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${fade}[a]`, '-map', '0:v:0', '-map', '[a]']
      : ['-map', '0:v:0', '-map', '1:a:0', '-af', fade];
    await this.run(
      this.ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', video,
        '-stream_loop', '-1', '-i', audio,
        ...audioMap,
        '-t', seconds.toFixed(3),
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        '-map_metadata', '-1', '-movflags', '+faststart', '-f', 'mp4', output,
      ],
      300_000,
    );
  }

  private run(bin: string, args: string[], timeoutMs: number, onStdout?: (chunk: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${bin} timed out`));
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => {
        const s = d.toString();
        if (onStdout) onStdout(s);
        else stdout += s;
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else {
          this.logger.debug({ message: 'ffmpeg/ffprobe failed', code, stderr: stderr.slice(-800) });
          reject(new Error(stderr.trim().split('\n').pop() || `${bin} exited with code ${code}`));
        }
      });
    });
  }
}
