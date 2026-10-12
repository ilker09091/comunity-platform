/** Milestone observer: progressing foreground playback only, no per-frame API writes. */
export type WatchKind = 'VIDEO_START' | 'WATCH_MILESTONE' | 'VIDEO_COMPLETE' | 'VIDEO_REPLAY' | 'VIDEO_SKIP';
export type WatchDelta = { type: WatchKind; watchedMs: number; positionMs: number; durationMs: number };
export type PlaybackSignal = 'playing' | 'tick' | 'pause' | 'waiting' | 'seeking' | 'ended';
export type PlaybackSample = { currentTime: number; duration: number; paused: boolean; seeking: boolean };

export class ReelWatchObserver {
  private started = false;
  private playing = false;
  private anchor: number | null = null;
  private position = 0;
  private duration = 0;
  private pending = 0;
  private total = 0;
  private loopTime = 0;
  private meaningful = false;
  private completed = false;
  private closed = false;
  constructor(private readonly send: (event: WatchDelta) => void) {}
  private emit(type: WatchKind, position = this.position) {
    if (!this.duration || !this.started) return;
    this.send({ type, watchedMs: Math.min(15000, Math.round(this.pending)), positionMs: Math.round(position), durationMs: Math.round(this.duration) });
    this.pending = 0;
  }
  observe(kind: PlaybackSignal, sample: PlaybackSample, now: number, visible = true) {
    if (this.closed || !Number.isFinite(sample.duration) || sample.duration <= 0) return;
    this.duration = sample.duration * 1000;
    const position = Math.max(0, sample.currentTime * 1000);
    const progressing = visible && !sample.paused && !sample.seeking && kind !== 'waiting' && kind !== 'seeking';
    if (!this.started && progressing && (kind === 'playing' || kind === 'tick')) {
      this.started = true; this.position = position; this.emit('VIDEO_START');
    }
    const elapsed = this.anchor === null ? 0 : Math.max(0, now - this.anchor);
    const advance = position - this.position;
    const wrap = this.playing && this.position >= this.duration * .5 && position <= this.duration * .4 && advance < 0;
    if (this.playing && visible && !sample.seeking && kind !== 'seeking' && kind !== 'waiting') {
      const moved = wrap ? this.duration - this.position + position : advance;
      // Seeking, stalled clocks and delayed/background ticks must not manufacture watched time.
      if (moved > 0 && moved <= elapsed * 1.5 + 400 && elapsed <= 2000) {
        const credit = Math.min(elapsed, moved + 100);
        this.pending += credit; this.total += credit; this.loopTime += credit;
      }
    }
    if (visible && !sample.seeking && kind !== 'seeking' && kind !== 'waiting' && this.started && !this.completed && this.loopTime >= this.duration * (this.duration<2000?.95:this.duration>60000?.9:.85) && (position >= this.duration * (this.duration<2000?.95:this.duration>60000?.9:.85) || wrap || kind === 'ended')) {
      this.emit('VIDEO_COMPLETE', wrap ? this.duration : position); this.completed = true;
    }
    if (wrap) {
      if (this.completed) this.emit('VIDEO_REPLAY', position);
      this.completed = false; this.loopTime = 0;
    }
    this.position = position;
    const threshold = Math.max(250,Math.min(8000,this.duration<4000?this.duration*.5:Math.max(2000,this.duration*.1)));
    if (this.started && !this.meaningful && this.total >= threshold) { this.emit('WATCH_MILESTONE'); this.meaningful = true; }
    else if (this.pending >= 5000) this.emit('WATCH_MILESTONE');
    if (kind === 'pause' || kind === 'waiting' || kind === 'seeking' || !visible) {
      if (this.pending >= 250) this.emit('WATCH_MILESTONE');
      this.playing = false; this.anchor = null;
    } else { this.playing = progressing; this.anchor = progressing ? now : null; }
  }
  finish() { if (this.closed) return; this.emit('VIDEO_SKIP'); this.closed = true; }
}
