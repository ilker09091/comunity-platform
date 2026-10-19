/** Media lives only in the peers. The authenticated API transports SDP/ICE, never audio/video. */
export type CallSignal = { kind: "description" | "ice"; payload: string };
export class CallConnection {
  readonly pc: RTCPeerConnection;
  readonly remote = new MediaStream();
  private local: MediaStream;
  private videoSender?: RTCRtpSender;
  private closed = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingAnswer = false;
  private negotiated: boolean;
  private outbound = Promise.resolve();
  private candidates: RTCIceCandidateInit[] = [];
  private recovery: ReturnType<typeof setTimeout> | undefined;

  constructor(config: RTCConfiguration, stream: MediaStream, private outgoing: boolean,
    private send: (signal: CallSignal) => Promise<unknown>,
    private changed: (state: RTCPeerConnectionState) => void,
    private failed: (error: Error) => void,
    private streamsChanged: (stream: MediaStream) => void) {
    this.local = stream;
    this.negotiated = outgoing;
    this.pc = new RTCPeerConnection(config);
    for (const track of stream.getAudioTracks()) this.pc.addTrack(track, stream);
    if(outgoing)this.videoSender = this.pc.addTransceiver(stream.getVideoTracks()[0] ?? "video", {direction:"sendrecv",streams:[stream]}).sender;
    this.pc.onicecandidate = event => {
      if (event.candidate) this.emit({kind:"ice",payload:JSON.stringify(event.candidate.toJSON())});
    };
    this.pc.ontrack = event => {
      if(this.closed)return;
      if (!this.remote.getTracks().some(t => t.id === event.track.id)) {
        this.remote.addTrack(event.track);
        // MediaStream.addTrack() does not emit addtrack. Notify the view explicitly.
        this.streamsChanged(new MediaStream(this.remote.getTracks()));
      }
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      this.changed(this.pc.connectionState);
      clearTimeout(this.recovery);
      if (this.pc.connectionState === "failed") this.failed(new Error("The call could not connect. Please try again."));
      if (this.pc.connectionState === "disconnected") this.recovery = setTimeout(() => {
        if (!this.closed && this.pc.connectionState !== "connected") this.failed(new Error("The call lost its connection."));
      }, 20000);
    };
    this.pc.onnegotiationneeded = () => { if (this.negotiated) void this.offer(); };
  }
  private emit(signal: CallSignal) {
    this.outbound = this.outbound.then(async () => { if (!this.closed) await this.send(signal); })
      .catch(error => { if (!this.closed) this.failed(error instanceof Error ? error : new Error("Call signaling failed")); });
  }
  private async offer() {
    if (this.closed || this.makingOffer) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (!this.closed) this.emit({kind:"description",payload:JSON.stringify(this.pc.localDescription)});
    } catch(error) { if (!this.closed) this.failed(error as Error); }
    finally { this.makingOffer = false; }
  }
  async receive(signal: CallSignal) {
    if (this.closed) return;
    if (signal.kind === "ice") {
      const candidate: RTCIceCandidateInit = JSON.parse(signal.payload);
      if (!this.pc.remoteDescription) this.candidates.push(candidate);
      else { try { await this.pc.addIceCandidate(candidate); } catch(error) { if (!this.ignoreOffer) throw error; } }
      return;
    }
    const description: RTCSessionDescriptionInit = JSON.parse(signal.payload);
    const ready = !this.makingOffer && (this.pc.signalingState === "stable" || this.settingAnswer);
    this.ignoreOffer = this.outgoing && description.type === "offer" && !ready;
    if (this.ignoreOffer) return;
    this.settingAnswer = description.type === "answer";
    try { await this.pc.setRemoteDescription(description); } finally { this.settingAnswer = false; }
    if(!this.videoSender){
      // Reuse the offered video m-line. Creating a callee transceiver before the offer would
      // negotiate a second, empty video track and can leave browsers waiting for its frames.
      const video=this.pc.getTransceivers().find(t=>t.receiver.track.kind==='video');
      if(video){this.videoSender=video.sender;video.direction='sendrecv';await video.sender.replaceTrack(this.local.getVideoTracks()[0]??null);}
    }
    for (const candidate of this.candidates.splice(0)) await this.pc.addIceCandidate(candidate);
    if (description.type === "offer") {
      await this.pc.setLocalDescription();
      this.emit({kind:"description",payload:JSON.stringify(this.pc.localDescription)});
    }
    this.negotiated = true;
  }
  mute(muted: boolean) { this.local.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  async camera(enabled: boolean, facingMode: "user" | "environment" = "user") {
    if (this.closed) return;
    if (!enabled) {
      await this.videoSender?.replaceTrack(null);
      this.local.getVideoTracks().forEach(track => { this.local.removeTrack(track); track.stop(); });
      return;
    }
    const media = await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:1280},height:{ideal:720}},audio:false});
    if (this.closed) { media.getTracks().forEach(t=>t.stop()); return; }
    const track = media.getVideoTracks()[0];
    try { await this.videoSender?.replaceTrack(track); }
    catch(error) { media.getTracks().forEach(t=>t.stop()); throw error; }
    this.local.getVideoTracks().forEach(old => { if(old.id!==track.id){this.local.removeTrack(old);old.stop();} });
    this.local.addTrack(track);
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.recovery);
    this.pc.onicecandidate = null; this.pc.ontrack = null; this.pc.onnegotiationneeded = null;
    this.pc.close(); this.local.getTracks().forEach(t=>t.stop()); this.remote.getTracks().forEach(t=>t.stop());
    this.candidates = [];
  }
}
