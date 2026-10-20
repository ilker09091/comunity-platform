"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus as Camera, LogOut, Pencil, Send, Settings2, UsersRound as Users, UserPlus, X } from 'lucide-react';
import { api, upload, type Models } from '@/lib/api/client';
import { useMediaAttachment } from '@/lib/use-media-attachment';
import { useSession, useToast } from './providers';
import { Avatar, ConfirmDialog, ErrorState, LoadMore, Modal } from './ui';
import { RecipientPicker } from './social-controls';
import { StickerButton } from './sticker-picker';
import { VoiceRecorder } from './voice-message';
import { useCalls } from './calls';
import { ImageViewer } from './image-viewer';

type User=Models['UserSummaryDto'];
type Group=Models['GroupDetailDto'];
type Message=Models['GroupMessageDto'];
type Draft={content?:string;mediaId?:string;audioId?:string;stickerId?:string;gifId?:string;replyToId?:string};
export function GroupAvatar({group,size=48}:{group:{name:string;avatarUrl?:string|null};size?:number}) {
  return <span className="group-avatar" role="img" aria-label={`${group.name} group photo`} style={{width:size,height:size}}>
    {group.avatarUrl?<img src={group.avatarUrl} alt=""/>:<Users size={Math.round(size*.48)} aria-hidden="true"/>}
  </span>;
}
export type GroupMessageActions={own:boolean;first:boolean;last:boolean;replyAuthor?:string;onReply:(message:Models['DirectMessageDto'])=>void;onEdit:(message:Models['DirectMessageDto'])=>void;onUnsend:(message:Models['DirectMessageDto'])=>void;onJump:(id:string)=>void};

export function useGroups(enabled=true) {
  const {user}=useSession();
  return useInfiniteQuery({queryKey:['messages',user?.id,'groups'],
    queryFn:({pageParam,signal})=>api('groupsList',{query:{cursor:pageParam,limit:20},signal}),
    initialPageParam:undefined as string|undefined,getNextPageParam:page=>page.hasMore?page.nextCursor??undefined:undefined,
    refetchInterval:5000,enabled:enabled&&!!user});
}

function SelectedPeople({people,onRemove}:{people:User[];onRemove:(id:string)=>void}) {
  return <div className="group-selected">{people.map(person=><button type="button" key={person.id} aria-label={`Remove ${person.displayName}`} onClick={()=>onRemove(person.id)}><Avatar user={person} size={26}/>{person.displayName}<X size={13}/></button>)}</div>;
}

export function CreateGroup({onClose}:{onClose:()=>void}) {
  const [name,setName]=useState(''),[people,setPeople]=useState<User[]>([]);
  const client=useQueryClient(),router=useRouter(),toast=useToast();
  const create=useMutation({mutationFn:()=>api('groupsCreate',{body:{name:name.trim(),memberIds:people.map(person=>person.id)}}),
    onSuccess:group=>{void client.invalidateQueries({queryKey:['messages']});onClose();router.push(`/messages?group=${group.id}`);},onError:error=>toast(error.message,true)});
  return <Modal title="New group chat" onClose={onClose} className="group-create-dialog" guardClose={()=>!create.isPending}>
    <div className="group-create-body"><label className="form-field"><span>Group name</span><input aria-label="Group name" maxLength={60} value={name} onChange={event=>setName(event.target.value)} placeholder="Friends, weekend plans…"/></label>
      <p className="muted">Choose at least two people. Add people who follow you or have accepted your messages.</p>
      <SelectedPeople people={people} onRemove={id=>setPeople(current=>current.filter(person=>person.id!==id))}/>
      <RecipientPicker disabled={create.isPending} onSelect={person=>setPeople(current=>current.some(value=>value.id===person.id)?current.filter(value=>value.id!==person.id):current.length<31?[...current,person]:current)}/>
      <button type="button" className="button group-create-submit" disabled={!name.trim()||people.length<2||create.isPending} onClick={()=>create.mutate()}><Users size={18}/>{create.isPending?'Creating…':`Create group${people.length?` · ${people.length+1} people`:''}`}</button>
    </div>
  </Modal>;
}

