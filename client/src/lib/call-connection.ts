/** Media stays on the peers; the authenticated API only carries SDP/ICE. */
export type CallSignal = { kind: "description" | "ice"; payload: string };
export type VideoSource = "none" | "camera";
/**
 * Camera and screen travel on separate transceivers (Discord-style), so both can be live at once.
 * The data channel reports each side's camera/screen state; frozen frames are never trusted.
 */
export type CallMediaState = {
  localSource: VideoSource; remoteSource: VideoSource;
  localScreen: boolean; remoteScreen: boolean; remoteScreenAudio: boolean;
};
export type CallScreens = { local: MediaStream | null; remote: MediaStream | null };
export type ScreenStats = { width: number; height: number; fps: number };
export const NO_CALL_MEDIA: CallMediaState = { localSource: "none", remoteSource: "none", localScreen: false, remoteScreen: false, remoteScreenAudio: false };
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
  /** The other person's screen (video, plus its sound when they shared it). */
  readonly remoteScreen = new MediaStream();
  private videoSender?: RTCRtpSender;
  private audioSender?: RTCRtpSender;
  private screenVideoSender?: RTCRtpSender;
  private screenAudioSender?: RTCRtpSender;
  private screenReceiver?: RTCRtpReceiver;
  private capture: MediaStream | null = null;
  private remoteScreenOn = false;
  private remoteScreenAudio = false;
  private screenRevision = 0;
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
  private facing: "user" | "environment" = "user";
  private sourceRevision = 0;
  private screenQuality: ScreenQuality = '1080p30';

  constructor(config: RTCConfiguration, private local: MediaStream, private outgoing: boolean,
    private send: (signal: CallSignal) => Promise<unknown>,
    private changed: (state: RTCPeerConnectionState) => void,
    private failed: (error: Error) => void,
    private streamsChanged: (stream: MediaStream) => void,
    private mediaChanged: (state: CallMediaState) => void = () => {},
    private screensChanged: (screens: CallScreens) => void = () => {}) {
    this.localSource = local.getVideoTracks().length ? "camera" : "none";
    this.negotiated = outgoing;
    this.pc = new RTCPeerConnection(config);
    for (const track of local.getVideoTracks()) this.watchCamera(track);
    for (const track of local.getAudioTracks()) this.audioSender = this.pc.addTrack(track, local);
    if (outgoing) this.videoSender = this.pc.addTransceiver(local.getVideoTracks()[0] ?? "video", { direction: "sendrecv", streams: [local] }).sender;
    this.pc.onicecandidate = event => { if (event.candidate) this.emit({ kind: "ice", payload: JSON.stringify(event.candidate.toJSON()) }); };
    this.pc.ontrack = event => {
      if (this.closed) return;
      // The first transceiver of each kind is the microphone/camera; later ones carry a screen.
      const kind = event.track.kind;
      const main = this.pc.getTransceivers().find(value => value.receiver.track.kind === kind) === event.transceiver;
      if (!main) {
        if (kind === "video") this.screenReceiver = event.receiver;
        if (!this.remoteScreen.getTracks().some(track => track.id === event.track.id)) {
          this.remoteScreen.addTrack(event.track);
          this.emitScreens();
        }
        return;
      }
      if (!this.remote.getTracks().some(track => track.id === event.track.id)) {
        this.remote.addTrack(event.track);
        this.streamsChanged(new MediaStream(this.remote.getTracks()));
      }
      if (kind === "video") {
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
        const message = JSON.parse(event.data) as { type?: string; source?: string; screen?: unknown; screenAudio?: unknown };
        if (message.type !== "video-source" || !["none", "camera", "screen"].includes(message.source ?? "")) return;
        this.peerReportedSource = true;
        // "screen" comes from an older app that sent its screen on the camera transceiver.
        this.remoteSource = message.source === "none" ? "none" : "camera";
        const screen = message.screen === true;
        if (screen !== this.remoteScreenOn) { this.remoteScreenOn = screen; this.emitScreens(); }
        this.remoteScreenAudio = screen && message.screenAudio === true;
        this.mediaChanged(this.state());
      } catch { /* Ignore unsupported control messages. */ }
    };
  }
  private state(): CallMediaState {
    return { localSource: this.localSource, remoteSource: this.remoteSource, localScreen: !!this.capture,
      remoteScreen: this.remoteScreenOn, remoteScreenAudio: this.remoteScreenAudio };
  }
  private emitScreens() {
    if (this.closed) return;
    this.screensChanged({
      local: this.capture ? new MediaStream(this.capture.getVideoTracks()) : null,
      remote: this.remoteScreenOn ? new MediaStream(this.remoteScreen.getTracks()) : null,
    });
  }
  private notifyMedia() {
    if (this.closed) return;
    this.mediaChanged(this.state());
    const screenAudio = !!this.capture?.getAudioTracks().some(track => track.readyState === "live");
    if (this.channel?.readyState === "open")
      this.channel.send(JSON.stringify({ type: "video-source", source: this.localSource, screen: !!this.capture, screenAudio }));
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
    await this.videoQuality();
    await this.screenSenderQuality();
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
  private async tune(sender: RTCRtpSender | undefined, maxBitrate: number, maxFramerate: number, preference: RTCDegradationPreference) {
    if (!sender || this.closed) return;
    try {
      const parameters = sender.getParameters();
      parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      parameters.encodings[0].maxBitrate = maxBitrate;
      parameters.encodings[0].maxFramerate = maxFramerate;
      parameters.degradationPreference = preference;
      await sender.setParameters(parameters);
    } catch { /* Keep browser defaults when sender tuning is unsupported. */ }
  }
  /** While a screen is live the camera steps down, leaving the bandwidth to the screen. */
  private videoQuality() { return this.tune(this.videoSender, this.capture ? 900_000 : 2_500_000, 30, "balanced"); }
  private screenSenderQuality() {
    if (!this.capture) return Promise.resolve();
    const preset = screenPreset(this.screenQuality);
    return this.tune(this.screenVideoSender, preset.bitrate, preset.fps, "maintain-resolution");
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
    await this.videoQuality();
  }
  async camera(enabled: boolean, facingMode: "user" | "environment" = "user") {
    if (this.closed) return;
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
    const capture = this.capture, track = capture?.getVideoTracks()[0], revision = this.screenRevision;
    if (this.closed || !track || track.readyState !== "live") return false;
    await track.applyConstraints(screenConstraints(quality));
    if (this.closed || revision !== this.screenRevision || this.capture !== capture) return false;
    this.screenQuality = quality;
    await this.screenSenderQuality();
    return true;
  }
  /** Shares a screen/window/tab next to the camera; its sound comes along when the picker allows it. */
  async shareScreen(quality: ScreenQuality = this.screenQuality) {
    if (this.closed || this.capture) return;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is not supported by this browser.");
    if (!this.negotiated) throw new Error("Wait until the call connects before sharing your screen.");
    const revision = ++this.screenRevision;
    const capture = await navigator.mediaDevices.getDisplayMedia({ video: screenConstraints(quality), audio: true, systemAudio: "include" } as DisplayMediaStreamOptions);
    const release = () => capture.getTracks().forEach(track => track.stop());
    if (this.closed || revision !== this.screenRevision) { release(); return; }
    const video = capture.getVideoTracks()[0], audio = capture.getAudioTracks()[0] ?? null;
    if (!video) { release(); return; }
    video.contentHint = "detail";
    try {
      // Senders are created once and reused, so sharing again needs no renegotiation.
      if (this.screenVideoSender) await this.screenVideoSender.replaceTrack(video);
      else this.screenVideoSender = this.pc.addTransceiver(video, { direction: "sendonly", streams: [capture] }).sender;
      if (audio && this.screenAudioSender) await this.screenAudioSender.replaceTrack(audio);
      else if (audio) this.screenAudioSender = this.pc.addTransceiver(audio, { direction: "sendonly", streams: [capture] }).sender;
      else await this.screenAudioSender?.replaceTrack(null);
    } catch (error) { release(); throw error; }
    if (this.closed || revision !== this.screenRevision) { release(); return; }
    this.capture = capture;
    this.screenQuality = quality;
    this.notifyMedia(); this.emitScreens();
    await this.videoQuality(); await this.screenSenderQuality();
    // The browser's own "Stop sharing" bar ends the capture without our button.
    const ended = () => { if (this.capture === capture) void this.stopSharing().catch(() => {}); };
    video.addEventListener("ended", ended, { once: true });
    if (video.readyState === "ended") ended();
  }
  async stopSharing() {
    const capture = this.capture;
    if (this.closed || !capture) return;
    ++this.screenRevision; this.capture = null;
    await Promise.all([this.screenVideoSender?.replaceTrack(null), this.screenAudioSender?.replaceTrack(null)].map(work => work?.catch(() => {})));
    capture.getTracks().forEach(track => track.stop());
    this.notifyMedia(); this.emitScreens();
    await this.videoQuality();
  }
  /** Received resolution/frame rate of the other person's screen, for the stream info badge. */
  async screenStats(): Promise<ScreenStats | null> {
    if (this.closed || !this.screenReceiver) return null;
    try {
      let result: ScreenStats | null = null;
      (await this.screenReceiver.getStats()).forEach(report => {
        if (report.type === "inbound-rtp" && report.kind === "video" && report.frameWidth)
          result = { width: report.frameWidth, height: report.frameHeight, fps: Math.round(report.framesPerSecond ?? 0) };
      });
      return result;
    } catch { return null; }
  }
  close() {
    if (this.closed) return;
    this.closed = true; ++this.sourceRevision; ++this.screenRevision; this.clearRecovery();
    for (const [timer, resolve] of this.delays) { clearTimeout(timer); resolve(); } this.delays.clear();
    if (this.channel) { this.channel.onmessage = null; this.channel.onopen = null; this.channel.close(); }
    this.pc.onicecandidate = null; this.pc.ontrack = null; this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null; this.pc.oniceconnectionstatechange = null; this.pc.ondatachannel = null;
    this.pc.close(); this.local.getTracks().forEach(track => track.stop()); this.remote.getTracks().forEach(track => track.stop());
    this.capture?.getTracks().forEach(track => track.stop()); this.capture = null;
    this.remoteScreen.getTracks().forEach(track => track.stop());
    this.candidates = [];
  }
}
