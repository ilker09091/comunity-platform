/** Media stays on the peers; the authenticated API only carries SDP/ICE. */
export type CallSignal = { kind: "description" | "ice"; payload: string };
export type VideoSource = "none" | "camera" | "screen";
export type CallMediaState = { localSource: VideoSource; remoteSource: VideoSource };
export const SCREEN_QUALITIES = [
  { id: '720p30', resolution: '720p', fps: 30, width: 1280, height: 720, bitrate: 3_500_000 },
  { id: '720p60', resolution: '720p', fps: 60, width: 1280, height: 720, bitrate: 6_000_000 },
  { id: '1080p30', resolution: '1080p', fps: 30, width: 1920, height: 1080, bitrate: 6_000_000 },
  { id: '1080p60', resolution: '1080p', fps: 60, width: 1920, height: 1080, bitrate: 10_000_000 },
] as const;
export type ScreenQuality = typeof SCREEN_QUALITIES[number]['id'];
const screenPreset = (quality: ScreenQuality) => SCREEN_QUALITIES.find(value => value.id === quality)!;
function screenConstraints(quality: ScreenQuality): MediaTrackConstraints {
  const preset = screenPreset(quality);
  return { width: { ideal: preset.width, max: preset.width }, height: { ideal: preset.height, max: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps } };
}

export class CallConnection {
  readonly pc: RTCPeerConnection;
  readonly remote = new MediaStream();
  private videoSender?: RTCRtpSender;
  private audioSender?: RTCRtpSender;
  private closed = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingAnswer = false;
  private negotiated: boolean;
  private outbound = Promise.resolve();
  private candidates: RTCIceCandidateInit[] = [];
  private recovery: ReturnType<typeof setTimeout> | undefined;
  private recoveryStarted = 0;
  private restarts = 0;
  private lastRestart = 0;
  private delays = new Map<ReturnType<typeof setTimeout>, () => void>();
  private channel: RTCDataChannel | null = null;
  private peerReportedSource = false;
  private localSource: VideoSource;
  private remoteSource: VideoSource = "none";
  private resumeCamera = false;
  private facing: "user" | "environment" = "user";
  private sourceRevision = 0;
  private screenQuality: ScreenQuality = '1080p30';

