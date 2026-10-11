export interface VideoMetadata {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/**
 * Video processing abstraction (probing, transcoding, thumbnails). The default
 * implementation stores the validated original untouched; plug in an ffmpeg- or
 * cloud-transcoder-backed implementation for production.
 */
export interface VideoProcessor {
  process(filePath: string, mimeType: string): Promise<VideoMetadata>;
}

export const VIDEO_PROCESSOR = Symbol('VIDEO_PROCESSOR');

export class PassthroughVideoProcessor implements VideoProcessor {
  async process(): Promise<VideoMetadata> {
    return { width: null, height: null, durationMs: null };
  }
}
