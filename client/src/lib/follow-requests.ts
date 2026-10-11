"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/client";

export type FollowRequestDecision = "accept" | "reject";

/**
 * The single follow-request approval flow, shared by Settings, the Notifications page and
 * the Activity widget. A request is identified by the requester's user id (the notification
 * `actor.id`). Every caller gets its own mutation instance, so loading state is per request.
 */
export function useFollowRequestDecision(requesterId: string) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["follow-request", requesterId],
    mutationFn: (decision: FollowRequestDecision) =>
      api(decision === "accept" ? "followsAccept" : "followsReject", {
        params: { userId: requesterId },
      }),
    onSettled: () => {
      // Success and "already handled elsewhere" both change server state: resync every view.
      for (const key of [
        "notifications",
        "unread",
        "follow-requests",
        "session",
        "profile",
        "connections",
        "suggestions",
      ])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
  return {
    ...mutation,
    decide: (decision: FollowRequestDecision) => {
      if (!mutation.isPending) mutation.mutate(decision);
    },
  };
}

/** User-facing message for a failed decision. */
export function followRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return "This request is no longer pending — it was already handled or cancelled.";
    if (error.status === 401) return "Your session has expired. Please sign in again.";
    if (error.status === 0) return "You appear to be offline. Check your connection and try again.";
    return error.message;
  }
  if (error instanceof TypeError)
    return "You appear to be offline. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}
