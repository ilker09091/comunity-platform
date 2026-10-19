"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSession, useToast } from "./providers";
export default function MessageStreak({peerId}:{peerId:string}) {
  const {user}=useSession(),toast=useToast(),client=useQueryClient();
  const key=["messages",user?.id,"streak",peerId];
  const query=useQuery({queryKey:key,queryFn:({signal})=>api("messagesStreak",{params:{id:peerId},signal}),refetchInterval:15000,retry:false});
  const restore=useMutation({mutationFn:()=>api("messagesRestoreStreak",{params:{id:peerId}}),onSuccess:value=>{client.setQueryData(key,value);toast("Streak restored. Exchange messages today to keep it going.");},onError:error=>toast(error.message,true)});
  const streak=query.data;if(!streak||query.isError)return null;
  if(streak.state==="expired"&&!streak.canRestore)return null;
  if(streak.days<3)return <p className="dm-streak-building">Exchange messages for 3 days to start a streak · {streak.days}/3</p>;
  const tip=streak.state==="expired"?"Your streak ended.":streak.state==="fading"?"Your streak is fading. Both of you need to send a message.":streak.sentToday&&streak.peerSentToday?"You both messaged today.":"Keep your streak: both of you need to send a message today.";
  return <div className={`dm-streak ${streak.state}`} title={tip}>
    <Flame size={18} aria-hidden="true"/><strong>{streak.days} day streak</strong><span>{tip}</span>
    {streak.canRestore&&<button className="button secondary small" disabled={restore.isPending} onClick={()=>restore.mutate()}>Restore ({streak.restoresRemaining} left)</button>}
  </div>;
}
