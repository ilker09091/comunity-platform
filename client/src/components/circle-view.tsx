"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Camera, Check, ChevronLeft, Copy, Crown, Flame, ImagePlus, Images, Link2, Loader2, Lock, LogOut,
  MessageCircleQuestion, MoreHorizontal, Plus, RefreshCw, Send, Settings2, Share2, Shield, Trash2, UserMinus, Vote, X,
} from "lucide-react";
import { api, type Models } from "@/lib/api/client";
import { haptic } from "@/lib/haptics";
import { useMediaAttachment } from "@/lib/use-media-attachment";
import { useSession, useToast } from "./providers";
import { Avatar, ConfirmDialog, Dropdown, EmptyState, ErrorState, LoadMore, LoadingSkeleton, Modal, relativeTime } from "./ui";
import { MediaVideo } from "./media-video";
import { ImageViewer } from "./image-viewer";
import { AvatarStack, CircleForm, CircleMark, KIND_LABEL, ProgressRing, StreakChip, streakMessage, type Circle } from "./circles";

type Post = Models["CirclePostDto"];
type Prompt = Models["CirclePromptDto"];
type Album = Models["CircleAlbumDto"];
type Tab = "today" | "feed" | "albums" | "members";
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" }, { id: "feed", label: "Feed" }, { id: "albums", label: "Albums" }, { id: "members", label: "Members" },
];
const ALBUM_DURATIONS = [{ hours: 24, label: "24 hours" }, { hours: 48, label: "2 days" }, { hours: 72, label: "3 days" }, { hours: 168, label: "1 week" }];
const isAdmin = (circle: Circle) => circle.role !== "member";

