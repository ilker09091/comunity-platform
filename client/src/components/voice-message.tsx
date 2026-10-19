"use client";
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Square, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from './providers';

const MAX_MS=120_000;
const time=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;

export function VoiceMessage({src,durationMs}:{src:string;durationMs:number|null}) {
  const ref=useRef<HTMLAudioElement>(null);
  const [rate,setRate]=useState(1);
  return <div className="dm-voice-message">
    <span>Voice message <small>{time(durationMs??0)}</small></span>
    <audio ref={ref} src={src} controls preload="metadata" aria-label="Voice message" controlsList="nodownload"
      onPlay={()=>document.querySelectorAll<HTMLAudioElement>('.dm-voice-message audio').forEach(player=>{if(player!==ref.current)player.pause();})}/>
    <button type="button" className="dm-voice-rate" aria-label={`Playback speed ${rate}x`} onClick={()=>{const next=rate===1?1.5:rate===1.5?2:1;setRate(next);if(ref.current)ref.current.playbackRate=next;}}>{rate}×</button>
  </div>;
}

export function VoiceRecorder({disabled,onSend,onActiveChange}:{disabled:boolean;onSend:(id:string)=>Promise<unknown>;onActiveChange:(active:boolean)=>void}) {
  const toast=useToast();
  const [phase,setPhase]=useState<'idle'|'acquiring'|'recording'|'preview'|'sending'>('idle');
  const [duration,setDuration]=useState(0),[preview,setPreview]=useState<string|null>(null);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null);
  const file=useRef<File|null>(null),url=useRef<string|null>(null),uploaded=useRef<string|null>(null);
  const alive=useRef(true),discard=useRef(false),starting=useRef(false),timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const release=()=>{if(timer.current)clearInterval(timer.current);timer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  useEffect(()=>{
    alive.current=true;
    return()=>{
      alive.current=false;discard.current=true;
      if(recorder.current?.state==='recording')recorder.current.stop();
      if(timer.current)clearInterval(timer.current);
      stream.current?.getTracks().forEach(track=>track.stop());
      if(url.current)URL.revokeObjectURL(url.current);
      if(uploaded.current)void api('messagesDeleteAudio',{params:{id:uploaded.current}}).catch(()=>{});
      onActiveChange(false);
    };
  },[onActiveChange]);
  const reset=()=>{
    discard.current=true;
    if(recorder.current?.state==='recording')recorder.current.stop();
    release();
    if(url.current)URL.revokeObjectURL(url.current);url.current=null;
    if(uploaded.current)void api('messagesDeleteAudio',{params:{id:uploaded.current}}).catch(()=>{});uploaded.current=null;
    file.current=null;setPreview(null);setDuration(0);setPhase('idle');onActiveChange(false);
  };
  const start=async()=>{
    if(disabled||starting.current||phase!=='idle')return;
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Voice recording needs HTTPS and microphone support.',true);
    starting.current=true;discard.current=false;setPhase('acquiring');onActiveChange(true);
    try {
      const source=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!alive.current||discard.current){source.getTracks().forEach(track=>track.stop());return;}
      stream.current=source;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      const capture=new MediaRecorder(source,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);
      recorder.current=capture;const chunks:BlobPart[]=[];let size=0;const began=performance.now();
      capture.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);size+=event.data.size;}if(size>9*1024*1024&&capture.state==='recording')capture.stop();};
      capture.onerror=()=>{if(alive.current){toast('Recording failed. Please try again.',true);reset();}};
      capture.onstop=()=>{
        release();
        if(!alive.current||discard.current)return;
        const elapsed=Math.min(MAX_MS,performance.now()-began);
        if(elapsed<500||!size){reset();toast('Record for at least one second.',true);return;}
        const blob=new Blob(chunks,{type:capture.mimeType||mime||'audio/webm'});
        file.current=new File([blob],blob.type.includes('mp4')?'voice.m4a':blob.type.includes('ogg')?'voice.ogg':'voice.webm',{type:blob.type});
        url.current=URL.createObjectURL(blob);setPreview(url.current);setDuration(elapsed);setPhase('preview');
      };
      capture.start(1000);setPhase('recording');
      timer.current=setInterval(()=>{const elapsed=performance.now()-began;if(alive.current)setDuration(Math.min(MAX_MS,elapsed));if(elapsed>=MAX_MS&&capture.state==='recording')capture.stop();},200);
    }catch(error){release();if(alive.current){setPhase('idle');onActiveChange(false);toast(error instanceof DOMException&&error.name==='NotAllowedError'?'Allow microphone access to record a voice message.':'The microphone could not be opened.',true);}}
    finally{starting.current=false;}
  };
  const send=async()=>{
    if(!file.current||phase!=='preview')return;setPhase('sending');
    try {
      if(!uploaded.current){const body=new FormData();body.append('file',file.current);const audio=await api('messagesUploadAudio',{body});
        if(!alive.current){void api('messagesDeleteAudio',{params:{id:audio.id}}).catch(()=>{});return;}uploaded.current=audio.id;}
      await onSend(uploaded.current);uploaded.current=null;if(alive.current)reset();
    }catch(error){if(alive.current){setPhase('preview');toast(error instanceof Error?error.message:'Could not send the recording. Try again.',true);}}
  };
  return <>
    <button type="button" className="dm-icon" aria-label="Record voice message" disabled={disabled||phase!=='idle'} onClick={()=>void start()}><Mic size={22}/></button>
    {phase!=='idle'&&<div className="dm-voice-capture" role="region" aria-label="Voice recording">
      <div className="dm-voice-capture-title"><strong>{phase==='recording'?'Recording':phase==='acquiring'?'Opening microphone':phase==='sending'?'Sending voice message':'Voice message preview'}</strong><time>{time(duration)} / 2:00</time></div>
      {preview?<audio src={preview} controls aria-label="Recording preview"/>:<div className="dm-recording-bars" aria-hidden="true">{Array.from({length:24},(_,i)=><i key={i} style={{animationDelay:`${i%5*.13}s`,height:`${8+i%4*6}px`}}/>)}</div>}
      <div className="dm-voice-capture-actions">
        <button type="button" className="dm-icon" aria-label="Discard recording" disabled={phase==='sending'} onClick={reset}><Trash2 size={20}/></button>
        {phase==='recording'?<button type="button" className="button secondary small" onClick={()=>recorder.current?.stop()}><Square size={15}/>Stop recording</button>:
          phase==='preview'?<button type="button" className="button small" onClick={()=>void send()}><Send size={15}/>Send voice message</button>:<Loader2 className="spin" size={20}/>}
      </div>
    </div>}
  </>;
}
