"use client";
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Plus, Check, Clock3, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSession, useToast } from "./providers";

export default function FollowButton({
  id,
  following,
  requested = false,
  compact = false,
  variant = "text",
}: {
  id: string;
  following: boolean;
  requested?: boolean;
  compact?: boolean;
  variant?: "text" | "badge";
}) {
  return (
    <FollowControl
      key={`${id}-${following}-${requested}`}
      id={id}
      initialFollowing={following}
      initialRequested={requested}
      compact={compact}
      variant={variant}
    />
  );
}
function FollowControl({
  id,
  initialFollowing,
  initialRequested,
  compact,
  variant,
}: {
  id: string;
  initialFollowing: boolean;
  initialRequested: boolean;
  compact: boolean;
  variant: "text" | "badge";
}) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: (active: boolean) =>
      api(active ? "followsUnfollow" : "followsFollow", {
        params: { id },
      }),
    onSuccess: (data) => {
      // Share the relationship immediately with profiles; refresh feed and suggestion caches.
      client.setQueriesData<{ isFollowing: boolean; isFollowRequested?: boolean }>({ queryKey: ["profile"] }, old => old && "id" in old && old.id === id ? { ...old, isFollowing: data.status === "FOLLOWING", isFollowRequested: data.status === "REQUESTED" } : old);
      void client.invalidateQueries();
      if (data.status === "REQUESTED") toast("Follow request sent.");
    },
    onError: (error) => toast(error.message, true),
    onSettled: () => { inFlight.current = false; },
  });
  const following = mutation.data
    ? mutation.data.status === "FOLLOWING"
    : initialFollowing;
  const requested = mutation.data
    ? mutation.data.status === "REQUESTED"
    : initialRequested;
  const send = (active: boolean) => {
    if (!user) { toast("Sign in to follow people."); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(active);
  };
  if (user?.id === id) return null;
  if (variant === "badge") return <button type="button" className={`reel-follow-badge ${following ? "following" : requested ? "requested" : ""}`} disabled={mutation.isPending || following || requested}
    aria-label={following ? "Following creator" : requested ? "Follow request pending" : "Follow creator"} title={following ? "Following" : requested ? "Request pending" : "Follow creator"} onClick={() => send(false)}>
    {mutation.isPending ? <Loader2 size={13} className="spin" /> : following ? <Check size={13} /> : requested ? <Clock3 size={13} /> : <Plus size={14} />}
  </button>;
  return (
    <button
      className={`button ${following || requested ? "secondary" : compact ? "soft" : ""} ${compact ? "small" : ""}`}
      disabled={mutation.isPending}
      onClick={() => send(following || requested)}
    >
      {mutation.isPending ? (
        <Loader2 size={15} className="spin" />
      ) : following ? (
        <Check size={15} />
      ) : requested ? null : (
        <UserPlus size={15} />
      )}{" "}
      {following ? "Following" : requested ? "Requested" : "Follow"}
    </button>
  );
}
