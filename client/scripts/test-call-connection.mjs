import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Deterministic failure paths complement the real two-peer Chromium test.
class Track extends EventTarget {
  constructor(kind,source='camera'){super();this.kind=kind;this.id=String(Math.random());this.readyState='live';this.enabled=true;this.muted=false;this.source=source;}
  stop(){this.readyState='ended';}
  async applyConstraints(constraints){if(this.rejectConstraints)throw new DOMException('Unsupported','OverconstrainedError');this.constraints=constraints;}
}
class Stream extends EventTarget {
  constructor(tracks=[]){super();this.tracks=[...tracks];}
  getTracks(){return [...this.tracks];}
  getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
  getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
  addTrack(t){this.tracks.push(t);}
  removeTrack(t){this.tracks=this.tracks.filter(old=>old!==t);}
}
class Sender {
  constructor(track){this.track=track;}
  async replaceTrack(track){this.track=track;}
  getParameters(){return {encodings:[{}]};}
  async setParameters(parameters){this.parameters=parameters;}
}
class Peer {
  connectionState='new';iceConnectionState='new';signalingState='stable';remoteDescription=null;restarts=0;
  addTrack(track){return new Sender(track);}
  addTransceiver(track){this.video=new Sender(typeof track==='string'?null:track);return {sender:this.video};}
  createDataChannel(){return this.channel={readyState:'open',send:message=>(this.messages??=[]).push(JSON.parse(message)),close(){}};}
  restartIce(){this.restarts++;}
  async addIceCandidate(){}
  async setRemoteDescription(description){this.remoteDescription=description;}
  async setLocalDescription(){this.localDescription={type:'offer',sdp:'qa-offer'};}
  close(){this.connectionState='closed';}
}
Object.assign(globalThis,{MediaStream:Stream,RTCPeerConnection:Peer});
let capture,resolveCapture,deny=false;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{
  getUserMedia:async()=>new Stream([new Track('video')]),
  getDisplayMedia:()=>deny?Promise.reject(new DOMException('Cancelled','NotAllowedError')):new Promise(resolve=>{resolveCapture=()=>{capture=new Track('video','screen');resolve(new Stream([capture]));};})
}}});
const dir=await mkdtemp(join(tmpdir(),'circle-call-tests-'));
const source=await readFile(new URL('../src/lib/call-connection.ts',import.meta.url),'utf8');
await writeFile(join(dir,'connection.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {CallConnection}=await import(pathToFileURL(join(dir,'connection.mjs')));
const connections=[];
function create(send=async()=>{}){
  const local=new Stream([new Track('audio'),new Track('video')]);const errors=[],states=[],media=[];
  const connection=new CallConnection({},local,true,send,state=>states.push(state),error=>errors.push(error),()=>{},state=>media.push(state));
  connections.push(connection);return {connection,local,errors,states,media};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  const {connection:c,local,errors,states,media}=create();
  c.pc.connectionState='failed';c.recover();
  assert.equal(c.pc.restarts,1);assert.equal(errors.length,0);assert.equal(states.at(-1),'disconnected');
  c.recover();assert.equal(c.pc.restarts,1,'Repeated events must not flood ICE restarts');
  c.pc.connectionState='connected';c.pc.onconnectionstatechange();assert.equal(states.at(-1),'connected');
  const mic=local.getAudioTracks()[0];
  const interrupted=local.getVideoTracks()[0];interrupted.stop();interrupted.dispatchEvent(new Event('ended'));await pause(0);
  assert.equal(media.at(-1).localSource,'none','OS camera revocation must restore the voice UI');
  assert.equal(mic.readyState,'live');
  await c.camera(true);
  await c.camera(false);assert.equal(c.pc.video.track,null);assert.equal(media.at(-1).localSource,'none');
  assert.equal(mic.readyState,'live');
  deny=true;await assert.rejects(c.shareScreen(),{name:'NotAllowedError'});deny=false;
  assert.equal(media.at(-1).localSource,'none');
  await c.camera(true);
  const sharing=c.shareScreen();resolveCapture();await sharing;
  assert.equal(c.pc.video.track,capture);assert.equal(media.at(-1).localSource,'screen');
  assert.equal(c.pc.video.parameters.encodings[0].maxBitrate,6_000_000);
  const screen=capture;
  for(const [id,width,height,fps,bitrate] of [['720p30',1280,720,30,3500000],['720p60',1280,720,60,6000000],['1080p60',1920,1080,60,10000000],['1080p30',1920,1080,30,6000000]]){
    assert.equal(await c.setScreenQuality(id),true);
    assert.equal(screen.constraints.width.max,width);assert.equal(screen.constraints.height.max,height);assert.equal(screen.constraints.frameRate.max,fps);
    assert.equal(c.pc.video.parameters.encodings[0].maxFramerate,fps);assert.equal(c.pc.video.parameters.encodings[0].maxBitrate,bitrate);
    assert.equal(c.pc.video.track,screen);assert.equal(mic.readyState,'live');
  }
  screen.rejectConstraints=true;
  await assert.rejects(c.setScreenQuality('720p60'),{name:'OverconstrainedError'});
  assert.equal(c.pc.video.parameters.encodings[0].maxFramerate,30);
  screen.rejectConstraints=false;
  console.log('PASS all four live sharing presets tune capture/FPS/bitrate without replacing capture or microphone; failed changes preserve the setting');
  capture.stop();capture.dispatchEvent(new Event('ended'));await pause(0);
  assert.equal(media.at(-1).localSource,'camera','Native picker Stop restores the previous camera');
  assert.equal(mic.readyState,'live');
  const late=c.shareScreen();c.close();resolveCapture();await late;
  assert.equal(capture.readyState,'ended','A picker resolving after hangup must release its capture');
  console.log('PASS ICE recovery, camera-off/revocation, cancelled capture, native stop and late permission cleanup');
  let attempts=0;
  const retry=create(async()=>{if(++attempts===1)throw new TypeError('Temporary network loss');});
  retry.connection.pc.onicecandidate({candidate:{toJSON:()=>({candidate:'qa-candidate'})}});
  await pause(700);assert.equal(attempts,2);assert.equal(retry.errors.length,0);
  const fatal=create(async()=>{throw Object.assign(new Error('Forbidden'),{status:403});});
  fatal.connection.pc.onicecandidate({candidate:{toJSON:()=>({candidate:'qa-candidate'})}});
  await pause(0);assert.equal(fatal.errors.length,1);
  console.log('PASS transient signaling retries while authorization errors stop immediately');
} finally {for(const c of connections)c.close();await rm(dir,{recursive:true,force:true});}