function useRefresh(circleId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["circle", circleId] });
    void client.invalidateQueries({ queryKey: ["circles"] });
  };
}
function timeLeft(value: string) {
  const minutes = Math.max(0, Math.round((new Date(value).getTime() - Date.now()) / 60000));
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h left`;
  return `${Math.round(minutes / 1440)}d left`;
}

function PostMedia({ media }: { media: NonNullable<Post["media"]> }) {
  const [open, setOpen] = useState(false);
  return media.type === "VIDEO" ? (
    <MediaVideo className="circle-post-media" src={media.url} controls playsInline preload="metadata"
      style={{ aspectRatio: media.width && media.height ? `${media.width}/${media.height}` : "9/16" }} />
  ) : (
    <>
      <button type="button" className="circle-post-photo" aria-label="Open photo" onClick={() => setOpen(true)}>
        <img className="circle-post-media" src={media.url} alt="" style={{ aspectRatio: media.width && media.height ? `${media.width}/${media.height}` : undefined }} />
      </button>
      {open && <ImageViewer src={media.url} alt="Photo in circle" onClose={() => setOpen(false)} />}
    </>
  );
}

function PostCard({ post, circleId, options }: { post: Post; circleId: string; options?: string[] | null }) {
  const toast = useToast(), refresh = useRefresh(circleId);
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => api("circlesDeletePost", { params: { id: circleId, postId: post.id } }),
    onSuccess: () => { setConfirm(false); refresh(); toast("Removed."); },
    onError: (error) => toast(error.message, true),
  });
  return (
    <article className="circle-post">
      <header>
        <Link href={`/profile/${post.author.username}`} className="circle-post-author"><Avatar user={post.author} size={34} />
          <span><strong>{post.author.displayName}</strong><time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time></span>
        </Link>
        {post.canDelete && <button type="button" className="icon-button" aria-label="Delete" onClick={() => setConfirm(true)}><Trash2 size={16} /></button>}
      </header>
      {post.pollChoice !== null && options && <p className="circle-poll-pick"><Vote size={15} /> {options[post.pollChoice]}</p>}
      {post.content && <p className="circle-post-text">{post.content}</p>}
      {post.media && <PostMedia media={post.media} />}
      {confirm && <ConfirmDialog title="Delete this?" description="It disappears for everyone in the circle." confirmLabel="Delete"
        pending={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirm(false)} />}
    </article>
  );
}

/** Photo/video picker with preview, shared by the feed, photo answers and albums. */
function AttachmentPreview({ attachment }: { attachment: ReturnType<typeof useMediaAttachment> }) {
  const url = attachment.previewUrl ?? attachment.media?.url;
  if (!url) return null;
  const video = (attachment.previewType ?? attachment.media?.type) === "VIDEO";
  return (
    <div className="circle-attachment">
      {video ? <video src={url} muted playsInline controls /> : <img src={url} alt="Selected photo" />}
      <button type="button" className="icon-button" aria-label="Remove photo" onClick={attachment.clear}><X size={16} /></button>
      {(attachment.uploading || attachment.media?.status === "PROCESSING") && (
        <span className="circle-attachment-status"><Loader2 size={14} className="spin" />
          {attachment.uploading ? `${attachment.progress}%` : "Processing…"}</span>
      )}
    </div>
  );
}
function PickMedia({ attachment, label = "Photo" }: { attachment: ReturnType<typeof useMediaAttachment>; label?: string }) {
  return (
    <label className={`button secondary small ${attachment.busy || attachment.media ? "disabled" : ""}`}>
      <ImagePlus size={16} /> {label}
      <input type="file" className="sr-only" accept="image/*,video/*" disabled={attachment.busy || !!attachment.media}
        onChange={(event) => { void attachment.select(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
  );
}

// ---- Today -------------------------------------------------------------------------------------

function AnswerComposer({ prompt, circleId }: { prompt: Prompt; circleId: string }) {
  const toast = useToast(), refresh = useRefresh(circleId);
  const [text, setText] = useState("");
  const attachment = useMediaAttachment();
  const answer = useMutation({
    mutationFn: (body: Models["CreateCirclePostDto"]) => api("circlesCreatePost", { params: { id: circleId }, body: { promptId: prompt.id, ...body } }),
    onSuccess: () => { haptic("success"); attachment.attached(); setText(""); refresh(); },
    onError: (error) => toast(error.message, true),
  });
  if (prompt.kind === "poll")
    return (
      <div className="circle-poll-options">
        {prompt.options?.map((option, index) => (
          <button type="button" key={option} disabled={answer.isPending} onClick={() => answer.mutate({ pollChoice: index })}>{option}</button>
        ))}
      </div>
    );
  const ready = attachment.media?.status === "READY";
  const canSend = prompt.kind === "photo" ? ready : !!text.trim() && (!attachment.media || ready);
  return (
    <form className="circle-answer" onSubmit={(event) => {
      event.preventDefault();
      if (canSend && !answer.isPending) answer.mutate({ content: text.trim() || undefined, mediaId: attachment.media?.id });
    }}>
      <AttachmentPreview attachment={attachment} />
      <textarea rows={2} maxLength={1000} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={prompt.kind === "photo" ? "Add a caption (optional)" : "Your answer…"} />
      <div className="circle-answer-actions">
        <PickMedia attachment={attachment} label={prompt.kind === "photo" ? "Add photo" : "Photo"} />
        {attachment.error && <span className="field-error">{attachment.error}</span>}
        <button type="submit" className="button small" disabled={!canSend || answer.isPending}>
          {answer.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Answer
        </button>
      </div>
    </form>
  );
}

function PollResults({ prompt }: { prompt: Prompt }) {
  const total = prompt.results?.reduce((sum, value) => sum + value, 0) || 1;
  return (
    <div className="circle-poll-results">
      {prompt.options?.map((option, index) => {
        const votes = prompt.results?.[index] ?? 0, mine = prompt.myAnswer?.pollChoice === index;
        return (
          <div key={option} className={`circle-poll-result ${mine ? "mine" : ""}`}>
            <span className="circle-poll-fill" style={{ width: `${(votes / total) * 100}%` }} />
            <span>{option}{mine && <Check size={14} />}</span><strong>{Math.round((votes / total) * 100)}%</strong>
          </div>
        );
      })}
    </div>
  );
}

function PromptCard({ prompt, circle, history = false }: { prompt: Prompt; circle: Circle; history?: boolean }) {
  const answered = !!prompt.myAnswer || history;
  return (
    <section className={`circle-prompt ${history ? "history" : ""}`} style={{ ["--circle" as string]: circle.color }}>
      <div className="circle-prompt-head">
        <span className="circle-prompt-kicker">
          {prompt.kind === "poll" ? <Vote size={14} /> : prompt.kind === "photo" ? <Camera size={14} /> : <MessageCircleQuestion size={14} />}
          {history ? new Date(`${prompt.day}T00:00:00Z`).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "Today’s question"}
        </span>
        <span className="circle-prompt-count">{prompt.answeredCount}/{prompt.memberCount} answered</span>
      </div>
      <h2>{prompt.text}</h2>
      {prompt.author && <p className="circle-prompt-author">Asked by {prompt.author.displayName}</p>}
      {!answered && <AnswerComposer prompt={prompt} circleId={circle.id} />}
      {prompt.kind === "poll" && answered && prompt.results && <PollResults prompt={prompt} />}
      {!answered && prompt.answeredCount > 0 && (
        <div className="circle-locked" aria-live="polite">
          <div className="circle-locked-cards" aria-hidden="true">{Array.from({ length: Math.min(prompt.answeredCount, 3) }, (_, i) => <span key={i} />)}</div>
          <p><Lock size={15} /> {prompt.answeredCount} {prompt.answeredCount === 1 ? "answer is" : "answers are"} waiting. Answer to see them.</p>
        </div>
      )}
      {answered && prompt.kind !== "poll" && (
        <div className="circle-answers">
          {prompt.answers.map((answer) => <PostCard key={answer.id} post={answer} circleId={circle.id} options={prompt.options} />)}
        </div>
      )}
      {answered && prompt.kind === "poll" && !history && <p className="circle-prompt-author">You voted · {prompt.answeredCount} {prompt.answeredCount === 1 ? "vote" : "votes"} so far</p>}
    </section>
  );
}

function AskQuestion({ circleId, onClose }: { circleId: string; onClose: () => void }) {
  const toast = useToast(), refresh = useRefresh(circleId);
  const [kind, setKind] = useState<Prompt["kind"]>("text");
  const [text, setText] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = text.trim().length >= 3 && (kind !== "poll" || filled.length >= 2);
  const ask = useMutation({
    mutationFn: () => api("circlesSetPrompt", { params: { id: circleId }, body: { kind, text: text.trim(), options: kind === "poll" ? filled : undefined } }),
    onSuccess: (prompt) => {
      const today = new Date().toISOString().slice(0, 10);
      toast(prompt.day > today ? "Scheduled as tomorrow’s question." : "Your question is live.");
      refresh(); onClose();
    },
    onError: (error) => toast(error.message, true),
  });
  return (
    <Modal title="Ask the circle" onClose={onClose} className="circle-dialog" guardClose={() => !ask.isPending}>
      <form className="circle-form" onSubmit={(event) => { event.preventDefault(); if (valid) ask.mutate(); }}>
        <p className="muted">Replaces today’s question if nobody has answered yet; otherwise it becomes tomorrow’s.</p>
        <div className="circle-segment" role="radiogroup" aria-label="Question type">
          {(["text", "photo", "poll"] as const).map((value) => (
            <button type="button" role="radio" key={value} aria-checked={kind === value} onClick={() => setKind(value)}>
              {value === "text" ? "Answer" : value === "photo" ? "Photo" : "Poll"}
            </button>
          ))}
        </div>
        <label className="form-field"><span>Question</span>
          <input data-autofocus value={text} maxLength={200} onChange={(event) => setText(event.target.value)} placeholder="What made you smile today?" />
        </label>
        {kind === "poll" && (
          <div className="circle-option-editor">
            {options.map((option, index) => (
              <div key={index}>
                <input value={option} maxLength={40} placeholder={`Option ${index + 1}`} aria-label={`Option ${index + 1}`}
                  onChange={(event) => setOptions((list) => list.map((o, i) => (i === index ? event.target.value : o)))} />
                {options.length > 2 && <button type="button" className="icon-button" aria-label={`Remove option ${index + 1}`}
                  onClick={() => setOptions((list) => list.filter((_, i) => i !== index))}><X size={15} /></button>}
              </div>
            ))}
            {options.length < 6 && <button type="button" className="text-button" onClick={() => setOptions((list) => [...list, ""])}><Plus size={15} /> Add option</button>}
          </div>
        )}
        <button type="submit" className="button full" disabled={!valid || ask.isPending}>{ask.isPending && <Loader2 size={16} className="spin" />}Ask</button>
      </form>
    </Modal>
  );
}

function TodayTab({ circle }: { circle: Circle }) {
  const [asking, setAsking] = useState(false);
  const today = useQuery({
    queryKey: ["circle", circle.id, "today"],
    queryFn: ({ signal }) => api("circlesToday", { params: { id: circle.id }, signal }),
    refetchInterval: 20_000,
  });
  const history = useInfiniteQuery({
    queryKey: ["circle", circle.id, "history"],
    queryFn: ({ pageParam, signal }) => api("circlesPromptHistory", { params: { id: circle.id }, query: { cursor: pageParam, limit: 5 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor ?? undefined : undefined),
  });
  const past = history.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="circle-tab">
      {today.isPending ? <LoadingSkeleton compact /> : today.isError ? <ErrorState error={today.error} retry={() => void today.refetch()} /> : <PromptCard prompt={today.data} circle={circle} />}
      {isAdmin(circle) && <button type="button" className="text-button circle-ask" onClick={() => setAsking(true)}><Plus size={15} /> Ask your own question</button>}
      {past.length > 0 && <h3 className="circle-section-title">Earlier</h3>}
      {past.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} circle={circle} history />)}
      <LoadMore hasMore={history.hasNextPage} pending={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()} />
      {asking && <AskQuestion circleId={circle.id} onClose={() => setAsking(false)} />}
    </div>
  );
}

// ---- Feed --------------------------------------------------------------------------------------

function FeedTab({ circle }: { circle: Circle }) {
  const toast = useToast(), refresh = useRefresh(circle.id), { user } = useSession();
  const [text, setText] = useState("");
  const attachment = useMediaAttachment();
  const feed = useInfiniteQuery({
    queryKey: ["circle", circle.id, "feed"],
    queryFn: ({ pageParam, signal }) => api("circlesFeed", { params: { id: circle.id }, query: { cursor: pageParam, limit: 20 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor ?? undefined : undefined),
    refetchInterval: 20_000,
  });
  const post = useMutation({
    mutationFn: () => api("circlesCreatePost", { params: { id: circle.id }, body: { content: text.trim() || undefined, mediaId: attachment.media?.id } }),
    onSuccess: () => { haptic("success"); attachment.attached(); setText(""); refresh(); },
    onError: (error) => toast(error.message, true),
  });
  const canPost = (!!text.trim() || !!attachment.media) && !attachment.busy && (!attachment.media || attachment.media.status === "READY");
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="circle-tab">
      <form className="card circle-composer" onSubmit={(event) => { event.preventDefault(); if (canPost && !post.isPending) post.mutate(); }}>
        <Avatar user={user} size={36} />
        <div>
          <textarea rows={2} maxLength={1000} value={text} placeholder={`Share something with ${circle.name}…`} onChange={(event) => setText(event.target.value)} />
          <AttachmentPreview attachment={attachment} />
          <div className="circle-answer-actions">
            <PickMedia attachment={attachment} />
            {attachment.error && <span className="field-error">{attachment.error}</span>}
            <button type="submit" className="button small" disabled={!canPost || post.isPending}>{post.isPending && <Loader2 size={15} className="spin" />}Post</button>
          </div>
        </div>
      </form>
      {feed.isPending ? <LoadingSkeleton compact /> : feed.isError ? <ErrorState error={feed.error} retry={() => void feed.refetch()} /> : items.length ? (
        items.map((item) => <PostCard key={item.id} post={item} circleId={circle.id} />)
      ) : <div className="card"><EmptyState title="Nothing here yet" description="Posts count toward today’s streak too. Say hi to the circle!" /></div>}
      <LoadMore hasMore={feed.hasNextPage} pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} />
    </div>
  );
}

// ---- Albums ------------------------------------------------------------------------------------

function NewAlbum({ circleId, onClose }: { circleId: string; onClose: () => void }) {
  const toast = useToast(), refresh = useRefresh(circleId);
  const [title, setTitle] = useState(""), [hours, setHours] = useState(48);
  const create = useMutation({
    mutationFn: () => api("circlesCreateAlbum", { params: { id: circleId }, body: { title: title.trim(), hours } }),
    onSuccess: () => { haptic("success"); refresh(); onClose(); },
    onError: (error) => toast(error.message, true),
  });
  return (
    <Modal title="New shared album" onClose={onClose} className="circle-dialog" guardClose={() => !create.isPending}>
      <form className="circle-form" onSubmit={(event) => { event.preventDefault(); if (title.trim()) create.mutate(); }}>
        <p className="muted">Everyone adds their photos and videos while it’s open. Then it closes and keeps the memories.</p>
        <label className="form-field"><span>Title</span>
          <input data-autofocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="School trip, Birthday, Match day…" />
        </label>
        <fieldset className="circle-choice"><legend>Open for</legend>
          <div className="circle-segment" role="radiogroup">
            {ALBUM_DURATIONS.map((option) => (
              <button type="button" role="radio" key={option.hours} aria-checked={hours === option.hours} onClick={() => setHours(option.hours)}>{option.label}</button>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="button full" disabled={!title.trim() || create.isPending}>{create.isPending && <Loader2 size={16} className="spin" />}Create album</button>
      </form>
    </Modal>
  );
}

function AlbumView({ album, circleId, onBack }: { album: Album; circleId: string; onBack: () => void }) {
  const toast = useToast(), refresh = useRefresh(circleId);
  const attachment = useMediaAttachment();
  const [confirm, setConfirm] = useState(false);
  const items = useInfiniteQuery({
    queryKey: ["circle", circleId, "album", album.id],
    queryFn: ({ pageParam, signal }) => api("circlesAlbumItems", { params: { id: circleId, albumId: album.id }, query: { cursor: pageParam, limit: 30 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor ?? undefined : undefined),
  });
  const add = useMutation({
    mutationFn: (mediaId: string) => api("circlesCreatePost", { params: { id: circleId }, body: { albumId: album.id, mediaId } }),
    onSuccess: () => { haptic("success"); attachment.attached(); refresh(); },
    onError: (error) => toast(error.message, true),
  });
  const remove = useMutation({
    mutationFn: () => api("circlesDeleteAlbum", { params: { id: circleId, albumId: album.id } }),
    onSuccess: () => { refresh(); onBack(); },
    onError: (error) => toast(error.message, true),
  });
  // The photo goes into the album as soon as it has finished uploading/processing.
  const readyId = attachment.media?.status === "READY" ? attachment.media.id : null;
  const adding = add.isPending, addMedia = add.mutate;
  useEffect(() => { if (readyId && !adding) addMedia(readyId); }, [readyId, adding, addMedia]);
  const posts = items.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="circle-tab">
      <div className="circle-album-head">
        <button type="button" className="text-button" onClick={onBack}><ChevronLeft size={16} /> Albums</button>
        <div><h2>{album.title}</h2><small>{album.open ? `Open · ${timeLeft(album.closesAt)}` : "Closed"} · {album.itemCount} {album.itemCount === 1 ? "item" : "items"}</small></div>
        {album.canDelete && <button type="button" className="icon-button" aria-label="Delete album" onClick={() => setConfirm(true)}><Trash2 size={17} /></button>}
      </div>
      {album.open && (
        <div className="circle-album-add">
          <PickMedia attachment={attachment} label="Add photo or video" />
          {(attachment.uploading || attachment.media?.status === "PROCESSING" || adding) && <span className="muted"><Loader2 size={14} className="spin" /> Adding…</span>}
          {attachment.error && <span className="field-error">{attachment.error}</span>}
        </div>
      )}
      {items.isPending ? <LoadingSkeleton compact /> : posts.length ? (
        <div className="circle-album-grid">{posts.map((post) => post.media && <PostMedia key={post.id} media={post.media} />)}</div>
      ) : <div className="card"><EmptyState icon={<Images size={30} />} title="No photos yet" description={album.open ? "Be the first to add a moment." : "This album closed empty."} /></div>}
      <LoadMore hasMore={items.hasNextPage} pending={items.isFetchingNextPage} onClick={() => void items.fetchNextPage()} />
      {confirm && <ConfirmDialog title="Delete this album?" description="All photos and videos in it are deleted for everyone." confirmLabel="Delete album"
        pending={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirm(false)} />}
    </div>
  );
}

function AlbumsTab({ circle }: { circle: Circle }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const albums = useInfiniteQuery({
    queryKey: ["circle", circle.id, "albums"],
    queryFn: ({ pageParam, signal }) => api("circlesAlbums", { params: { id: circle.id }, query: { cursor: pageParam, limit: 20 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor ?? undefined : undefined),
  });
  const items = albums.data?.pages.flatMap((page) => page.items) ?? [];
  const open = items.find((album) => album.id === openId);
  if (open) return <AlbumView album={open} circleId={circle.id} onBack={() => setOpenId(null)} />;
  return (
    <div className="circle-tab">
      <button type="button" className="button secondary circle-new-album" onClick={() => setCreating(true)}><Plus size={16} /> New album</button>
      {albums.isPending ? <LoadingSkeleton compact /> : albums.isError ? <ErrorState error={albums.error} retry={() => void albums.refetch()} /> : items.length ? (
        <div className="circle-albums">
          {items.map((album) => (
            <button type="button" key={album.id} className="circle-album" onClick={() => setOpenId(album.id)}>
              <span className={`circle-album-mosaic n${Math.min(album.preview.length, 4)}`}>
                {album.preview.length ? album.preview.map((media) => media.type === "VIDEO"
                  ? <video key={media.id} src={media.url} muted preload="metadata" /> : <img key={media.id} src={media.url} alt="" />)
                  : <Images size={28} aria-hidden="true" />}
              </span>
              <strong>{album.title}</strong>
              <small className={album.open ? "open" : ""}>{album.open ? timeLeft(album.closesAt) : "Closed"} · {album.itemCount}</small>
            </button>
          ))}
        </div>
      ) : <div className="card"><EmptyState icon={<Images size={30} />} title="No albums yet" description="Open an album for a trip, a match or a birthday. Everyone adds their photos for a limited time." /></div>}
      <LoadMore hasMore={albums.hasNextPage} pending={albums.isFetchingNextPage} onClick={() => void albums.fetchNextPage()} />
      {creating && <NewAlbum circleId={circle.id} onClose={() => setCreating(false)} />}
    </div>
  );
}

// ---- Members ----------------------------------------------------------------------------------

function MembersTab({ circle }: { circle: Circle }) {
  const toast = useToast(), refresh = useRefresh(circle.id), { user } = useSession();
  const [pending, setPending] = useState<{ kind: "owner" | "remove"; member: Models["CircleMemberDto"] } | null>(null);
  const members = useQuery({
    queryKey: ["circle", circle.id, "members"],
    queryFn: ({ signal }) => api("circlesMembers", { params: { id: circle.id }, signal }),
  });
  const role = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "owner" | "admin" | "member" }) =>
      api("circlesSetRole", { params: { id: circle.id, userId }, body: { role } }),
    onSuccess: () => { setPending(null); refresh(); },
    onError: (error) => toast(error.message, true),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api("circlesRemoveMember", { params: { id: circle.id, userId } }),
    onSuccess: () => { setPending(null); refresh(); toast("Removed from the circle."); },
    onError: (error) => toast(error.message, true),
  });
  if (members.isPending) return <LoadingSkeleton compact />;
  if (members.isError) return <ErrorState error={members.error} retry={() => void members.refetch()} />;
  return (
    <div className="circle-tab">
      <ul className="card circle-members">
        {members.data.map((member) => {
          const self = member.user.id === user?.id;
          const canManage = !self && (circle.role === "owner" || (circle.role === "admin" && member.role === "member"));
          return (
            <li key={member.user.id}>
              <Link href={`/profile/${member.user.username}`} className="circle-member">
                <Avatar user={member.user} size={42} />
                <span><strong>{member.user.displayName}{self && " (you)"}</strong><small>@{member.user.username}</small></span>
              </Link>
              {member.role !== "member" && (
                <span className={`circle-role ${member.role}`}>{member.role === "owner" ? <Crown size={13} /> : <Shield size={13} />}{member.role === "owner" ? "Owner" : "Admin"}</span>
              )}
              <span className={`circle-member-today ${member.contributedToday ? "done" : ""}`} title={member.contributedToday ? "Took part today" : "Not yet today"}>
                <Flame size={16} fill={member.contributedToday ? "currentColor" : "none"} /><span className="sr-only">{member.contributedToday ? "Took part today" : "Not yet today"}</span>
              </span>
              {canManage && (
                <Dropdown label={`Manage ${member.user.displayName}`} summary={<MoreHorizontal size={18} />} summaryClassName="icon-button">
                  {circle.role === "owner" && member.role !== "admin" && <button type="button" onClick={() => role.mutate({ userId: member.user.id, role: "admin" })}><Shield size={15} /> Make admin</button>}
                  {circle.role === "owner" && member.role === "admin" && <button type="button" onClick={() => role.mutate({ userId: member.user.id, role: "member" })}><Shield size={15} /> Remove admin</button>}
                  {circle.role === "owner" && <button type="button" onClick={() => setPending({ kind: "owner", member })}><Crown size={15} /> Make owner</button>}
                  <button type="button" className="danger-text" onClick={() => setPending({ kind: "remove", member })}><UserMinus size={15} /> Remove</button>
                </Dropdown>
              )}
            </li>
          );
        })}
      </ul>
      {pending?.kind === "owner" && <ConfirmDialog tone="primary" title={`Make ${pending.member.user.displayName} the owner?`}
        description="They can then delete the circle. You stay on as an admin." confirmLabel="Hand over ownership" pending={role.isPending}
        onConfirm={() => role.mutate({ userId: pending.member.user.id, role: "owner" })} onClose={() => setPending(null)} />}
      {pending?.kind === "remove" && <ConfirmDialog title={`Remove ${pending.member.user.displayName}?`}
        description="They leave the circle. Their posts stay. They can rejoin only with a current invite link." confirmLabel="Remove" pending={remove.isPending}
        onConfirm={() => remove.mutate(pending.member.user.id)} onClose={() => setPending(null)} />}
    </div>
  );
}

// ---- Invite and settings ------------------------------------------------------------------------

function InviteDialog({ circle, onClose }: { circle: Circle; onClose: () => void }) {
  const toast = useToast(), refresh = useRefresh(circle.id);
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/circles/join/${circle.inviteCode}`;
  const reset = useMutation({
    mutationFn: () => api("circlesResetInvite", { params: { id: circle.id } }),
    onSuccess: () => { refresh(); toast("New link created. The old one no longer works."); },
    onError: (error) => toast(error.message, true),
  });
  const copy = (value: string, label: string) => void navigator.clipboard.writeText(value).then(() => toast(`${label} copied.`), () => toast("Couldn’t copy.", true));
  return (
    <Modal title="Invite to the circle" onClose={onClose} className="circle-dialog">
      <div className="circle-invite-share" style={{ ["--circle" as string]: circle.color }}>
        <CircleMark circle={circle} size={64} />
        <p className="muted">Anyone with this link can join while there is room ({circle.memberCount}/30).</p>
        <button type="button" className="circle-invite-code" onClick={() => copy(circle.inviteCode ?? "", "Code")} aria-label="Copy invite code">
          {circle.inviteCode}<Copy size={16} />
        </button>
        <div className="circle-invite-actions">
          <button type="button" className="button" onClick={() => copy(link, "Link")}><Link2 size={16} /> Copy link</button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button type="button" className="button secondary" onClick={() => void navigator.share({ title: circle.name, text: `Join ${circle.name} on Circle`, url: link }).catch(() => {})}>
              <Share2 size={16} /> Share
            </button>
          )}
        </div>
        {isAdmin(circle) && <button type="button" className="text-button muted" disabled={reset.isPending} onClick={() => reset.mutate()}><RefreshCw size={14} /> Reset link</button>}
      </div>
    </Modal>
  );
}

