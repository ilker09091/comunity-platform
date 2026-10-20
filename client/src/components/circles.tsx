"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Loader2, MessageCircleQuestion, Plus, Ticket, UsersRound } from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useSession, useToast } from "./providers";
import { Avatar, EmptyState, ErrorState, LoadingSkeleton, Modal, SignInPrompt } from "./ui";

export type Circle = Models["CircleDto"];
type Streak = Models["CircleStreakDto"];
export const CIRCLE_COLORS = ["#7c5cff", "#258cf4", "#12b886", "#f59f00", "#f03e3e", "#e64980", "#0ca678", "#495057"];
export const CIRCLE_EMOJIS = ["🫶", "📚", "⚽", "🎮", "🎨", "🎵", "🍕", "🔥", "🌙", "🚀", "🏀", "🎬", "🧪", "🌿", "✈️", "💜"];
export const KIND_LABEL: Record<Circle["kind"], string> = { friends: "Friends", class: "Class", club: "Club" };

/** The circle's picture: its emoji on a soft gradient of its colour. */
export function CircleMark({ circle, size = 56 }: { circle: Pick<Circle, "emoji" | "color" | "name">; size?: number }) {
  return (
    <span className="circle-mark" role="img" aria-label={circle.name}
      style={{ width: size, height: size, fontSize: size * 0.48, ["--circle" as string]: circle.color }}>
      {circle.emoji}
    </span>
  );
}

export function AvatarStack({ users, total, size = 26 }: { users: Models["UserSummaryDto"][]; total: number; size?: number }) {
  return (
    <span className="circle-avatars" aria-label={`${total} member${total === 1 ? "" : "s"}`}>
      {users.slice(0, 4).map((user) => <Avatar key={user.id} user={user} size={size} />)}
      {total > 4 && <span className="circle-avatars-more" style={{ width: size, height: size }}>+{total - 4}</span>}
    </span>
  );
}

/** "🔥 12": the shared streak; orange when alive, red when it ends tonight, grey otherwise. */
export function StreakChip({ streak }: { streak: Streak }) {
  const state = streak.completedToday ? "done" : streak.atRisk ? "risk" : streak.days ? "open" : "none";
  return (
    <span className={`circle-streak-chip ${state}`} title={streak.best ? `Best: ${streak.best} days` : undefined}>
      <Flame size={15} fill={state === "done" ? "currentColor" : "none"} aria-hidden="true" />
      {streak.days}
      <span className="sr-only">day shared streak</span>
    </span>
  );
}

