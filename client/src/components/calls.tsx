"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, SwitchCamera, Volume1, Volume2 } from "lucide-react";
import { api, ApiError, type Models } from "@/lib/api/client";
import { CallConnection } from "@/lib/call-connection";
import { CALL_AUDIO, findAudioRoutes, routedMicrophone, type AudioRoutes } from "@/lib/audio-route";
import { useSession, useToast } from "./providers";
import { Avatar, Modal } from "./ui";
import { playMessageSound } from "./app-bridge";

type Call = Models["CallDto"];
type Peer = Models["UserSummaryDto"];
const Context = createContext<{start:(peer:Peer,kind:"audio"|"video")=>void;busy:boolean}>({start:()=>{},busy:false});
export const useCalls = () => useContext(Context);
function describeError(error:unknown) {
  if (error instanceof DOMException && ["NotAllowedError","SecurityError"].includes(error.name)) return "Allow microphone/camera access to join the call.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone or camera was found.";
  return error instanceof Error ? error.message : "Unable to start the call.";
}
function Media({stream,muted=false,className,sinkId}:{stream:MediaStream|null;muted?:boolean;className:string;sinkId?:string|null}) {
  const ref=useRef<HTMLVideoElement>(null),audio=useRef<HTMLAudioElement>(null);
  const [blocked,setBlocked]=useState(false);
  useEffect(()=>{
    const video=ref.current,sound=audio.current;
    if(!video)return;
    const listeners=new Map<MediaStreamTrack,()=>void>();
    const update=()=>{
      const tracks=stream?.getVideoTracks()??[];
      const refresh=()=>{const active=tracks.some(t=>t.readyState==='live'&&!t.muted);video.style.visibility=active?'visible':'hidden';video.dataset.videoActive=String(active);};
      for(const [track,handler] of listeners){track.removeEventListener('mute',handler);track.removeEventListener('unmute',handler);}
      listeners.clear();
      for(const track of tracks){track.addEventListener('mute',refresh);track.addEventListener('unmute',refresh);listeners.set(track,refresh);}
      refresh();
      // Keep audio independent: an intentionally empty video transceiver must never stall sound.
      video.srcObject=stream?new MediaStream(tracks):null;void video.play().catch(()=>{});
      if(sound){const tracks=stream?.getAudioTracks()??[];const source=tracks.length?new MediaStream(tracks):null;sound.srcObject=source;
        if(source)void sound.play().then(()=>{if(sound.srcObject===source)setBlocked(false);}).catch(error=>{if(sound.srcObject===source&&error instanceof DOMException&&error.name==='NotAllowedError')setBlocked(true);});}
    };
    update();stream?.addEventListener('addtrack',update);stream?.addEventListener('removetrack',update);
    return()=>{stream?.removeEventListener('addtrack',update);stream?.removeEventListener('removetrack',update);for(const [track,handler] of listeners){track.removeEventListener('mute',handler);track.removeEventListener('unmute',handler);}video.srcObject=null;if(sound)sound.srcObject=null;};
  },[stream,muted]);
  useEffect(()=>{
    const sound=audio.current;
    if(sinkId&&sound&&"setSinkId" in sound)void sound.setSinkId(sinkId).catch(()=>{});
  },[sinkId,muted]);
  return <><video ref={ref} className={className} autoPlay playsInline muted />{!muted&&<audio ref={audio} className="call-audio" autoPlay/>}{blocked&&!muted&&<button className="button secondary" onClick={()=>{void audio.current?.play().then(()=>setBlocked(false)).catch(()=>{});}}>Tap to hear the call</button>}</>;
}
let ringtone:HTMLAudioElement|null=null;
/** The incoming-call ringtone, one shared element so a single tap can unlock it for later calls. */
function ringtoneElement() {
  if(typeof window==="undefined")return null;
  if(!ringtone){ringtone=new Audio("/sounds/ring.mp3");ringtone.loop=true;ringtone.preload="auto";}
  return ringtone;
}
function stopRingtone() { if(ringtone){ringtone.pause();ringtone.currentTime=0;} }
function vibrate(pattern:number|number[]) { try{if("vibrate" in navigator)navigator.vibrate(pattern);}catch{/* unsupported */} }
export default function CallsProvider({children}:{children:ReactNode}) {
  const {user}=useSession(); const toast=useToast();
  const userId=user?.id;
  const [call,setCall]=useState<Call|null>(null),[working,setWorking]=useState(false);
  const [muted,setMuted]=useState(false),[camera,setCamera]=useState(false),[state,setState]=useState<string>("new");
  const [local,setLocal]=useState<MediaStream|null>(null),[remote,setRemote]=useState<MediaStream|null>(null);
  const [elapsed,setElapsed]=useState(0),[mediaVersion,setMediaVersion]=useState(0);
  /** Earpiece by default for voice calls; the person switches to the loudspeaker themselves. */
  const [speaker,setSpeaker]=useState(false),[canRoute,setCanRoute]=useState(false),[sink,setSink]=useState<string|null>(null);
  const routes=useRef<AudioRoutes|null|undefined>(undefined);
  const device=useRef<string>(""),current=useRef<Call|null>(null),stream=useRef<MediaStream|null>(null);
  const engine=useRef<CallConnection|null>(null),cursor=useRef(0),facing=useRef<"user"|"environment">("user");
  const generation=useRef(0),busy=useRef(false),signalAbort=useRef<AbortController|null>(null);
  const connecting=useRef<string|null>(null),connectedAt=useRef<number|null>(null);
  const callId=call?.id,callState=call?.state,callOutgoing=call?.outgoing;
  const assign=useCallback((value:Call|null)=>{current.current=value;setCall(value);},[]);
  const release=useCallback(()=>{
    generation.current++;signalAbort.current?.abort();engine.current?.close();engine.current=null;
    connecting.current=null;connectedAt.current=null;
    stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;
    setLocal(null);setRemote(null);setMuted(false);setCamera(false);setState("new");setElapsed(0);cursor.current=0;
    routes.current=undefined;setSpeaker(false);setCanRoute(false);setSink(null);
    busy.current=false;setWorking(false);
  },[]);
  const finish=useCallback(async(action:"reject"|"end"="end")=>{
    const value=current.current;release();assign(null);
    if(value) try { await api("callsAction",{params:{id:value.id},body:{deviceId:device.current,action},keepalive:true}); }
    catch(error) { if(!(error instanceof ApiError && [403,404,409].includes(error.status))) toast(describeError(error),true); }
  },[assign,release,toast]);
  const fail=useCallback((error:unknown)=>{toast(describeError(error),true);void finish();},[finish,toast]);
  const connect=useCallback(async(value:Call)=>{
    if(engine.current||connecting.current===value.id||!stream.current)return;
    connecting.current=value.id;
    const run=generation.current,media=stream.current;
    try {
    const config=await api("callsConfig");
    if(run!==generation.current||current.current?.id!==value.id)return;
    if(!config.relayConfigured) console.info("Calls: TURN relay is not configured; restrictive networks may require one.");
    const abort=new AbortController();signalAbort.current=abort;
    const connection=new CallConnection({iceServers:config.iceServers},media,value.outgoing,
      signal=>api("callsSignal",{params:{id:value.id},body:{deviceId:device.current,...signal},signal:abort.signal}),
      next=>setState(next),fail,remote=>{if(run===generation.current)setRemote(remote);});
    engine.current=connection;setRemote(connection.remote);setState("connecting");
    } finally { if(connecting.current===value.id)connecting.current=null; }
  },[fail]);
  /** Moves the call sound to the loudspeaker or back to the earpiece/headset. */
  const route=async(on:boolean)=>{
    const run=generation.current;
    if(routes.current===undefined)routes.current=await findAudioRoutes();
    const plan=routes.current;
    if(run!==generation.current)return false;
    setCanRoute(!!plan);
    if(!plan)return false;
    const target=on?plan.speaker:plan.earpiece;
    if(plan.mode==="output"){setSink(target);return true;}
    const media=stream.current,old=media?.getAudioTracks()[0];
    if(!media)return false;
    if(old?.readyState==="live"&&old.getSettings().deviceId===target)return true;
    const enabled=old?.enabled??true;
    // Android keeps one call microphone open: release it before opening it on the new route.
    old?.stop();
    let track:MediaStreamTrack;
    try{track=await routedMicrophone(target);}
    catch{track=(await navigator.mediaDevices.getUserMedia({audio:CALL_AUDIO})).getAudioTracks()[0];}
    if(run!==generation.current||stream.current!==media){track.stop();return false;}
    track.enabled=enabled;
    if(old)media.removeTrack(old);
    media.addTrack(track);
    await engine.current?.replaceAudio(track);
    return true;
  };
  const initialRoute=async(kind:"audio"|"video")=>{
    // Like WhatsApp: voice calls start on the earpiece, video calls on the loudspeaker.
    const on=kind==="video";
    try{if(await route(on))setSpeaker(on);}catch{/* keep the browser's default route */}
  };
  const toggleSpeaker=async()=>{
    if(working)return;
    const next=!speaker;setWorking(true);
    try{if(await route(next))setSpeaker(next);}
    catch(error){toast(describeError(error),true);}
    finally{setWorking(false);}
  };
  const acquire=async(kind:"audio"|"video")=>{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||typeof RTCPeerConnection==="undefined")
      throw new Error("Calls require HTTPS and a browser with microphone support.");
    return navigator.mediaDevices.getUserMedia({audio:CALL_AUDIO,video:kind==="video"?{facingMode:"user",width:{ideal:1280},height:{ideal:720}}:false});
  };
  const start=async(peer:Peer,kind:"audio"|"video")=>{
    if(busy.current||current.current)return;
    busy.current=true;setWorking(true);const run=generation.current;
    let media:MediaStream|null=null;
    try {
      media=await acquire(kind);
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;setLocal(media);setCamera(kind==="video");
      await initialRoute(kind);
      if(run!==generation.current)return;
      const value=await api("callsStart",{body:{peerId:peer.id,kind,deviceId:device.current}});
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());void api("callsAction",{params:{id:value.id},body:{deviceId:device.current,action:"end"}}).catch(()=>{});return;}
      assign(value);
    } catch(error) {media?.getTracks().forEach(t=>t.stop());release();toast(describeError(error),true);}
    finally{busy.current=false;setWorking(false);}
  };
  const accept=async()=>{
    const value=current.current;if(!value||busy.current)return;
    stopRingtone();vibrate(0);
    busy.current=true;setWorking(true);const run=generation.current;
    try {
      const media=await acquire(value.kind);
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;setLocal(media);setCamera(value.kind==="video");
      await initialRoute(value.kind);
      if(run!==generation.current)return;
      const accepted=await api("callsAction",{params:{id:value.id},body:{action:"accept",deviceId:device.current}});
      if(run!==generation.current)return;
      assign(accepted);await connect(accepted);
    } catch(error){if(current.current?.state==='accepted')fail(error);else{release();toast(describeError(error),true);}}
    finally{busy.current=false;setWorking(false);}
  };
  useEffect(()=>{
    if(!userId)return;
    // An id per mounted provider, deliberately not shared by tabs or reloads.
    device.current=crypto.randomUUID();let cancelled=false,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();
    const poll=async()=>{
      try {
        if(!current.current&&!busy.current){
          const result=await api("callsCurrent",{query:{deviceId:device.current},signal:abort.signal});
          if(!cancelled&&result.call?.canControl)assign(result.call);
        }
      } catch { /* The session provider owns authentication errors; retry without toast spam. */ }
      if(!cancelled)timer=setTimeout(poll,3000);
    };
    void poll();
    return()=>{cancelled=true;abort.abort();clearTimeout(timer);const old=current.current;
      if(old?.canControl)void api("callsAction",{params:{id:old.id},body:{deviceId:device.current,action:old.state==="ringing"&&!old.outgoing?"reject":"end"},keepalive:true}).catch(()=>{});
      release();assign(null);
    };
  },[userId,assign,release]); // Account changes end calls and release all devices.
  useEffect(()=>{
    if(!callId)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();
    let errorsSince=0,connectingSince=Date.now(),hasConnected=false;
    const poll=async()=>{
      try {
        const result=await api("callsPoll",{params:{id:callId},query:{deviceId:device.current,after:cursor.current},signal:abort.signal});
        if(cancelled)return;errorsSince=0;
        if(result.call.state==="ended"){
          const reason=result.call.endReason;release();assign(null);
          toast(reason==="missed"?"No answer.":reason==="declined"?"Call declined.":"Call ended.");return;
        }
        assign(result.call);
        if(result.call.state==="accepted"){
          await connect(result.call);
          if(cancelled)return;
          if(engine.current){for(const signal of result.signals){await engine.current.receive(signal);if(cancelled)return;cursor.current=signal.id;}}
          if(engine.current?.pc.connectionState==="connected")hasConnected=true;
          if(!hasConnected&&Date.now()-connectingSince>45000)throw new Error("The call could not connect. Please try again or switch networks.");
        } else connectingSince=Date.now();
      } catch(error){
        if(cancelled)return;
        if(error instanceof ApiError&&[403,404,409].includes(error.status)){release();assign(null);toast("Call is no longer available on this device.");return;}
        if(!errorsSince)errorsSince=Date.now();
        if(!(error instanceof ApiError)||Date.now()-errorsSince>15000){fail(error);return;}
      }
      if(!cancelled)timer=setTimeout(poll,1000);
    };
    void poll();return()=>{cancelled=true;abort.abort();clearTimeout(timer);};
  },[callId,assign,connect,fail,release,toast]);
  // Browsers (iOS especially) only let audio play after a gesture: prime the ringtone on the first tap.
  useEffect(()=>{
    const prime=()=>{const tone=ringtoneElement();if(!tone||!tone.paused)return;tone.muted=true;
      void tone.play().then(()=>{if(tone.muted){tone.pause();tone.currentTime=0;}tone.muted=false;}).catch(()=>{tone.muted=false;});};
    document.addEventListener("pointerdown",prime,{once:true});return()=>document.removeEventListener("pointerdown",prime);
  },[]);
  useEffect(()=>{
    if(!callId||callOutgoing||callState!=="ringing")return;
    const tone=ringtoneElement();let fallback:ReturnType<typeof setInterval>|undefined;
    const beep=()=>{if(fallback)return;playMessageSound();fallback=setInterval(playMessageSound,3000);};
    if(tone){tone.muted=false;tone.volume=1;tone.currentTime=0;void tone.play().catch(beep);}else beep();
    // If autoplay was blocked, the first touch anywhere starts the real ringtone.
    const retry=()=>{if(tone?.paused&&!busy.current)void tone.play().then(()=>{clearInterval(fallback);fallback=undefined;}).catch(()=>{});};
    document.addEventListener("pointerdown",retry);
    vibrate([800,600,800]);const buzz=setInterval(()=>vibrate([800,600,800]),3000);
    return()=>{clearInterval(fallback);clearInterval(buzz);vibrate(0);document.removeEventListener("pointerdown",retry);stopRingtone();};
  },[callId,callState,callOutgoing]);
  useEffect(()=>{
    if(state!=="connected")return;connectedAt.current??=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-connectedAt.current!)/1000)),1000);return()=>clearInterval(timer);
  },[state]);
  useEffect(()=>{
    const leave=()=>{const value=current.current;if(value?.canControl)void api("callsAction",{params:{id:value.id},body:{deviceId:device.current,action:value.state==="ringing"&&!value.outgoing?"reject":"end"},keepalive:true}).catch(()=>{});engine.current?.close();stream.current?.getTracks().forEach(t=>t.stop());};
    window.addEventListener("pagehide",leave);return()=>window.removeEventListener("pagehide",leave);
  },[]);
  const cameraAction=async(switching=false)=>{
    if(!engine.current||working)return;setWorking(true);
    const run=generation.current;
    try{
      const next=switching?true:!camera;
      if(switching)facing.current=facing.current==="user"?"environment":"user";
      await engine.current.camera(next,facing.current);if(run===generation.current){setCamera(next);setMediaVersion(v=>v+1);}
    }catch(error){toast(describeError(error),true);}finally{setWorking(false);}
  };
  const incoming=call&&!call.outgoing&&call.state==="ringing";
  const videoCall=call?.kind==='video'||camera||!!remote?.getVideoTracks().some(track=>track.readyState==='live'&&!track.muted);
  const label=incoming?`Incoming ${call.kind} call`:call?.state==="ringing"?"Calling…":state==="connected"?`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`:state==="disconnected"?"Reconnecting…":"Connecting…";
  return <Context.Provider value={{start:(peer,kind)=>void start(peer,kind),busy:!!call||working}}>
    {children}
    {call&&<Modal title={incoming?"Incoming call":"Circle call"} className={`call-dialog ig-call-dialog ${incoming?'is-incoming':''}`} closeOnBackdrop={false} onClose={()=>void finish(incoming?"reject":"end")}>
      <div className={`call-stage ${call.state==='ringing'?'is-ringing':''}`}>
        {call.peer.avatarUrl&&<img className="call-ambient" src={call.peer.avatarUrl} alt="" aria-hidden="true"/>}
        <div className="call-type">{videoCall?<Video size={15}/>:<Phone size={15}/>}<span>{videoCall?'Video call':'Voice call'}</span></div>
        <div className="call-person"><Avatar user={call.peer} size={80}/><h2>{call.peer.displayName}</h2><p role="status" aria-live="polite">{label}</p></div>
        {!incoming&&<div className={`call-video-stage ${camera?"has-camera":""}`}>
          <Media stream={remote} className="call-remote" sinkId={sink}/>
          <Media key={mediaVersion} stream={local} muted className={`call-local ${camera?"":"camera-off"}`}/>
        </div>}
        <div className="call-actions">
          {incoming?<><button className="call-control hangup" onClick={()=>void finish("reject")}><span className="call-control-icon"><PhoneOff/></span><span>Decline</span></button><button className="call-control accept" disabled={working} onClick={()=>void accept()}><span className="call-control-icon"><Phone/></span><span>Answer</span></button></>:<>
            <button className={`call-control ${muted?"selected":""}`} disabled={!local} aria-pressed={muted} onClick={()=>{engine.current?.mute(!muted);stream.current?.getAudioTracks().forEach(t=>{t.enabled=muted;});setMuted(!muted);}}><span className="call-control-icon">{muted?<MicOff/>:<Mic/>}</span><span>{muted?"Unmute":"Mute"}</span></button>
            {canRoute&&<button className={`call-control ${speaker?"selected":""}`} disabled={working} aria-pressed={speaker} onClick={()=>void toggleSpeaker()}><span className="call-control-icon">{speaker?<Volume2/>:<Volume1/>}</span><span>Speaker</span></button>}
            <button className={`call-control ${camera?'':'selected'}`} disabled={call.state!=="accepted"||working} aria-pressed={camera} onClick={()=>void cameraAction()}><span className="call-control-icon">{camera?<Video/>:<VideoOff/>}</span><span>{camera?"Camera off":"Camera on"}</span></button>
            {camera&&<button className="call-control" disabled={call.state!=="accepted"||working} onClick={()=>void cameraAction(true)}><span className="call-control-icon"><SwitchCamera/></span><span>Flip</span></button>}
            <button className="call-control hangup" onClick={()=>void finish()}><span className="call-control-icon"><PhoneOff/></span><span>End call</span></button>
          </>}
        </div>
      </div>
    </Modal>}
  </Context.Provider>;
}