function GroupSettings({group,onClose}:{group:Group;onClose:()=>void}) {
  const {user}=useSession(),router=useRouter(),client=useQueryClient(),toast=useToast();
  const [name,setName]=useState(group.name),[adding,setAdding]=useState(false),[remove,setRemove]=useState<User|null>(null),[leaving,setLeaving]=useState(false);
  const photoInput=useRef<HTMLInputElement>(null),[photoProgress,setPhotoProgress]=useState<number|null>(null);
  const refresh=()=>void client.invalidateQueries({queryKey:['messages']});
  const owner=group.ownerId===user?.id;
  const photo=useMutation({mutationFn:async(file:File|null)=>{
    if(!file)return api('groupsRemoveAvatar',{params:{id:group.id}});
    if(!file.type.startsWith('image/'))throw new Error('Choose a photo for the group.');
    const media=await upload(file,setPhotoProgress) as Models['MediaDto'];
    try{return await api('groupsSetAvatar',{params:{id:group.id},body:{mediaId:media.id}});}
    catch(error){void api('mediaRemove',{params:{id:media.id}}).catch(()=>{});throw error;}
  },onSuccess:updated=>{client.setQueryData(['messages',user?.id,'group',group.id],updated);refresh();toast('Group photo updated.');},onError:error=>toast(error.message,true),onSettled:()=>setPhotoProgress(null)});
  const rename=useMutation({mutationFn:()=>api('groupsRename',{params:{id:group.id},body:{name:name.trim()}}),onSuccess:()=>{refresh();toast('Group name updated.');},onError:error=>toast(error.message,true)});
  const add=useMutation({mutationFn:(id:string)=>api('groupsAddMembers',{params:{id:group.id},body:{memberIds:[id]}}),onSuccess:()=>{refresh();setAdding(false);},onError:error=>toast(error.message,true)});
  const removeMember=useMutation({mutationFn:(id:string)=>api('groupsRemoveMember',{params:{id:group.id,userId:id}}),onSuccess:()=>{setRemove(null);refresh();},onError:error=>toast(error.message,true)});
  const leave=useMutation({mutationFn:()=>api('groupsLeave',{params:{id:group.id}}),onSuccess:()=>{onClose();refresh();router.push('/messages');},onError:error=>toast(error.message,true)});
  return <><Modal title="Group details" onClose={onClose} className="group-settings-dialog" guardClose={()=>!photo.isPending}><div className="group-settings-body">
    <div className="group-photo-editor"><GroupAvatar group={group} size={88}/>
      {owner&&<><div className="group-photo-actions"><button type="button" className="button secondary small" disabled={photo.isPending} onClick={()=>photoInput.current?.click()}><Camera size={16}/>{photo.isPending?'Updating…':group.avatarUrl?'Change group photo':'Add group photo'}</button>{group.avatarUrl&&<button type="button" className="button secondary small" disabled={photo.isPending} onClick={()=>photo.mutate(null)}>Remove photo</button>}</div>
      <input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)photo.mutate(file);}}/>
      {photo.isPending&&<small role="status">{photoProgress===null?'Saving group photo…':`Uploading… ${photoProgress}%`}</small>}</>}
    </div>
    {owner?<form className="group-rename" onSubmit={event=>{event.preventDefault();if(name.trim())rename.mutate();}}><input aria-label="Rename group" value={name} maxLength={60} onChange={event=>setName(event.target.value)}/><button className="button small" disabled={!name.trim()||name===group.name||rename.isPending}>Save</button></form>:<h3>{group.name}</h3>}
    <p className="muted">{group.memberCount} members · Private group chat</p>
    <div className="group-member-list">{group.members.map(member=><div key={member.id}><Avatar user={member} size={40}/><span><strong>{member.displayName}</strong><small>{member.id===group.ownerId?'Owner':member.id===user?.id?'You':member.username?`@${member.username}`:'Account unavailable'}</small></span>{owner&&member.id!==user?.id&&<button type="button" className="dm-icon" aria-label={`Remove ${member.displayName} from group`} onClick={()=>setRemove(member)}><X size={18}/></button>}</div>)}</div>
    {owner&&group.memberCount<32&&<button type="button" className="button secondary" onClick={()=>setAdding(true)}><UserPlus size={17}/> Add members</button>}
    {adding&&<RecipientPicker disabled={add.isPending} onSelect={person=>{if(group.members.some(member=>member.id===person.id))toast('Already in this group.');else add.mutate(person.id);}}/>}
    <button type="button" className="button secondary danger-text" onClick={()=>setLeaving(true)}><LogOut size={17}/> Leave group</button>
  </div></Modal>
    {remove&&<ConfirmDialog title={`Remove ${remove.displayName}?`} description="They will lose access to this group chat." confirmLabel="Remove" onClose={()=>setRemove(null)} pending={removeMember.isPending} onConfirm={()=>removeMember.mutate(remove.id)}/>}
    {leaving&&<ConfirmDialog title="Leave this group?" description={owner?'Ownership passes to the longest-standing remaining member. The last member leaving deletes the group.':'You will lose access to messages until someone adds you again.'} confirmLabel="Leave group" onClose={()=>setLeaving(false)} pending={leave.isPending} onConfirm={()=>leave.mutate()}/>}
  </>;
}

