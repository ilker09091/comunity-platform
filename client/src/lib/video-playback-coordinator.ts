export type PlaybackMode = "feed" | "reels";
type RecordEntry = {
  video: HTMLVideoElement; mode: PlaybackMode; route: string; requested: boolean;
  ratio: number; seen: number; manual: boolean; source: boolean;
  select: (active: boolean, manual: boolean) => void;
  visibility: (ratio: number) => void; sourcePermission: (allowed: boolean) => void;
  audioPreference?: (muted: boolean) => void;
};

/** One observer and one playback owner for every feed, detail and Reels video. */
export class VideoPlaybackCoordinator {
  private entries = new Map<HTMLVideoElement, RecordEntry>();
  private owner: RecordEntry | null = null;
  private stableFeed: RecordEntry | null = null;
  private observer: IntersectionObserver | null = null;
  private mutations: MutationObserver | null = null;
  private route: string | null = null;
  private serial = 0;
  private refresh = () => this.choose();
  private blocked() { return document.hidden || !!document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]'); }
  setRoute(route: string) {
    if (this.route === route) return;
    this.route = route;
    this.stableFeed = null;
    for (const entry of this.entries.values()) entry.manual = false;
    this.choose();
  }
  register(video: HTMLVideoElement, options: Omit<RecordEntry, "video" | "ratio" | "seen" | "manual" | "source">) {
    if (!this.entries.size) {
      if (typeof IntersectionObserver !== "undefined") this.observer = new IntersectionObserver((changes) => {
        for (const change of changes) {
          const entry = this.entries.get(change.target as HTMLVideoElement);
          if (!entry) continue;
          entry.ratio = change.isIntersecting ? change.intersectionRatio : 0;
          if (entry.ratio > 0) entry.seen = ++this.serial;
          if (entry.ratio < .01) entry.manual = false;
          entry.visibility(entry.ratio);
        }
        this.choose();
      }, { threshold: [0, .01, .15, .25, .45, .6, .75, .9, 1] });
      document.addEventListener("visibilitychange", this.refresh);
      this.mutations = new MutationObserver((changes) => {
        // Watch native modal state, including dialogs inserted already open.
        if (changes.some(c => c.type === "attributes" || [...c.addedNodes, ...c.removedNodes].some(n => n instanceof Element && (n.matches('dialog,[role="dialog"]') || n.querySelector('dialog,[role="dialog"]'))))) this.choose();
      });
      this.mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "role", "aria-modal"] });
    }
    this.route ??= options.route;
    const entry: RecordEntry = { ...options, video, ratio: this.observer ? 0 : options.mode === "reels" ? 1 : 0, seen: 0, manual: false, source: false };
    this.entries.set(video, entry);
    this.observer?.observe(video);
    this.choose();
    return () => {
      this.observer?.unobserve(video);
      video.pause();
      if (this.owner === entry) { entry.select(false, false); this.owner = null; }
      if (this.stableFeed === entry) this.stableFeed = null;
      this.entries.delete(video);
      this.choose();
      if (!this.entries.size) {
        this.observer?.disconnect(); this.observer = null;
        this.mutations?.disconnect(); this.mutations = null;
        document.removeEventListener("visibilitychange", this.refresh);
        this.route = null;
      }
    };
  }
  update(video: HTMLVideoElement, requested: boolean) {
    const entry = this.entries.get(video);
    if (entry) { entry.requested = requested; if (!requested && entry.mode === "reels") entry.manual = false; this.choose(); }
  }
  owns(video: HTMLVideoElement) { return this.owner?.video === video && !this.blocked(); }
  applyAudioPreference(muted: boolean, volume = 1) {
    for (const entry of this.entries.values()) {
      entry.video.muted = muted;
      entry.video.volume = volume;
      entry.audioPreference?.(muted);
    }
  }
  claim(video: HTMLVideoElement) {
    const entry = this.entries.get(video);
    if (!entry || this.blocked() || entry.route !== this.route) return false;
    for (const candidate of this.entries.values()) candidate.manual = false;
    entry.manual = true; entry.seen = ++this.serial;
    this.select(entry, true); this.budget();
    return true;
  }
  private select(next: RecordEntry | null, manual = false) {
    if (this.owner === next) return;
    const previous = this.owner;
    this.owner = next;
    if (next?.mode === "feed") this.stableFeed = next;
    if (previous) { previous.video.pause(); previous.select(false, false); }
    if (next) next.select(true, manual);
  }
  private choose() {
    const candidates = [...this.entries.values()].filter(e => e.route === this.route);
    let next: RecordEntry | null = null;
    if (!this.blocked()) {
      next = candidates.find(e => e.mode === "reels" && e.requested && e.ratio >= .25) ?? null;
      next ??= candidates.find(e => e.manual && e.ratio >= .01) ?? null;
      if (!next) {
        const eligible = candidates.filter(e => e.mode === "feed" && e.ratio >= .6).sort((a,b) => b.ratio - a.ratio);
        next = eligible[0] ?? null;
        // Hysteresis: retain the current player until it exits or a clearly more visible player arrives.
        const stable = this.owner?.mode === "feed" ? this.owner : this.stableFeed;
        if (stable && stable.route === this.route && stable.ratio >= .45 && (!next || next.ratio < stable.ratio + .12)) next = stable;
      }
    }
    this.select(next); this.budget();
  }
  private budget() {
    const feeds = [...this.entries.values()].filter(e => e.mode === "feed" && e.route === this.route && (e.ratio > 0 || e.seen > 0 || e.manual));
    feeds.sort((a,b) => Number(b === this.owner) - Number(a === this.owner) || b.ratio - a.ratio || b.seen - a.seen);
    const allowed = new Set(feeds.slice(0, 3));
    for (const entry of this.entries.values()) {
      const source = entry.route === this.route && (entry.mode === "reels" || allowed.has(entry));
      if (source !== entry.source) { entry.source = source; entry.sourcePermission(source); }
    }
  }
}
export const videoPlayback = new VideoPlaybackCoordinator();

export function fitVideoBounds(ratio: number, width: number, height: number) {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const w = Math.max(1, Math.min(1200, width, height * safeRatio));
  return { width: w, height: w / safeRatio };
}
export function prefersReducedData() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "") || !!window.matchMedia?.("(prefers-reduced-data: reduce)").matches;
}
