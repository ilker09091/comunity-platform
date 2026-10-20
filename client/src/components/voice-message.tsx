"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, Mic, Pause, Play, Send, Square, Trash2 } from 'lucide-react';
import { api, type Models } from '@/lib/api/client';
import { useToast } from './providers';
import { Avatar } from './ui';

const MAX_MS=120_000;
const BARS=36;
const time=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const PLAY_EVENT='circle:voice-play',NEXT_EVENT='circle:voice-next';

/** A stable placeholder shape until the real waveform is decoded (or if decoding fails). */
function placeholderPeaks(seed:string) {
  let h=2166136261;for(const ch of seed)h=Math.imul(h^ch.charCodeAt(0),16777619);
  return Array.from({length:BARS},()=>{h=Math.imul(h^(h>>>13),1597334677);return .25+((h>>>0)%1000)/1000*.55;});
}
/** Peak level per bar, 0.12–1, from the decoded audio. Cached per file across renders. */
const peakCache=new Map<string,Promise<number[]>>();
function loadPeaks(src:string):Promise<number[]> {
  const key=src.split('?')[0];
  let pending=peakCache.get(key);
  if(!pending){
    pending=(async()=>{
      const data=await (await fetch(src)).arrayBuffer();
      // An offline context decodes without touching the speakers or autoplay rules.
      const audio=await new OfflineAudioContext(1,1,44100).decodeAudioData(data);
      const samples=audio.getChannelData(0),size=Math.max(1,Math.floor(samples.length/BARS)),stride=Math.max(1,Math.floor(size/400));
      const peaks=Array.from({length:BARS},(_,bar)=>{let peak=0;for(let i=bar*size;i<(bar+1)*size&&i<samples.length;i+=stride)peak=Math.max(peak,Math.abs(samples[i]));return peak;});
      return normalize(peaks);
    })();
    pending.catch(()=>peakCache.delete(key));
    peakCache.set(key,pending);
  }
  return pending;
}
function normalize(levels:number[]) {
  const max=Math.max(...levels,1e-4);
  return levels.map(level=>Math.max(.12,Math.sqrt(level/max)));
}
/** Squeezes any number of level samples into the bar count. */
function downsample(levels:number[]) {
  if(!levels.length)return placeholderPeaks('empty');
  return normalize(Array.from({length:BARS},(_,bar)=>{
    const from=Math.floor(bar*levels.length/BARS),to=Math.max(from+1,Math.floor((bar+1)*levels.length/BARS));
    return Math.max(...levels.slice(from,to));
  }));
}

const PLAYED_KEY='circle-voice-played';
function playedIds():string[] { try{return JSON.parse(localStorage.getItem(PLAYED_KEY)??'[]');}catch{return [];} }
function markPlayed(id:string) {
  try{const ids=playedIds().filter(x=>x!==id);ids.push(id);localStorage.setItem(PLAYED_KEY,JSON.stringify(ids.slice(-300)));}catch{/* storage unavailable */}
}

type Author=Pick<Models['UserSummaryDto'],'displayName'|'avatarUrl'>;
/**
 * WhatsApp-style voice note: the sender's photo with a mic badge (green until you play it),
 * play/pause, a waveform of the actual recording that shows progress and can be scrubbed,
 * and a speed pill while playing. One note plays at a time; the next note follows on its own.
 */
