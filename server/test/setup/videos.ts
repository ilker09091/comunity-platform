import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const ffmpeg = process.env.FFMPEG_PATH || (require('ffmpeg-static') as string);
const dir = join(tmpdir(), 'community-platform-test-videos');

export interface TestVideo {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Generates (once, then cached) a real, decodable test clip with a moving test pattern and a tone.
 * `codec` args choose the encoding so tests can cover formats a phone or camera might produce.
 */
export function testVideo({
  width = 64,
  height = 64,
  seconds = 1,
  ext = 'mp4',
  codec = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
  fps = 10,
}: { width?: number; height?: number; seconds?: number; ext?: string; codec?: string[]; fps?: number } = {}): TestVideo {
  mkdirSync(dir, { recursive: true });
  const name = `clip-${width}x${height}-${seconds}s-${fps}fps-${codec.join('_').replace(/[^a-z0-9_]/gi, '')}.${ext}`;
  const path = join(dir, name);
  if (!existsSync(path))
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=duration=${seconds}:size=${width}x${height}:rate=${fps}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      ...codec,
      '-shortest',
      path,
    ]);
  const types: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo' };
  return { buffer: readFileSync(path), filename: name, contentType: types[ext] ?? 'application/octet-stream' };
}
