"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, SwitchCamera } from "lucide-react";
import { api, ApiError, type Models } from "@/lib/api/client";
import { CallConnection } from "@/lib/call-connection";
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
function Media({stream,muted=false,className}:{stream:MediaStream|null;muted?:boolean;className:string}) {
  const ref=useRef<HTMLVideoElement>(null),audio=useRef<HTMLAudioElement>(null);
  const [blocked,setBlocked]=useState(false);
  useEffect(()=>{
    const video=ref.current,sound=audio.current;
    if(!video)return;
    const listeners=new Map<MediaStreamTrack,()=>void>();
    const update=()=>{
      const tracks=stream?.getVideoTracks()??[];
      const refresh=()=>{video.style.visibility=tracks.some(t=>t.readyState==='live'&&!t.muted)?'visible':'hidden';};
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
  return <><video ref={ref} className={className} autoPlay playsInline muted />{!muted&&<audio ref={audio} className="call-audio" autoPlay/>}{blocked&&!muted&&<button className="button secondary" onClick={()=>{void audio.current?.play().then(()=>setBlocked(false)).catch(()=>{});}}>Tap to hear the call</button>}</>;
}
export default function CallsProvider({children}:{children:ReactNode}) {
  const {user}=useSession(); const toast=useToast();
  const userId=user?.id;
  const [call,setCall]=useState<Call|null>(null),[working,setWorking]=useState(false);
  const [muted,setMuted]=useState(false),[camera,setCamera]=useState(false),[state,setState]=useState<string>("new");
  const [local,setLocal]=useState<MediaStream|null>(null),[remote,setRemote]=useState<MediaStream|null>(null);
  const [elapsed,setElapsed]=useState(0),[mediaVersion,setMediaVersion]=useState(0);
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
  const acquire=async(kind:"audio"|"video")=>{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||typeof RTCPeerConnection==="undefined")
      throw new Error("Calls require HTTPS and a browser with microphone support.");
    return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:kind==="video"?{facingMode:"user",width:{ideal:1280},height:{ideal:720}}:false});
  };
  const start=async(peer:Peer,kind:"audio"|"video")=>{
    if(busy.current||current.current)return;
    busy.current=true;setWorking(true);const run=generation.current;
    let media:MediaStream|null=null;
    try {
      media=await acquire(kind);
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;setLocal(media);setCamera(kind==="video");
      const value=await api("callsStart",{body:{peerId:peer.id,kind,deviceId:device.current}});
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());void api("callsAction",{params:{id:value.id},body:{deviceId:device.current,action:"end"}}).catch(()=>{});return;}
      assign(value);
    } catch(error) {media?.getTracks().forEach(t=>t.stop());release();toast(describeError(error),true);}
    finally{busy.current=false;setWorking(false);}
  };
  const accept=async()=>{
    const value=current.current;if(!value||busy.current)return;
    busy.current=true;setWorking(true);const run=generation.current;
    try {
      const media=await acquire(value.kind);
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;setLocal(media);setCamera(value.kind==="video");
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
  useEffect(()=>{
    if(!callId||callOutgoing||callState!=="ringing")return;
    playMessageSound();const timer=setInterval(playMessageSound,3000);return()=>clearInterval(timer);
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
  const label=incoming?`Incoming ${call.kind} call`:call?.state==="ringing"?"Calling…":state==="connected"?`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`:state==="disconnected"?"Reconnecting…":"Connecting…";
  return <Context.Provider value={{start:(peer,kind)=>void start(peer,kind),busy:!!call||working}}>
    {children}
    {call&&<Modal title={incoming?"Incoming call":"Circle call"} className="call-dialog" onClose={()=>void finish(incoming?"reject":"end")}>
      <div className="call-stage">
        <div className="call-person"><Avatar user={call.peer} size={80}/><h2>{call.peer.displayName}</h2><p role="status" aria-live="polite">{label}</p></div>
        {!incoming&&<div className={`call-video-stage ${camera?"has-camera":""}`}>
          <Media stream={remote} className="call-remote"/>
          <Media key={mediaVersion} stream={local} muted className={`call-local ${camera?"":"camera-off"}`}/>
        </div>}
        <div className="call-actions">
          {incoming?<><button className="call-control accept" disabled={working} onClick={()=>void accept()}><Phone/><span>Answer</span></button><button className="call-control hangup" onClick={()=>void finish("reject")}><PhoneOff/><span>Decline</span></button></>:<>
            <button className={`call-control ${muted?"selected":""}`} disabled={!local} aria-pressed={muted} onClick={()=>{engine.current?.mute(!muted);stream.current?.getAudioTracks().forEach(t=>{t.enabled=muted;});setMuted(!muted);}}>{muted?<MicOff/>:<Mic/>}<span>{muted?"Unmute":"Mute"}</span></button>
            <button className="call-control" disabled={call.state!=="accepted"||working} aria-pressed={camera} onClick={()=>void cameraAction()}>{camera?<Video/>:<VideoOff/>}<span>{camera?"Camera off":"Camera on"}</span></button>
            {camera&&<button className="call-control" disabled={call.state!=="accepted"||working} onClick={()=>void cameraAction(true)}><SwitchCamera/><span>Flip</span></button>}
            <button className="call-control hangup" onClick={()=>void finish()}><PhoneOff/><span>End call</span></button>
          </>}
        </div>
      </div>
    </Modal>}
  </Context.Provider>;
}
