"use client";
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Send, Users, X } from 'lucide-react';
import { api, type Models } from '@/lib/api/client';
import { useToast } from './providers';
import { Modal, LoadMore } from './ui';
import { RecipientPicker } from './social-controls';
import { GroupAvatar, useGroups } from './group-chat';

type Target={id:string;name:string;group:boolean};
export function ShareLinkDialog({title,path,onClose}:{title:string;path:string;onClose:()=>void}) {
  const [tab,setTab]=useState<'people'|'groups'>('people'),[selected,setSelected]=useState<Target[]>([]),[comment,setComment]=useState('');
  const groups=useGroups(),toast=useToast(),client=useQueryClient();
  const toggle=(target:Target)=>setSelected(current=>current.some(value=>value.id===target.id&&value.group===target.group)?current.filter(value=>value.id!==target.id||value.group!==target.group):current.length<20?[...current,target]:current);
  const send=useMutation({mutationFn:async()=>{
    const content=[comment.trim(),title,new URL(path,window.location.origin).href].filter(Boolean).join('\n');
    const results=await Promise.allSettled(selected.map(target=>target.group?api('groupsSend',{params:{id:target.id},body:{content}}):api('messagesSend',{params:{id:target.id},body:{content}})));
    return results;
  },onSuccess:results=>{
    const failed=selected.filter((_,index)=>results[index].status==='rejected'),sent=results.length-failed.length;
    void client.invalidateQueries({queryKey:['messages']});
    if(!failed.length){toast(`Sent to ${sent} conversation${sent===1?'':'s'}.`);onClose();}
    else{setSelected(failed);const error=results.find(result=>result.status==='rejected');toast(`${sent?`${sent} sent. `:''}${error?.status==='rejected'&&error.reason instanceof Error?error.reason.message:'Unable to send to the remaining conversations.'}`,true);}
  },onError:error=>toast(error.message,true)});
  return <Modal title="Send Circle invite" onClose={onClose} className="share-invite-dialog" guardClose={()=>!send.isPending}>
    <div className="share-invite-body"><div className="share-invite-preview"><span className="group-avatar"><Users size={26}/></span><span><strong>{title}</strong><small>Circle invitation · Tap to join</small></span></div>
      <div className="share-invite-tabs" role="tablist" aria-label="Share to"><button type="button" role="tab" aria-selected={tab==='people'} onClick={()=>setTab('people')}>People</button><button type="button" role="tab" aria-selected={tab==='groups'} onClick={()=>setTab('groups')}>Groups</button></div>
      <div className="group-selected">{selected.map(target=><button type="button" key={`${target.group}:${target.id}`} onClick={()=>toggle(target)} aria-label={`Remove ${target.name}`}>{target.name}<X size={13}/></button>)}</div>
      {tab==='people'?<RecipientPicker disabled={send.isPending} onSelect={(person:Models['UserSummaryDto'])=>toggle({id:person.id,name:person.displayName,group:false})}/>:<div className="group-share-list">{groups.data?.pages.flatMap(page=>page.items).map(group=><button type="button" key={group.id} disabled={send.isPending} onClick={()=>toggle({id:group.id,name:group.name,group:true})}><GroupAvatar group={group} size={40}/><span><strong>{group.name}</strong><small>{group.memberCount} members</small></span>{selected.some(target=>target.group&&target.id===group.id)&&<Check size={20}/>}</button>)}{!groups.isPending&&!groups.data?.pages[0]?.items.length&&<p className="muted">Create a group chat from Messages first.</p>}<LoadMore hasMore={groups.hasNextPage} pending={groups.isFetchingNextPage} onClick={()=>void groups.fetchNextPage()}/></div>}
      <input className="social-input" aria-label="Add a message" placeholder="Add a message…" maxLength={1000} value={comment} onChange={event=>setComment(event.target.value)}/>
      <button type="button" className="button group-create-submit" disabled={!selected.length||send.isPending} onClick={()=>send.mutate()}><Send size={18}/>{send.isPending?'Sending…':`Send${selected.length?` · ${selected.length}`:''}`}</button>
    </div>
  </Modal>;
}
