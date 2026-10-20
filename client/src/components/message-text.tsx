"use client";
import Link from 'next/link';

/** Text stays escaped; only http(s) links are actionable, including shared Circle invites. */
export function MessageText({text}:{text:string}) {
  const parts=text.split(/((?:https?:\/\/|www\.)[^\s<>]+)/gi);
  return <p className="dm-message-text">{parts.map((part,index)=>{
    if(!/^(?:https?:\/\/|www\.)/i.test(part))return part;
    const link=part.replace(/[.,!?;:)\]}]+$/,'');const tail=part.slice(link.length);
    let url:URL;try{url=new URL(/^www\./i.test(link)?`https://${link}`:link);}catch{return part;}
    if(!['http:','https:'].includes(url.protocol))return part;
    const internal=typeof window!=='undefined'&&url.origin===window.location.origin;
    return <span key={index}>{internal?<Link href={url.pathname+url.search+url.hash}>{link}</Link>:<a href={url.href} target="_blank" rel="noopener noreferrer nofollow">{link}</a>}{tail}</span>;
  })}</p>;
}