export function VoiceMessage({id,src,durationMs,own=false,author,peaks:given,compact=false}:{
  id:string;src:string;durationMs:number|null;own?:boolean;author?:Author|null;peaks?:number[];compact?:boolean;
}) {
  const audio=useRef<HTMLAudioElement>(null),wave=useRef<HTMLDivElement>(null),dragging=useRef(false);
  const [playing,setPlaying]=useState(false),[progress,setProgress]=useState(0),[rate,setRate]=useState(1);
  const [played,setPlayed]=useState(()=>own||compact||(typeof window!=='undefined'&&playedIds().includes(id)));
  const [decoded,setDecoded]=useState<number[]|null>(null);
  const peaks=given??decoded??placeholderPeaks(src.split('?')[0]);
  const total=Math.max(0,durationMs??0);
  const seconds=()=>{const value=audio.current?.duration;return value&&Number.isFinite(value)?value:total/1000;};
  useEffect(()=>{
    if(given)return;
    let live=true;
    void loadPeaks(src).then(value=>{if(live)setDecoded(value);}).catch(()=>{});
    return()=>{live=false;};
  },[src,given]);
  useEffect(()=>{
    if(!playing)return;
    let frame=0;
    const tick=()=>{const element=audio.current,length=seconds();if(element&&length&&!dragging.current)setProgress(Math.min(1,element.currentTime/length));frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  });
  useEffect(()=>{
    const pauseOthers=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)audio.current?.pause();};
    const next=(event:Event)=>{if((event as CustomEvent<string>).detail===id)void audio.current?.play().catch(()=>{});};
    window.addEventListener(PLAY_EVENT,pauseOthers);window.addEventListener(NEXT_EVENT,next);
    return()=>{window.removeEventListener(PLAY_EVENT,pauseOthers);window.removeEventListener(NEXT_EVENT,next);};
  },[id]);
  const toggle=()=>{const element=audio.current;if(!element)return;if(element.paused)void element.play().catch(()=>{});else element.pause();};
  const seekTo=(ratio:number)=>{
    const element=audio.current,clamped=Math.min(1,Math.max(0,ratio));
    setProgress(clamped);
    if(element&&seconds())element.currentTime=clamped*seconds();
  };
  const fromPointer=(event:ReactPointerEvent<HTMLDivElement>)=>{const rect=wave.current!.getBoundingClientRect();return (event.clientX-rect.left)/rect.width;};
  const shown=playing||progress>0?progress*total:total;
  return <div className={`wa-voice ${own?'own':''} ${playing?'playing':''} ${compact?'compact':''}`} data-voice-id={id}>
    {!compact&&<span className="wa-voice-side">
      {playing||progress>0
        ?<button type="button" className="wa-voice-rate" aria-label={`Playback speed ${rate}x`} onClick={()=>{const next=rate===1?1.5:rate===1.5?2:1;setRate(next);if(audio.current)audio.current.playbackRate=next;}}>{rate}×</button>
        :<span className="wa-voice-avatar"><Avatar user={author} size={42}/><span className={`wa-voice-mic ${played?'played':''}`}><Mic size={11} strokeWidth={2.6}/></span></span>}
    </span>}
    <button type="button" className="wa-voice-play" aria-label={playing?'Pause voice message':'Play voice message'} onClick={toggle}>
      {playing?<Pause size={22} fill="currentColor" strokeWidth={0}/>:<Play size={22} fill="currentColor" strokeWidth={0}/>}
    </button>
    <div className="wa-voice-body">
      <div ref={wave} className="wa-voice-wave" role="slider" tabIndex={0} aria-label="Voice message position"
        aria-valuemin={0} aria-valuemax={Math.round(total/1000)} aria-valuenow={Math.round(progress*total/1000)} aria-valuetext={time(progress*total)}
        onKeyDown={event=>{const step=total?5000/total:.1;if(event.key==='ArrowRight'){event.preventDefault();seekTo(progress+step);}else if(event.key==='ArrowLeft'){event.preventDefault();seekTo(progress-step);}else if(event.key===' '||event.key==='Enter'){event.preventDefault();toggle();}}}
        onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);dragging.current=true;seekTo(fromPointer(event));}}
        onPointerMove={event=>{if(dragging.current)seekTo(fromPointer(event));}}
        onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}}>
        {peaks.map((peak,index)=><span key={index} className={(index+.5)/peaks.length<=progress?'on':''} style={{height:`${Math.round(peak*100)}%`}}/>)}
        <i className="wa-voice-thumb" style={{left:`${progress*100}%`}} aria-hidden="true"/>
      </div>
      <time className="wa-voice-time">{time(shown)}</time>
    </div>
    <audio ref={audio} src={src} preload="metadata" hidden
      onPlay={()=>{setPlaying(true);window.dispatchEvent(new CustomEvent(PLAY_EVENT,{detail:id}));if(!played){setPlayed(true);if(!own)markPlayed(id);}if(audio.current)audio.current.playbackRate=rate;}}
      onPause={()=>setPlaying(false)}
      onEnded={()=>{
        setPlaying(false);setProgress(0);
        if(compact)return;
        // Like WhatsApp, the following voice note in the chat plays next.
        const notes=[...document.querySelectorAll<HTMLElement>('.wa-voice:not(.compact)[data-voice-id]')];
        const next=notes[notes.findIndex(node=>node.dataset.voiceId===id)+1];
        if(next?.dataset.voiceId)window.dispatchEvent(new CustomEvent(NEXT_EVENT,{detail:next.dataset.voiceId}));
      }}/>
  </div>;
}