export function GroupThread({id,renderMessage}:{id:string;renderMessage:(message:Message,actions:GroupMessageActions)=>ReactNode}) {
  const {user}=useSession(),client=useQueryClient(),toast=useToast(),calls=useCalls();
  const group=useQuery({queryKey:['messages',user?.id,'group',id],queryFn:({signal})=>api('groupsGet',{params:{id},signal}),refetchInterval:5000});
  const history=useInfiniteQuery({queryKey:['messages',user?.id,'group-thread',id],queryFn:({pageParam,signal})=>api('groupsMessages',{params:{id},query:{cursor:pageParam,limit:30},signal}),
    initialPageParam:undefined as string|undefined,getNextPageParam:page=>page.hasMore?page.nextCursor??undefined:undefined,refetchInterval:3000});
  const messages=[...new Map((history.data?.pages.flatMap(page=>page.items)??[]).map(message=>[message.id,message])).values()].reverse();
  const latest=messages.at(-1)?.id;
  const [text,setText]=useState(''),[settings,setSettings]=useState(false),[editing,setEditing]=useState<Models['DirectMessageDto']|null>(null),[reply,setReply]=useState<Models['DirectMessageDto']|null>(null),[unsending,setUnsending]=useState<Models['DirectMessageDto']|null>(null),[voice,setVoice]=useState(false),[preview,setPreview]=useState(false);
  const [dock,setDock]=useState<HTMLDivElement|null>(null);
  const attachment=useMediaAttachment(),file=useRef<HTMLInputElement>(null),input=useRef<HTMLTextAreaElement>(null),scroller=useRef<HTMLDivElement>(null),list=useRef<HTMLOListElement>(null),pinned=useRef(true),acknowledged=useRef('');
  const refresh=()=>void client.invalidateQueries({queryKey:['messages']});
  const send=useMutation({mutationFn:(draft:Draft)=>api('groupsSend',{params:{id},body:draft}),onSuccess:()=>{attachment.attached();setReply(null);refresh();},onError:(error,draft)=>{if(draft&&'content' in draft&&draft.content)setText(current=>current||draft.content!);toast(error.message,true);}});
  const edit=useMutation({mutationFn:()=>api('groupsEdit',{params:{id,messageId:editing!.id},body:{content:text.trim()}}),onSuccess:()=>{setEditing(null);setText('');refresh();},onError:error=>toast(error.message,true)});
  const unsend=useMutation({mutationFn:()=>api('groupsUnsend',{params:{id,messageId:unsending!.id}}),onSuccess:()=>{setUnsending(null);refresh();},onError:error=>toast(error.message,true)});
  useEffect(()=>{if(reply||editing)input.current?.focus({preventScroll:true});},[reply,editing]);
  useEffect(()=>{const element=input.current;if(element){element.style.height='auto';element.style.height=`${element.scrollHeight}px`;}},[text]);
  useEffect(()=>{if(pinned.current&&scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;},[latest]);
  useEffect(()=>{const observer=new ResizeObserver(()=>{if(pinned.current&&scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;});if(list.current)observer.observe(list.current);if(scroller.current)observer.observe(scroller.current);return()=>observer.disconnect();},[group.isPending]);
  useEffect(()=>{
    const root=scroller.current,node=latest?document.getElementById(`msg-${latest}`):null;if(!root||!node||!latest)return;
    const acknowledge=()=>{
      const box=node.getBoundingClientRect(),bounds=root.getBoundingClientRect();
      const read=document.visibilityState==='visible'&&document.hasFocus()&&box.bottom>bounds.top&&box.top<bounds.bottom&&!document.querySelector('dialog:modal');
      const key=`${latest}:${read}`;if(acknowledged.current===key)return;
      acknowledged.current=key;
      void api('groupsAcknowledge',{params:{id},body:{messageId:latest,read}}).then(()=>client.invalidateQueries({queryKey:['messages',user?.id,'groups']})).catch(()=>{acknowledged.current='';});
    };
    const observer=new IntersectionObserver(acknowledge,{root});observer.observe(node);
    root.addEventListener('scroll',acknowledge);document.addEventListener('visibilitychange',acknowledge);window.addEventListener('focus',acknowledge);acknowledge();
    return()=>{observer.disconnect();root.removeEventListener('scroll',acknowledge);document.removeEventListener('visibilitychange',acknowledge);window.removeEventListener('focus',acknowledge);};
  },[latest,id,client,user?.id,history.data]);
  const submit=()=>{
    if(editing){if(text.trim()&&!edit.isPending)edit.mutate();return;}
    if(send.isPending||attachment.busy||voice||(!text.trim()&&!attachment.media))return;
    const draft={content:text.trim()||undefined,mediaId:attachment.media?.id,replyToId:reply?.id};setText('');pinned.current=true;send.mutate(draft);input.current?.focus({preventScroll:true});
  };
  const jump=(messageId:string)=>{const node=document.getElementById(`msg-${messageId}`);if(node)node.scrollIntoView({block:'center',behavior:'smooth'});else toast('That message is further up this conversation.');};
  if(group.isPending)return <p className="dm-status" role="status">Loading group…</p>;
  if(group.error)return <div className="dm-empty"><ErrorState error={group.error} retry={()=>void group.refetch()}/><Link href="/messages" className="button secondary">Back to messages</Link></div>;
  const g=group.data!;
  return <section className="dm-thread group-thread" aria-label={`Group conversation ${g.name}`}>
    <header className="dm-thread-head"><Link href="/messages" className="dm-icon dm-back" aria-label="Back to conversations"><ArrowLeft size={23}/></Link><GroupAvatar group={g}/><button type="button" className="group-title" onClick={()=>setSettings(true)}><strong>{g.name}</strong><small>{g.memberCount} members</small></button><button className="dm-icon" aria-label="Group details" onClick={()=>setSettings(true)}><Settings2 size={22}/></button></header>
    <div className="dm-scroll" ref={scroller} onScroll={()=>{const element=scroller.current;if(element)pinned.current=element.scrollHeight-element.scrollTop-element.clientHeight<80;}}>
      <LoadMore hasMore={history.hasNextPage} pending={history.isFetchingNextPage} onClick={()=>void history.fetchNextPage()}/>
      {history.error&&<ErrorState error={history.error} retry={()=>void history.refetch()}/>}
      {!history.isPending&&!history.hasNextPage&&!messages.length&&<div className="dm-intro"><GroupAvatar group={g} size={88}/><strong>{g.name}</strong><span>A private space for {g.memberCount} people</span></div>}
      <ol className="dm-messages" ref={list}>{messages.map((message,index)=>{
        const own=message.senderId===user?.id,first=messages[index-1]?.senderId!==message.senderId,last=messages[index+1]?.senderId!==message.senderId;
        return <Fragment key={message.id}>{!own&&first&&<li className="group-message-author">{message.sender.displayName}</li>}{renderMessage(message,{own,first,last,replyAuthor:g.members.find(member=>member.id===message.replyTo?.senderId)?.displayName,onReply:value=>{setReply(value);setEditing(null);},onEdit:value=>{setEditing(value);setText(value.content??'');setReply(null);attachment.clear();},onUnsend:setUnsending,onJump:jump})}</Fragment>;
      })}</ol>
    </div>
    <form className="dm-composer" onSubmit={event=>{event.preventDefault();submit();}}>
      {(reply||editing)&&<div className="dm-replying">{editing?<Pencil size={16}/>:<Send size={16}/>}<span><strong>{editing?'Editing message':'Replying to message'}</strong><small>{(editing??reply)?.content||'Attachment'}</small></span><button type="button" className="dm-icon" aria-label={editing?'Cancel edit':'Cancel reply'} onClick={()=>{setReply(null);if(editing){setEditing(null);setText('');}}}><X size={17}/></button></div>}
      {attachment.previewUrl&&<div className="dm-attachment-preview"><div className="dm-draft-media">{attachment.previewType==='VIDEO'?<video src={attachment.previewUrl} controls playsInline/>:<button type="button" aria-label="Open photo preview" onClick={()=>setPreview(true)}><img src={attachment.previewUrl} alt="Photo preview before sending"/></button>}</div><button type="button" className="dm-icon" aria-label="Remove attachment" onClick={attachment.clear}><X size={17}/></button></div>}
      {attachment.uploading&&<p className="dm-notice">Uploading… {attachment.progress}%</p>}{attachment.error&&<p className="dm-notice error">{attachment.error}</p>}
      <div className="dm-compose-row">
        <button type="button" className="dm-camera-launch dm-icon" aria-label="Attach photo or video" hidden={!!text.trim()||!!editing} disabled={attachment.busy||voice} onClick={()=>file.current?.click()}><Camera size={23}/></button>
        <textarea ref={input} aria-label="Message" placeholder="Message…" rows={1} maxLength={2000} value={text} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&window.matchMedia('(hover: hover)').matches){event.preventDefault();submit();}}}/>
        <div className="dm-compose-actions" hidden={!!text.trim()||!!editing||!!attachment.media}>
          <StickerButton conversation dock={dock} disabled={send.isPending||attachment.busy||voice||!!attachment.media} onPick={sticker=>send.mutate({stickerId:sticker.id,replyToId:reply?.id})} onGif={gif=>send.mutate({gifId:gif.id,replyToId:reply?.id})}/>
          {!calls.busy&&<VoiceRecorder disabled={send.isPending||attachment.busy||!!attachment.media} onActiveChange={setVoice} onSend={async audioId=>{await send.mutateAsync({audioId,replyToId:reply?.id});}}/>}
        </div>
        <input ref={file} hidden type="file" accept="image/*,video/*" onChange={event=>{void attachment.select(event.target.files?.[0]);event.target.value='';}}/>
        {(!!text.trim()||!!attachment.media||!!editing)&&<button type="submit" className="dm-send" aria-label={editing?'Save edit':'Send message'} disabled={send.isPending||edit.isPending||attachment.busy||voice||(!text.trim()&&!attachment.media)} onPointerDown={event=>event.preventDefault()}>{editing?'Save':'Send'}</button>}
      </div>
    </form>
    <div className="dm-sticker-dock" ref={setDock}/>
    {settings&&<GroupSettings group={g} onClose={()=>setSettings(false)}/>}
    {unsending&&<ConfirmDialog title="Unsend message?" description="It will be removed for everyone in this group." confirmLabel="Unsend" pending={unsend.isPending} onClose={()=>setUnsending(null)} onConfirm={()=>unsend.mutate()}/>}
    {preview&&attachment.previewUrl&&<ImageViewer src={attachment.previewUrl} alt="Photo preview" onClose={()=>setPreview(false)}/>}
  </section>;
}