function SettingsDialog({ circle, onClose }: { circle: Circle; onClose: () => void }) {
  const toast = useToast(), refresh = useRefresh(circle.id);
  const [rule, setRule] = useState(circle.streakRule), [invites, setInvites] = useState(circle.membersCanInvite);
  const save = useMutation({
    mutationFn: (fields: Parameters<Parameters<typeof CircleForm>[0]["onSubmit"]>[0]) => api("circlesUpdate", {
      params: { id: circle.id },
      body: { name: fields.name.trim(), emoji: fields.emoji, color: fields.color, kind: fields.kind, description: fields.description.trim() || null, streakRule: rule, membersCanInvite: invites },
    }),
    onSuccess: () => { refresh(); toast("Saved."); onClose(); },
    onError: (error) => toast(error.message, true),
  });
  return (
    <Modal title="Circle settings" onClose={onClose} className="circle-dialog" guardClose={() => !save.isPending}>
      <CircleForm initial={{ ...circle, description: circle.description ?? "" }} pending={save.isPending} submitLabel="Save" onSubmit={(fields) => save.mutate(fields)}
        extra={<>
          <fieldset className="circle-choice"><legend>Streak goal per day</legend>
            <div className="circle-segment" role="radiogroup">
              {([["auto", "Smart"], ["all", "Everyone"], ["most", "Two thirds"], ["half", "Half"]] as const).map(([value, label]) => (
                <button type="button" role="radio" key={value} aria-checked={rule === value} onClick={() => setRule(value)}>{label}</button>
              ))}
            </div>
            <small className="muted">Smart: everyone in circles up to 6 people, two thirds in bigger ones.</small>
          </fieldset>
          <label className="circle-toggle"><span><strong>Members can invite</strong><small>Otherwise only admins see the invite link.</small></span>
            <input type="checkbox" checked={invites} onChange={(event) => setInvites(event.target.checked)} /></label>
        </>} />
    </Modal>
  );
}