/** Today's participation as a ring: filled share of the people needed. */
export function ProgressRing({ streak, size = 40 }: { streak: Streak; size?: number }) {
  const stroke = 3.5, radius = (size - stroke) / 2, length = 2 * Math.PI * radius;
  const ratio = streak.needed ? Math.min(1, streak.todayCount / streak.needed) : 0;
  return (
    <span className={`circle-ring ${streak.completedToday ? "done" : streak.atRisk ? "risk" : ""}`} style={{ width: size, height: size }}
      role="img" aria-label={streak.needed ? `${Math.min(streak.todayCount, streak.needed)} of ${streak.needed} took part today` : "Streak not started"}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="track" />
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="value"
          strokeDasharray={length} strokeDashoffset={length * (1 - ratio)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span>{streak.needed ? `${Math.min(streak.todayCount, streak.needed)}/${streak.needed}` : "–"}</span>
    </span>
  );
}

export function streakMessage(streak: Streak) {
  if (!streak.needed) return "Invite at least one more person to start a shared streak.";
  const left = Math.max(0, streak.needed - streak.todayCount);
  if (streak.completedToday) return "Streak secured for today. See you tomorrow!";
  if (streak.atRisk) return `The streak ends tonight unless ${left} more ${left === 1 ? "person joins" : "people join"} in.`;
  return `${left} more ${left === 1 ? "person" : "people"} to keep the streak today.`;
}

export type CircleFields = { name: string; emoji: string; color: string; kind: Circle["kind"]; description: string };
export function CircleForm({ initial, pending, submitLabel, onSubmit, extra }: {
  initial?: Partial<CircleFields>; pending: boolean; submitLabel: string; onSubmit: (fields: CircleFields) => void; extra?: ReactNode;
}) {
  const [fields, setFields] = useState<CircleFields>({
    name: initial?.name ?? "", emoji: initial?.emoji ?? CIRCLE_EMOJIS[0], color: initial?.color ?? CIRCLE_COLORS[0],
    kind: initial?.kind ?? "friends", description: initial?.description ?? "",
  });
  const set = (patch: Partial<CircleFields>) => setFields((value) => ({ ...value, ...patch }));
  const valid = fields.name.trim().length >= 2;
  return (
    <form className="circle-form" onSubmit={(event) => { event.preventDefault(); if (valid && !pending) onSubmit(fields); }}>
      <div className="circle-form-preview">
        <CircleMark circle={{ ...fields, name: fields.name || "New circle" }} size={72} />
        <strong>{fields.name.trim() || "Your circle"}</strong>
        <small>{KIND_LABEL[fields.kind]}</small>
      </div>
      <label className="form-field">
        <span>Name</span>
        <input data-autofocus value={fields.name} maxLength={40} placeholder="e.g. Study crew, 11-B, Chess club"
          onChange={(event) => set({ name: event.target.value })} required />
      </label>
      <fieldset className="circle-choice">
        <legend>Picture</legend>
        <div className="circle-emojis">
          {CIRCLE_EMOJIS.map((emoji) => (
            <button type="button" key={emoji} aria-pressed={fields.emoji === emoji} aria-label={`Use ${emoji}`} onClick={() => set({ emoji })}>{emoji}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="circle-choice">
        <legend>Colour</legend>
        <div className="circle-colors">
          {CIRCLE_COLORS.map((color) => (
            <button type="button" key={color} style={{ background: color }} aria-pressed={fields.color === color} aria-label={`Colour ${color}`}
              onClick={() => set({ color })}>{fields.color === color && <Check size={16} />}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="circle-choice">
        <legend>Type</legend>
        <div className="circle-segment" role="radiogroup">
          {(Object.keys(KIND_LABEL) as Circle["kind"][]).map((kind) => (
            <button type="button" role="radio" key={kind} aria-checked={fields.kind === kind} onClick={() => set({ kind })}>{KIND_LABEL[kind]}</button>
          ))}
        </div>
      </fieldset>
      <label className="form-field">
        <span>Description <small>(optional)</small></span>
        <input value={fields.description} maxLength={160} placeholder="What brings you together?" onChange={(event) => set({ description: event.target.value })} />
      </label>
      {extra}
      <button type="submit" className="button full" disabled={!valid || pending}>
        {pending && <Loader2 size={16} className="spin" />}{submitLabel}
      </button>
    </form>
  );
}

/** Accepts a bare code or a full invite link. */
export function inviteCodeFrom(value: string) {
  const match = value.trim().match(/([A-Za-z0-9]{6,10})\/?$/);
  return match ? match[1].toUpperCase() : null;
}

function CreateCircle({ onClose }: { onClose: () => void }) {
  const router = useRouter(), client = useQueryClient(), toast = useToast();
  const create = useMutation({
    mutationFn: (fields: CircleFields) => api("circlesCreate", {
      body: { name: fields.name.trim(), emoji: fields.emoji, color: fields.color, kind: fields.kind, description: fields.description.trim() || null },
    }),
    onSuccess: (circle) => {
      haptic("success");
      void client.invalidateQueries({ queryKey: ["circles"] });
      router.push(`/circles/${circle.id}`);
    },
    onError: (error) => toast(error.message, true),
  });
  return (
    <Modal title="Create a circle" onClose={onClose} className="circle-dialog" guardClose={() => !create.isPending}>
      <CircleForm pending={create.isPending} submitLabel="Create circle" onSubmit={(fields) => create.mutate(fields)} />
    </Modal>
  );
}

function JoinByCode({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const code = inviteCodeFrom(value);
  return (
    <Modal title="Join a circle" onClose={onClose} className="circle-dialog">
      <form className="circle-form" onSubmit={(event) => { event.preventDefault(); if (code) router.push(`/circles/join/${code}`); }}>
        <p className="muted">Paste the invite link or type the code someone shared with you.</p>
        <label className="form-field">
          <span>Invite code or link</span>
          <input data-autofocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. K7Q2M9XD" autoCapitalize="characters" spellCheck={false} />
        </label>
        <button type="submit" className="button full" disabled={!code}>Continue</button>
      </form>
    </Modal>
  );
}

function CircleRow({ circle }: { circle: Circle }) {
  const status = circle.answeredToday ? (circle.streak.completedToday ? "Streak secured today" : "You answered today")
    : "Today’s question is waiting";
  return (
    <li>
      <Link href={`/circles/${circle.id}`} className="circle-row" style={{ ["--circle" as string]: circle.color }}>
        <span className="circle-row-mark">
          <CircleMark circle={circle} size={52} />
          {circle.hasNew && <span className="circle-new-dot" aria-label="New activity" />}
        </span>
        <span className="circle-row-text">
          <strong>{circle.name}</strong>
          <span className="circle-row-meta">{KIND_LABEL[circle.kind]} · {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}</span>
          <span className={`circle-row-status ${circle.answeredToday ? "" : "pending"}`}>
            {!circle.answeredToday && <MessageCircleQuestion size={13} aria-hidden="true" />}{status}
          </span>
        </span>
        <span className="circle-row-side">
          <StreakChip streak={circle.streak} />
          <ProgressRing streak={circle.streak} size={38} />
        </span>
      </Link>
    </li>
  );
}

export default function CirclesHome() {
  const { user, loading } = useSession();
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const circles = useQuery({
    queryKey: ["circles", user?.id],
    queryFn: ({ signal }) => api("circlesList", { signal }),
    enabled: !!user,
    refetchInterval: 30_000,
  });
  if (loading) return <LoadingSkeleton />;
  if (!user) return <SignInPrompt title="Circles" description="Sign in to create small groups with your closest people." />;
  const items = circles.data ?? [];
  return (
    <div className="circles-page">
      <header className="circles-head">
        <div>
          <h1>Circles</h1>
          <p>Private groups for the people you see every day. One question a day, a shared streak and albums for the moments in between.</p>
        </div>
        <div className="circles-hero-actions">
          <button type="button" className="button" onClick={() => setDialog("create")}><Plus size={17} /> Create</button>
          <button type="button" className="button secondary" onClick={() => setDialog("join")}><Ticket size={17} /> Join with code</button>
        </div>
      </header>
      {circles.isPending ? <LoadingSkeleton compact /> : circles.isError ? <ErrorState error={circles.error} retry={() => void circles.refetch()} /> : items.length ? (
        <ul className="card circle-list">{items.map((circle) => <CircleRow key={circle.id} circle={circle} />)}</ul>
      ) : (
        <div className="card">
          <EmptyState icon={<UsersRound size={30} />} title="Start your first circle"
            description="Bring your friends, your class or your club together. Everyone answers the daily question to keep the circle’s streak alive."
            action={<button type="button" className="button" onClick={() => setDialog("create")}><Plus size={17} /> Create a circle</button>} />
        </div>
      )}
      {dialog === "create" && <CreateCircle onClose={() => setDialog(null)} />}
      {dialog === "join" && <JoinByCode onClose={() => setDialog(null)} />}
    </div>
  );
}

export function CircleJoin({ code }: { code: string }) {
  const { user, loading } = useSession();
  const router = useRouter(), client = useQueryClient(), toast = useToast();
  const invite = useQuery({
    queryKey: ["circle-invite", code, user?.id],
    queryFn: ({ signal }) => api("circlesInvite", { params: { code }, signal }),
    enabled: !!user,
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => api("circlesJoin", { body: { code } }),
    onSuccess: (circle) => {
      haptic("success");
      void client.invalidateQueries({ queryKey: ["circles"] });
      router.replace(`/circles/${circle.id}`);
    },
    onError: (error) => toast(error.message, true),
  });
  if (loading) return <LoadingSkeleton />;
  if (!user) return <SignInPrompt title="You're invited to a circle" description="Sign in or create an account to join." />;
  if (invite.isPending) return <LoadingSkeleton compact />;
  if (invite.isError) return <div className="card"><EmptyState icon={<Ticket size={30} />} title="This invite doesn’t work" description={invite.error.message}
    action={<Link href="/circles" className="button secondary">Back to circles</Link>} /></div>;
  const circle = invite.data;
  return (
    <div className="card circle-invite" style={{ ["--circle" as string]: circle.color }}>
      <CircleMark circle={circle} size={96} />
      <small className="circle-invite-kicker">You’re invited to join</small>
      <h1>{circle.name}</h1>
      <p className="muted">{KIND_LABEL[circle.kind]} · {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}</p>
      {circle.description && <p>{circle.description}</p>}
      <AvatarStack users={circle.members} total={circle.memberCount} size={34} />
      {circle.circleId ? (
        <Link href={`/circles/${circle.circleId}`} className="button">You’re already in · Open circle</Link>
      ) : (
        <button type="button" className="button" disabled={circle.full || join.isPending} onClick={() => join.mutate()}>
          {join.isPending && <Loader2 size={16} className="spin" />}{circle.full ? "This circle is full" : "Join circle"}
        </button>
      )}
    </div>
  );
}
