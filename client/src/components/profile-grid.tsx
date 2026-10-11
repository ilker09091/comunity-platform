"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Images, Heart, MessageCircle, Repeat2, ImageOff, AlignLeft } from 'lucide-react';
import type { Post, Models } from '@/lib/api/client';

function ReelCover({video,caption}:{video:Models['MediaDto'];caption:string|null}) {
  const ref=useRef<HTMLVideoElement>(null);
  const [visible,setVisible]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>{
    const node=ref.current;if(!node || video.status!=='READY')return;
    if(typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'100px'});
    observer.observe(node);return()=>observer.disconnect();
  },[video.id,video.status]);
  return <>
    <div className="grid-video-fallback"><Clapperboard size={24}/><span>{video.status==='READY'?'Reel':'Video unavailable'}</span><p>{caption?.slice(0,95)}</p></div>
    <video ref={ref} className={`grid-reel-cover ${ready&&visible?'ready':''}`} src={visible?video.url:undefined} preload="metadata" muted playsInline aria-hidden="true"
      onLoadedMetadata={e=>{if(e.currentTarget.duration>.01)e.currentTarget.currentTime=.01;}}
      onLoadedData={()=>setReady(true)} onError={()=>setReady(false)}/>
  </>;
}

export default function ProfileGrid({posts}:{posts:Post[]}) {
  return <div className="profile-social-grid">{posts.map(post=>{
    const source=post.kind==='REPOST' && post.referencedPost?post.referencedPost:post;
    const video=source.media.find(m=>m.type==='VIDEO') ?? (post.kind==='QUOTE' ? post.referencedPost?.media.find(m=>m.type==='VIDEO') : undefined);
    const image=source.media.find(m=>m.type==='IMAGE' && m.status==='READY');
    const href=video?`/reels?start=${source.id}&media=${video.id}`:`/post/${source.id}`;
    return <Link key={post.id} href={href} className={`profile-tile ${!image?'text-tile':''}`} aria-label={`${video?'Reel':image?'Photo post':'Text post'} by @${source.author.username}${post.kind==='REPOST'?`, reposted by @${post.author.username}`:''}`}>
      {image?<img src={image.url} alt="" loading="lazy" decoding="async"/>:video?<ReelCover video={video} caption={source.content}/>:<div className="grid-text-preview"><AlignLeft size={16}/><p>{source.content?.slice(0,180)||'Attachment unavailable'}</p></div>}
      <span className="grid-media-badge">{video?<Clapperboard size={14}/>:source.media.length>1?<Images size={14}/>:source.media.length&&!image?<ImageOff size={14}/>:null}</span>
      {video?.durationMs!=null && <span className="grid-duration">{Math.floor(video.durationMs/60000)}:{String(Math.floor(video.durationMs/1000)%60).padStart(2,'0')}</span>}
      {post.kind==='REPOST' && <span className="grid-attribution"><Repeat2 size={12}/> @{source.author.username}</span>}
      <span className="grid-engagement"><span><Heart size={16}/> {source.likeCount}</span><span><MessageCircle size={16}/> {source.commentCount}</span></span>
    </Link>;
  })}</div>;
}