/**
 * WhatsApp-style recorder: the composer turns into a recording strip (red dot, timer, live
 * level bars). Stop to review the note with its waveform, or send straight away.
 */
export function VoiceRecorder({disabled,onSend,onActiveChange}:{disabled:boolean;onSend:(id:string)=>Promise<unknown>;onActiveChange:(active:boolean)=>void}) {
  const toast=useToast();
  const [phase,setPhase]=useState<'idle'|'acquiring'|'recording'|'preview'|'sending'>('idle');
  const [duration,setDuration]=useState(0),[preview,setPreview]=useState<string|null>(null);
  const [levels,setLevels]=useState<number[]>([]),[recorded,setRecorded]=useState<number[]>([]);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),meter=useRef<AudioContext|null>(null);
  const file=useRef<File|null>(null),url=useRef<string|null>(null),uploaded=useRef<string|null>(null),history=useRef<number[]>([]);
  const alive=useRef(true),discard=useRef(false),starting=useRef(false),sendNow=useRef(false),timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const release=()=>{
    if(timer.current)clearInterval(timer.current);timer.current=null;
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    void meter.current?.close().catch(()=>{});meter.current=null;
  };
  useEffect(()=>{
    alive.current=true;
    return()=>{
      alive.current=false;discard.current=true;
      if(recorder.current?.state==='recording')recorder.current.stop();
      if(timer.current)clearInterval(timer.current);
      stream.current?.getTracks().forEach(track=>track.stop());
      void meter.current?.close().catch(()=>{});
      if(url.current)URL.revokeObjectURL(url.current);
      if(uploaded.current)void api('messagesDeleteAudio',{params:{id:uploaded.current}}).catch(()=>{});
      onActiveChange(false);
    };
  },[onActiveChange]);
  const reset=()=>{
    discard.current=true;sendNow.current=false;
    if(recorder.current?.state==='recording')recorder.current.stop();
    release();
    if(url.current)URL.revokeObjectURL(url.current);url.current=null;
    if(uploaded.current)void api('messagesDeleteAudio',{params:{id:uploaded.current}}).catch(()=>{});uploaded.current=null;
    file.current=null;history.current=[];setLevels([]);setPreview(null);setDuration(0);setPhase('idle');onActiveChange(false);
  };
  const deliver=async()=>{
    if(!file.current)return;
    setPhase('sending');
    try {
      if(!uploaded.current){const body=new FormData();body.append('file',file.current);const audio=await api('messagesUploadAudio',{body});
        if(!alive.current){void api('messagesDeleteAudio',{params:{id:audio.id}}).catch(()=>{});return;}uploaded.current=audio.id;}
      await onSend(uploaded.current);uploaded.current=null;if(alive.current)reset();
    }catch(error){if(alive.current){setPhase('preview');toast(error instanceof Error?error.message:'Could not send the recording. Try again.',true);}}
  };
  const start=async()=>{
    if(disabled||starting.current||phase!=='idle')return;
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Voice recording needs HTTPS and microphone support.',true);
    starting.current=true;discard.current=false;sendNow.current=false;history.current=[];setLevels([]);setPhase('acquiring');onActiveChange(true);
    try {
      const source=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!alive.current||discard.current){source.getTracks().forEach(track=>track.stop());return;}
      stream.current=source;
      // Live input level for the bars; it also becomes the note's waveform.
      let analyser:AnalyserNode|null=null;
      try{const context=new AudioContext();meter.current=context;analyser=context.createAnalyser();analyser.fftSize=512;context.createMediaStreamSource(source).connect(analyser);}catch{analyser=null;}
      const buffer=new Uint8Array(analyser?.fftSize??0);
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      const capture=new MediaRecorder(source,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);
      recorder.current=capture;const chunks:BlobPart[]=[];let size=0;const began=performance.now();
      capture.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);size+=event.data.size;}if(size>9*1024*1024&&capture.state==='recording')capture.stop();};
      capture.onerror=()=>{if(alive.current){toast('Recording failed. Please try again.',true);reset();}};
      capture.onstop=()=>{
        release();
        if(!alive.current||discard.current)return;
        const elapsed=Math.min(MAX_MS,performance.now()-began);
        if(elapsed<700||!size){reset();toast('Hold on a little longer: record at least one second.',true);return;}
        const blob=new Blob(chunks,{type:capture.mimeType||mime||'audio/webm'});
        file.current=new File([blob],blob.type.includes('mp4')?'voice.m4a':blob.type.includes('ogg')?'voice.ogg':'voice.webm',{type:blob.type});
        url.current=URL.createObjectURL(blob);setRecorded(downsample(history.current));setPreview(url.current);setDuration(elapsed);setPhase('preview');
        if(sendNow.current){sendNow.current=false;void deliver();}
      };
      capture.start(1000);setPhase('recording');
      timer.current=setInterval(()=>{
        const elapsed=performance.now()-began;
        if(analyser){
          analyser.getByteTimeDomainData(buffer);
          let sum=0;for(const value of buffer){const centred=(value-128)/128;sum+=centred*centred;}
          history.current.push(Math.sqrt(sum/buffer.length));
        }
        if(alive.current){setDuration(Math.min(MAX_MS,elapsed));setLevels(history.current.slice(-BARS));}
        if(elapsed>=MAX_MS&&capture.state==='recording')capture.stop();
      },100);
    }catch(error){release();if(alive.current){setPhase('idle');onActiveChange(false);toast(error instanceof DOMException&&error.name==='NotAllowedError'?'Allow microphone access to record a voice message.':'The microphone could not be opened.',true);}}
    finally{starting.current=false;}
  };
  const loudest=Math.max(.02,...levels);
  return <>
    <button type="button" className="dm-icon" aria-label="Record voice message" disabled={disabled||phase!=='idle'} onClick={()=>void start()}><Mic size={22}/></button>
    {phase!=='idle'&&<div className={`wa-recorder ${phase}`} role="region" aria-label="Voice recording">
      <button type="button" className="wa-recorder-icon" aria-label="Discard recording" disabled={phase==='sending'} onClick={reset}><Trash2 size={21}/></button>
      {phase==='preview'||phase==='sending'
        ?preview&&<VoiceMessage id="voice-preview" src={preview} durationMs={duration} own compact peaks={recorded}/>
        :<div className="wa-recorder-live">
          <span className="wa-recorder-dot" aria-hidden="true"/>
          <time aria-live="off">{time(duration)}</time>
          <span className="wa-recorder-bars" aria-hidden="true">
            {Array.from({length:BARS},(_,i)=>{const level=levels[levels.length-BARS+i]??0;return <i key={i} style={{height:`${Math.max(10,Math.min(100,(level/loudest)*100))}%`}}/>;})}
          </span>
        </div>}
      {phase==='recording'&&<button type="button" className="wa-recorder-icon stop" aria-label="Stop and review" onClick={()=>recorder.current?.stop()}><Square size={16} fill="currentColor"/></button>}
      <button type="button" className="wa-recorder-send" aria-label="Send voice message" disabled={phase==='acquiring'||phase==='sending'}
        onClick={()=>{if(phase==='recording'){sendNow.current=true;recorder.current?.stop();}else if(phase==='preview')void deliver();}}>
        {phase==='sending'?<Loader2 size={20} className="spin"/>:<Send size={20}/>}
      </button>
    </div>}
  </>;
}
