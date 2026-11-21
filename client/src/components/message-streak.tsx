"use client";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Hourglass } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import { Avatar, Modal } from "./ui";

type Streak = Models["StreakDto"];

export function useStreak(peerId: string, enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["messages", user?.id, "streak", peerId],
    queryFn: ({ signal }) => api("messagesStreak", { params: { id: peerId }, signal }),
    refetchInterval: 30_000,
    retry: false,
    enabled,
  });
}

/** Two-tone gradient flame; `dim` turns it grey for a fading or ended streak. */
export function FlameIcon({ size = 18, dim = false }: { size?: number; dim?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="streak-flame" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}o`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dim ? "#b7bec9" : "#ffb03a"} />
          <stop offset=".55" stopColor={dim ? "#9099a6" : "#ff5f2e"} />
          <stop offset="1" stopColor={dim ? "#7b8492" : "#f0266b"} />
        </linearGradient>
        <linearGradient id={`${id}i`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dim ? "#eef1f5" : "#fff6c2"} />
          <stop offset="1" stopColor={dim ? "#c9cfd8" : "#ffc93c"} />
        </linearGradient>
      </defs>
      <path
        className="streak-flame-outer"
        fill={`url(#${id}o)`}
        d="M12.6 1.6c.5 3-1 4.9-2.6 6.6C8.3 10 6.2 12 6.2 15.4a5.8 5.8 0 0 0 11.6 0c0-2.6-1.2-4.6-2.6-6 .1 1.7-.5 3-1.7 3.7.4-4.2-.6-8.4-.9-11.5z"
      />
      <path
        className="streak-flame-inner"
        fill={`url(#${id}i)`}
        d="M12.2 12.4c.3 1.5-.6 2.4-1.3 3.2-.5.5-.9 1.1-.9 2a2.1 2.1 0 0 0 4.2 0c0-1.7-.9-3.5-2-5.2z"
      />
    </svg>
  );
}

/** "5h 12m" left until the streak ends, from the server's expiry time. */
function timeLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  const minutes = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function tipFor(streak: Streak) {
  if (streak.state === "expired") return "Your streak ended because a day was missed.";
  if (streak.days < 3) return `Exchange messages ${3 - streak.days} more day${3 - streak.days === 1 ? "" : "s"} in a row to start a streak.`;
  if (streak.state === "fading") return `Your streak ends in ${timeLeft(streak.expiresAt)}. Both of you need to send a message.`;
  if (streak.sentToday && streak.peerSentToday) return "You both messaged today. See you tomorrow!";
  return "Both of you need to send a message today to keep it going.";
}

/**
 * TikTok-style streak chip for the chat header: a gradient flame and the day count. Tapping it
 * opens a sheet with today's progress for both people and, when possible, a restore button.
 */
export default function StreakChip({ peer }: { peer: Models["MessagePeerDto"] }) {
  const { user } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const query = useStreak(peer.id, !peer.isUnavailable);
  const [open, setOpen] = useState(false);
  const restore = useMutation({
    mutationFn: () => api("messagesRestoreStreak", { params: { id: peer.id } }),
    onSuccess: (value) => {
      haptic("success");
      client.setQueryData(["messages", user?.id, "streak", peer.id], value);
      toast("Streak restored. Exchange messages today to keep it going.");
    },
    onError: (error) => toast(error.message, true),
  });
  const streak = query.data;
  if (!streak || query.isError || peer.isUnavailable) return null;
  if (streak.state === "expired" && !streak.canRestore) return null;
  if (streak.days < 1) return null;
  const building = streak.days < 3 && streak.state !== "expired";
  const dim = streak.state === "fading" || streak.state === "expired" || building;
  const label = building
    ? `Streak progress ${streak.days} of 3 days`
    : `${streak.days} day streak${streak.state === "fading" ? ", fading" : streak.state === "expired" ? ", ended" : ""}`;
  return (
    <>
      <button
        type="button"
        className={`dm-streak-chip ${streak.state} ${building ? "building" : ""}`}
        aria-label={label}
        title={tipFor(streak)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          haptic("tap");
          setOpen(true);
        }}
      >
        {/* Re-mounts when the count changes, so the pop animation plays for a new day. */}
        <span key={streak.days} className="dm-streak-chip-flame">
          <FlameIcon size={16} dim={dim} />
        </span>
        <span className="dm-streak-chip-count">{building ? `${streak.days}/3` : streak.days}</span>
        {streak.state === "fading" && <Hourglass size={11} strokeWidth={2.4} aria-hidden="true" />}
      </button>
      {open && (
        <Modal title="Streak" className="dm-streak-sheet" onClose={() => setOpen(false)}>
          <div className="dm-streak-body">
          <div className={`dm-streak-hero ${streak.state} ${building ? "building" : ""}`}>
            <span className="dm-streak-hero-flame">
              <FlameIcon size={88} dim={dim} />
            </span>
            <strong className="dm-streak-hero-count">{streak.days}</strong>
            <span className="dm-streak-hero-label">{building ? "of 3 days to start a streak" : "day streak"}</span>
            <p>{tipFor(streak)}</p>
          </div>
          <div className="dm-streak-today" aria-label="Today">
            {[
              { who: user, name: "You", done: streak.sentToday },
              { who: peer, name: peer.displayName, done: streak.peerSentToday },
            ].map((side) => (
              <div key={side.name} className={`dm-streak-person ${side.done ? "done" : ""}`}>
                <span className="dm-streak-person-avatar">
                  <Avatar user={side.who} size={46} />
                  <span className="dm-streak-person-badge" aria-hidden="true">
                    {side.done ? <Check size={12} strokeWidth={3} /> : <FlameIcon size={12} dim />}
                  </span>
                </span>
                <span className="dm-streak-person-name">{side.name}</span>
                <small>{side.done ? "Sent today" : "Not yet today"}</small>
              </div>
            ))}
          </div>
          {streak.canRestore && (
            <button
              type="button"
              className="button dm-streak-restore"
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
            >
              {restore.isPending ? "Restoring…" : `Restore streak (${streak.restoresRemaining} left this month)`}
            </button>
          )}
          <ul className="dm-streak-rules">
            <li>Message each other 3 days in a row to light the flame.</li>
            <li>Every day, both of you need to send at least one message. Days follow UTC.</li>
            <li>When time is running out, the flame turns grey ⌛.</li>
            <li>Miss a day and the streak ends. You can restore it within 48 hours, up to 3 times a month.</li>
          </ul>
          </div>
        </Modal>
      )}
    </>
  );
}