// ---- Page --------------------------------------------------------------------------------------

export default function CircleView({ id }: { id: string }) {
  const router = useRouter(), client = useQueryClient(), toast = useToast(), { user } = useSession();
  const [tab, setTab] = useState<Tab>("today");
  const [dialog, setDialog] = useState<"invite" | "settings" | "leave" | "delete" | null>(null);
  const circle = useQuery({
    queryKey: ["circle", id],
    queryFn: ({ signal }) => api("circlesGet", { params: { id }, signal }),
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const leave = useMutation({
    mutationFn: () => dialog === "delete" ? api("circlesDelete", { params: { id } }) : api("circlesLeave", { params: { id } }),
    onSuccess: () => {
      toast(dialog === "delete" ? "Circle deleted." : "You left the circle.");
      client.removeQueries({ queryKey: ["circle", id] });
      void client.invalidateQueries({ queryKey: ["circles"] });
      router.replace("/circles");
    },
    onError: (error) => toast(error.message, true),
  });
  if (circle.isPending) return <LoadingSkeleton />;
  if (circle.isError) return <div className="card"><ErrorState error={circle.error} retry={() => void circle.refetch()} /></div>;
  const c = circle.data;
  return (
    <div className="circle-page" style={{ ["--circle" as string]: c.color }}>
      <Link href="/circles" className="back-link"><ArrowLeft size={16} /> Circles</Link>
      <header className="card circle-header">
        <div className="circle-header-main">
          <CircleMark circle={c} size={64} />
          <div className="circle-header-text">
            <h1>{c.name}</h1>
            <p className="muted">{KIND_LABEL[c.kind]} · {c.memberCount} {c.memberCount === 1 ? "member" : "members"}</p>
            {c.description && <p className="circle-description">{c.description}</p>}
          </div>
          <div className="circle-header-actions">
            {c.inviteCode && <button type="button" className="button small" onClick={() => setDialog("invite")}><Plus size={15} /> Invite</button>}
            <Dropdown label="Circle options" summary={<MoreHorizontal size={18} />} summaryClassName="icon-button">
              {isAdmin(c) && <button type="button" onClick={() => setDialog("settings")}><Settings2 size={15} /> Settings</button>}
              <button type="button" onClick={() => setDialog("leave")}><LogOut size={15} /> Leave circle</button>
              {c.role === "owner" && <button type="button" className="danger-text" onClick={() => setDialog("delete")}><Trash2 size={15} /> Delete circle</button>}
            </Dropdown>
          </div>
        </div>
        <dl className="circle-stats">
          <div>
            <dt>Streak</dt>
            <dd><StreakChip streak={c.streak} /><span className="circle-stat-unit">day{c.streak.days === 1 ? "" : "s"}</span>
              {c.streak.best > 0 && <small>Best {c.streak.best}</small>}</dd>
          </div>
          <div>
            <dt>Today</dt>
            <dd><ProgressRing streak={c.streak} size={34} /><span className="circle-stat-note">{streakMessage(c.streak)}</span></dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd><AvatarStack users={c.members} total={c.memberCount} size={26} /></dd>
          </div>
        </dl>
      </header>
      <nav className="circle-tabs" role="tablist" aria-label="Circle sections">
        {TABS.map((item) => (
          <button type="button" role="tab" key={item.id} aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}{item.id === "today" && !c.answeredToday && <span className="circle-tab-dot" aria-label="unanswered" />}
          </button>
        ))}
      </nav>
      {tab === "today" && <TodayTab circle={c} />}
      {tab === "feed" && <FeedTab circle={c} />}
      {tab === "albums" && <AlbumsTab circle={c} />}
      {tab === "members" && <MembersTab circle={c} />}
      {dialog === "invite" && <InviteDialog circle={c} onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog circle={c} onClose={() => setDialog(null)} />}
      {(dialog === "leave" || dialog === "delete") && (
        <ConfirmDialog title={dialog === "delete" ? "Delete this circle?" : "Leave this circle?"}
          description={dialog === "delete" ? "Everything in it — posts, answers, albums and the streak — is deleted for everyone."
            : c.memberCount === 1 ? "You are the last member, so the circle and everything in it will be deleted."
              : c.role === "owner" ? "Ownership passes to the longest-standing admin (or member)." : "You can rejoin with an invite link."}
          confirmLabel={dialog === "delete" ? "Delete circle" : "Leave"} pending={leave.isPending}
          onConfirm={() => leave.mutate()} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