  constructor(config: RTCConfiguration, private local: MediaStream, private outgoing: boolean,
    private send: (signal: CallSignal) => Promise<unknown>,
    private changed: (state: RTCPeerConnectionState) => void,
    private failed: (error: Error) => void,
    private streamsChanged: (stream: MediaStream) => void,
    private mediaChanged: (state: CallMediaState) => void = () => {}) {
    this.localSource = local.getVideoTracks().length ? "camera" : "none";
    this.negotiated = outgoing;
    this.pc = new RTCPeerConnection(config);
    for (const track of local.getVideoTracks()) this.watchCamera(track);
    for (const track of local.getAudioTracks()) this.audioSender = this.pc.addTrack(track, local);
    if (outgoing) this.videoSender = this.pc.addTransceiver(local.getVideoTracks()[0] ?? "video", { direction: "sendrecv", streams: [local] }).sender;
    this.pc.onicecandidate = event => { if (event.candidate) this.emit({ kind: "ice", payload: JSON.stringify(event.candidate.toJSON()) }); };
    this.pc.ontrack = event => {
      if (this.closed) return;
      if (!this.remote.getTracks().some(track => track.id === event.track.id)) {
        this.remote.addTrack(event.track);
        this.streamsChanged(new MediaStream(this.remote.getTracks()));
      }
      if (event.track.kind === "video") {
        const refresh = () => {
          if (!this.peerReportedSource && !this.closed) {
            this.remoteSource = event.track.readyState === "live" && !event.track.muted ? "camera" : "none";
            this.notifyMedia();
          }
        };
        event.track.addEventListener("mute", refresh);
        event.track.addEventListener("unmute", refresh);
        event.track.addEventListener("ended", refresh, { once: true });
        refresh();
      }
    };
    this.pc.ondatachannel = event => { if (event.channel.label === "circle-media") this.bindChannel(event.channel); };
    if (outgoing) this.bindChannel(this.pc.createDataChannel("circle-media"));
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      const state = this.pc.connectionState;
      if (state === "connected") { this.clearRecovery(); this.changed(state); this.notifyMedia(); }
      else if (state === "failed") this.recover();
      else if (state === "disconnected") { this.changed(state); this.scheduleRecovery(2500); }
      else this.changed(state);
    };
    this.pc.oniceconnectionstatechange = () => {
      if (this.closed) return;
      if (this.pc.iceConnectionState === "failed") this.recover();
      else if (this.pc.iceConnectionState === "disconnected") this.scheduleRecovery(2500);
    };
    this.pc.onnegotiationneeded = () => { if (this.negotiated) void this.offer(); };
    this.scheduleRecovery(15000);
  }
  private bindChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => this.notifyMedia();
    channel.onmessage = event => {
      if (this.closed || typeof event.data !== "string" || event.data.length > 256) return;
      try {
        const message = JSON.parse(event.data) as { type?: string; source?: VideoSource };
        if (message.type !== "video-source" || !["none", "camera", "screen"].includes(message.source ?? "")) return;
        this.peerReportedSource = true;
        this.remoteSource = message.source!;
        this.mediaChanged({ localSource: this.localSource, remoteSource: this.remoteSource });
      } catch { /* Ignore unsupported control messages. */ }
    };
  }
  private notifyMedia() {
    if (this.closed) return;
    this.mediaChanged({ localSource: this.localSource, remoteSource: this.remoteSource });
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify({ type: "video-source", source: this.localSource }));
  }
  private pause(ms: number) {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.delays.delete(timer); resolve(); }, ms);
      this.delays.set(timer, resolve);
    });
  }
  private emit(signal: CallSignal) {
    this.outbound = this.outbound.then(async () => {
      const started = Date.now(); let attempt = 0;
      while (!this.closed) {
        try { await this.send(signal); return; }
        catch (error) {
          if (this.closed) return;
          const status = (error as { status?: number })?.status;
          if ((status && status >= 400 && status < 500 && ![408, 429].includes(status)) || Date.now() - started > 25000) throw error;
          await this.pause(Math.min(4000, 500 * 2 ** attempt++));
        }
      }
    }).catch(error => { if (!this.closed) this.failed(error instanceof Error ? error : new Error("Call signaling failed")); });
  }
  private async offer() {
    if (this.closed || this.makingOffer || this.pc.signalingState !== "stable") return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (!this.closed) this.emit({ kind: "description", payload: JSON.stringify(this.pc.localDescription) });
    } catch (error) { if (!this.closed) this.failed(error as Error); }
    finally { this.makingOffer = false; }
  }
  private clearRecovery() {
    clearTimeout(this.recovery); this.recovery = undefined;
    this.recoveryStarted = 0; this.restarts = 0;
  }
  private scheduleRecovery(ms: number) {
    if (this.closed || this.recovery) return;
    this.recovery = setTimeout(() => { this.recovery = undefined; this.recover(); }, ms);
  }
  /** Recover transient Wi-Fi/mobile handovers rather than hanging up on the first ICE failure. */
  recover(force = false) {
    if (this.closed) return;
    if (this.pc.connectionState === "connected" && !force) { this.clearRecovery(); this.changed("connected"); return; }
    this.recoveryStarted ||= Date.now();
    if (Date.now() - this.recoveryStarted >= 55000) {
      this.failed(new Error("The call could not reconnect. Check your connection and try again.")); return;
    }
    this.changed("disconnected");
    if (this.negotiated && this.restarts < 3 && Date.now() - this.lastRestart > 4000) {
      this.lastRestart = Date.now(); this.restarts++;
      this.pc.restartIce();
    }
    this.scheduleRecovery(12000);
  }
  async receive(signal: CallSignal) {
    if (this.closed) return;
    if (signal.kind === "ice") {
      if (this.ignoreOffer) return;
      const candidate: RTCIceCandidateInit = JSON.parse(signal.payload);
      if (!this.pc.remoteDescription) this.candidates.push(candidate);
      else await this.pc.addIceCandidate(candidate);
      return;
    }
    const description: RTCSessionDescriptionInit = JSON.parse(signal.payload);
    // A committed signaling POST can be retried after a lost HTTP response.
    if (this.pc.remoteDescription?.type === description.type && this.pc.remoteDescription.sdp === description.sdp) return;
    const ready = !this.makingOffer && (this.pc.signalingState === "stable" || this.settingAnswer);
    this.ignoreOffer = this.outgoing && description.type === "offer" && !ready;
    if (this.ignoreOffer) return;
    this.settingAnswer = description.type === "answer";
    try { await this.pc.setRemoteDescription(description); } finally { this.settingAnswer = false; }
    if (this.closed) return;
    if (!this.videoSender) {
      const video = this.pc.getTransceivers().find(track => track.receiver.track.kind === "video");
      if (video) { this.videoSender = video.sender; video.direction = "sendrecv"; await video.sender.replaceTrack(this.local.getVideoTracks()[0] ?? null); }
    }
    for (const candidate of this.candidates.splice(0)) await this.pc.addIceCandidate(candidate);
    if (description.type === "offer") {
      await this.pc.setLocalDescription();
      this.emit({ kind: "description", payload: JSON.stringify(this.pc.localDescription) });
    }
    this.negotiated = true;
    await this.videoQuality(this.localSource);
  }
  async replaceAudio(track: MediaStreamTrack) { if (!this.closed) await this.audioSender?.replaceTrack(track); }
  mute(muted: boolean) { this.local.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  private watchCamera(track: MediaStreamTrack) {
    // OS/browser revocation can end capture without a click on our camera button.
    track.addEventListener("ended", () => {
      if (!this.closed && this.localSource === "camera" && this.videoSender?.track?.id === track.id)
        void this.replaceVideo(null, "none").catch(() => {});
    }, { once: true });
  }
  private async videoQuality(source: VideoSource) {
    if (!this.videoSender || this.closed) return;
    try {
      const parameters = this.videoSender.getParameters();
      parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      const preset = screenPreset(this.screenQuality);
      parameters.encodings[0].maxBitrate = source === "screen" ? preset.bitrate : 2_500_000;
      parameters.encodings[0].maxFramerate = source === "screen" ? preset.fps : 30;
      parameters.degradationPreference = source === "screen" ? "maintain-resolution" : "balanced";
      await this.videoSender.setParameters(parameters);
    } catch { /* Keep browser defaults when sender tuning is unsupported. */ }
  }
  private async replaceVideo(track: MediaStreamTrack | null, source: VideoSource) {
    if (this.closed) { track?.stop(); return; }
    if (!this.videoSender) { track?.stop(); throw new Error("Wait until the call connects before enabling video."); }
    try { await this.videoSender.replaceTrack(track); }
    catch (error) { track?.stop(); throw error; }
    if (this.closed) { track?.stop(); return; }
    for (const old of this.local.getVideoTracks()) if (old.id !== track?.id) { this.local.removeTrack(old); old.stop(); }
    if (track && !this.local.getVideoTracks().some(old => old.id === track.id)) this.local.addTrack(track);
    this.localSource = source; this.notifyMedia();
    await this.videoQuality(source);
  }
  async camera(enabled: boolean, facingMode: "user" | "environment" = "user") {
    if (this.closed) return;
    if (this.localSource === "screen") throw new Error("Stop sharing your screen before turning on the camera.");
    const revision = ++this.sourceRevision;
    this.facing = facingMode;
    if (!enabled) { await this.replaceVideo(null, "none"); return; }
    const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (this.closed || revision !== this.sourceRevision) { media.getTracks().forEach(track => track.stop()); return; }
    const track = media.getVideoTracks()[0];
    if (!track || track.readyState === "ended") { media.getTracks().forEach(value => value.stop()); throw new Error("The camera stopped. Try enabling it again."); }
    this.watchCamera(track);
    await this.replaceVideo(track, "camera");
  }
  async setScreenQuality(quality: ScreenQuality) {
    const track = this.local.getVideoTracks()[0], revision = this.sourceRevision;
    if (this.closed || this.localSource !== 'screen' || !track || track.readyState !== 'live') return false;
    await track.applyConstraints(screenConstraints(quality));
    if (this.closed || revision !== this.sourceRevision || this.localSource !== 'screen') return false;
    this.screenQuality = quality;
    await this.videoQuality('screen');
    return true;
  }
  async shareScreen(quality: ScreenQuality = this.screenQuality) {
    if (this.closed || this.localSource === "screen") return;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is not supported by this browser.");
    const revision = ++this.sourceRevision;
    const capture = await navigator.mediaDevices.getDisplayMedia({ video: screenConstraints(quality), audio: false });
    if (this.closed || revision !== this.sourceRevision) { capture.getTracks().forEach(track => track.stop()); return; }
    const track = capture.getVideoTracks()[0];
    if (!track) { capture.getTracks().forEach(track => track.stop()); return; }
    this.resumeCamera = this.localSource === "camera";
    this.screenQuality = quality;
    track.contentHint = "detail";
    await this.replaceVideo(track, "screen");
    const ended = () => { if (!this.closed && this.localSource === "screen") void this.stopSharing().catch(() => {}); };
    track.addEventListener("ended", ended, { once: true });
    if (track.readyState === "ended") ended();
  }
  async stopSharing() {
    if (this.closed || this.localSource !== "screen") return;
    const restore = this.resumeCamera; this.resumeCamera = false;
    ++this.sourceRevision;
    await this.replaceVideo(null, "none");
    if (restore && !this.closed) await this.camera(true, this.facing);
  }
  close() {
    if (this.closed) return;
    this.closed = true; ++this.sourceRevision; this.clearRecovery();
    for (const [timer, resolve] of this.delays) { clearTimeout(timer); resolve(); } this.delays.clear();
    if (this.channel) { this.channel.onmessage = null; this.channel.onopen = null; this.channel.close(); }
    this.pc.onicecandidate = null; this.pc.ontrack = null; this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null; this.pc.oniceconnectionstatechange = null; this.pc.ondatachannel = null;
    this.pc.close(); this.local.getTracks().forEach(track => track.stop()); this.remote.getTracks().forEach(track => track.stop());
    this.candidates = [];
  }
}
