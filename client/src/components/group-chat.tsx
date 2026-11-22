"use client";
/**
 * Group chats, Telegram style: a two-step "new group" flow, a chat with system events and a pinned
 * message, "Message info" (who has seen it), and a rich group info page with admins, permissions,
 * shared media, muting and member management.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Bell, BellOff, Camera, Check, ChevronRight, Crown, ImagePlus, Info, LogOut, MessageCircle, Pencil, Pin, Search,
  Send, Shield, ShieldOff, Trash2, UserMinus, UserPlus, UserRound, UsersRound as Users, X,
} from 'lucide-react';
import { api, upload, type Models } from '@/lib/api/client';
import { useMediaAttachment } from '@/lib/use-media-attachment';
import { useSession, useToast } from './providers';
import { Avatar, ConfirmDialog, ErrorState, LoadMore, Modal } from './ui';
import { StickerButton } from './sticker-picker';
import { VoiceRecorder } from './voice-message';
import { useCalls } from './calls';
import { ImageViewer } from './image-viewer';

type User = Models['UserSummaryDto'];
type Group = Models['GroupDetailDto'];
type Member = Models['GroupMemberDto'];
type Message = Models['GroupMessageDto'];
type GroupEvent = Models['GroupEventDto'];
type Draft = { content?: string; mediaId?: string; audioId?: string; stickerId?: string; gifId?: string; replyToId?: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function GroupAvatar({ group, size = 48 }: { group: { name: string; avatarUrl?: string | null }; size?: number }) {
  return <span className="group-avatar" role="img" aria-label={`${group.name} group photo`} style={{ width: size, height: size }}>
    {group.avatarUrl ? <img src={group.avatarUrl} alt="" /> : <Users size={Math.round(size * .48)} aria-hidden="true" />}
  </span>;
}

/** "Ece added Can" — the same wording the server uses for the chat list. */
export function groupEventText(event: GroupEvent, actor: string) {
  const who = event.targets.join(', ');
  switch (event.type) {
    case 'created': return `${actor} created the group`;
    case 'added': return `${actor} added ${who}`;
    case 'removed': return `${actor} removed ${who}`;
    case 'left': return `${actor} left the group`;
    case 'joined': return `${actor} joined the group`;
    case 'renamed': return `${actor} changed the group name to “${event.value ?? ''}”`;
    case 'photo': return event.value === 'removed' ? `${actor} removed the group photo` : `${actor} changed the group photo`;
    case 'description': return event.value ? `${actor} changed the group description` : `${actor} removed the group description`;
    case 'pinned': return `${actor} pinned “${event.value ?? ''}”`;
    case 'unpinned': return `${actor} unpinned a message`;
    case 'admin': return `${actor} made ${who} an admin`;
    case 'unadmin': return `${actor} removed ${who} as admin`;
    case 'owner': return `${actor} made ${who} the group owner`;
  }
}

export type GroupMessageActions = {
  own: boolean; first: boolean; last: boolean; replyAuthor?: string;
  onReply: (message: Models['DirectMessageDto']) => void; onEdit: (message: Models['DirectMessageDto']) => void;
  onUnsend: (message: Models['DirectMessageDto']) => void; onJump: (id: string) => void;
  onInfo: (message: Models['DirectMessageDto']) => void; onPin?: (message: Models['DirectMessageDto']) => void; pinned: boolean;
};

export function useGroups(enabled = true) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: ['messages', user?.id, 'groups'],
    queryFn: ({ pageParam, signal }) => api('groupsList', { query: { cursor: pageParam, limit: 20 }, signal }),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.hasMore ? page.nextCursor ?? undefined : undefined,
    refetchInterval: 5000, enabled: enabled && !!user,
  });
}

const canEdit = (g: Group) => g.myRole !== 'member' || g.membersCanEdit;
const canAdd = (g: Group) => g.myRole !== 'member' || g.membersCanAdd;

/* ============================================================== choosing people */

/** Search plus recent chats, as a list of tickable rows. */
function PeoplePicker({ selected, onToggle, exclude = [], disabled }: { selected: User[]; onToggle: (user: User) => void; exclude?: string[]; disabled?: boolean }) {
  const { user } = useSession();
  const [search, setSearch] = useState(''), [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const results = useQuery({ queryKey: ['message-recipients', user?.id, term], queryFn: ({ signal }) => api('searchUsers', { query: { q: term, limit: 20 }, signal }), enabled: !!user && !!term });
  const recent = useQuery({ queryKey: ['messages', user?.id, 'recent', 30], queryFn: ({ signal }) => api('messagesConversations', { query: { limit: 30 }, signal }), enabled: !!user });
  const people = (term ? results.data?.items ?? [] : recent.data?.items.filter(c => !c.isUnavailable).map(c => c.user) ?? [])
    .filter(p => p.id !== user?.id && !exclude.includes(p.id));
  const pending = term ? results.isFetching : recent.isPending;
  return <div className="grp-picker">
    <label className="grp-search"><Search size={17} aria-hidden="true" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" autoFocus /></label>
    {!term && <h4 className="grp-section-label">Recent chats</h4>}
    <ul className="grp-people" role="listbox" aria-multiselectable="true">
      {people.map(p => {
        const on = selected.some(s => s.id === p.id);
        return <li key={p.id}><button type="button" role="option" aria-selected={on} disabled={disabled} className={on ? 'on' : ''} onClick={() => onToggle(p)}>
          <Avatar user={p} size={44} />
          <span className="grp-person"><strong>{p.displayName}</strong><small>@{p.username}</small></span>
          <span className="grp-check" aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</span>
        </button></li>;
      })}
    </ul>
    {pending && <p className="grp-hint" role="status">Loading…</p>}
    {!pending && !people.length && <p className="grp-hint">{term ? 'No one found' : 'Search for people to add'}</p>}
  </div>;
}

function Chips({ people, onRemove }: { people: User[]; onRemove: (id: string) => void }) {
  if (!people.length) return null;
  return <div className="grp-chips">{people.map(p => <button type="button" key={p.id} onClick={() => onRemove(p.id)} aria-label={`Remove ${p.displayName}`}>
    <Avatar user={p} size={24} /><span translate="no">{firstName(p.displayName)}</span><X size={13} />
  </button>)}</div>;
}

/* ============================================================== new group */

export function CreateGroup({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'people' | 'info'>('people');
  const [people, setPeople] = useState<User[]>([]);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null), [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const client = useQueryClient(), router = useRouter(), toast = useToast();
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const create = useMutation({
    mutationFn: async () => {
      let avatarMediaId: string | undefined;
      if (photo) avatarMediaId = (await upload(photo, () => {}) as Models['MediaDto']).id;
      return api('groupsCreate', { body: { name: name.trim(), memberIds: people.map(p => p.id), description: description.trim() || undefined, avatarMediaId } });
    },
    onSuccess: group => { void client.invalidateQueries({ queryKey: ['messages'] }); onClose(); router.push(`/messages?group=${group.id}`); },
    onError: error => toast(error.message, true),
  });
  const toggle = (p: User) => setPeople(cur => cur.some(v => v.id === p.id) ? cur.filter(v => v.id !== p.id) : cur.length < 31 ? [...cur, p] : cur);
  return <Modal title={step === 'people' ? 'New group' : 'Group info'} onClose={onClose} className="grp-dialog" guardClose={() => !create.isPending}>
    {step === 'people' ? <div className="grp-step">
      <p className="grp-lead">Add people to your group. You can add more later.</p>
      <Chips people={people} onRemove={id => setPeople(cur => cur.filter(p => p.id !== id))} />
      <PeoplePicker selected={people} onToggle={toggle} />
      <div className="grp-footer"><button type="button" className="button grp-next" disabled={!people.length} onClick={() => setStep('info')}>
        Next{people.length ? ` · ${people.length}` : ''}<ChevronRight size={18} />
      </button></div>
    </div> : <form className="grp-step" onSubmit={e => { e.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}>
      <div className="grp-identity">
        <button type="button" className="grp-photo-pick" onClick={() => photoInput.current?.click()} aria-label={photo ? 'Change group photo' : 'Add group photo'}>
          {photoUrl ? <img src={photoUrl} alt="" /> : <Camera size={28} />}
        </button>
        <input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file) return;
          if (!file.type.startsWith('image/')) return toast('Choose a photo for the group.', true);
          setPhoto(file); setPhotoUrl(URL.createObjectURL(file));
        }} />
        <label className="grp-field"><span>Group name</span><input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Family, best friends, weekend…" autoFocus /></label>
      </div>
      <label className="grp-field"><span>Description <small>optional</small></span><textarea value={description} maxLength={255} rows={2} onChange={e => setDescription(e.target.value)} placeholder="What is this group about?" /></label>
      <h4 className="grp-section-label">{`${people.length + 1} members`}</h4>
      <ul className="grp-member-preview">{people.map(p => <li key={p.id}><Avatar user={p} size={40} /><span translate="no">{firstName(p.displayName)}</span></li>)}</ul>
      <div className="grp-footer">
        <button type="button" className="button secondary" onClick={() => setStep('people')} disabled={create.isPending}><ArrowLeft size={17} /> Back</button>
        <button className="button grp-next" disabled={!name.trim() || create.isPending}><Users size={18} />{create.isPending ? 'Creating…' : 'Create group'}</button>
      </div>
    </form>}
  </Modal>;
}

/* ============================================================== message info */

function when(at: string | null) {
  if (!at) return '';
  const d = new Date(at), today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function MessageInfo({ groupId, message, onClose }: { groupId: string; message: Models['DirectMessageDto']; onClose: () => void }) {
  const { user } = useSession();
  const info = useQuery({ queryKey: ['messages', user?.id, 'group-receipts', message.id], queryFn: ({ signal }) => api('groupsReceipts', { params: { id: groupId, messageId: message.id }, signal }), refetchInterval: 4000 });
  const row = (u: User, at: string | null, kind: 'read' | 'got' | 'wait') => <li key={u.id}>
    <Avatar user={u} size={40} /><span className="grp-person"><strong translate="no">{u.displayName}</strong>{at && <small>{when(at)}</small>}</span>
    <span className={`grp-receipt ${kind}`} aria-hidden="true">{kind === 'read' ? '✓✓' : kind === 'got' ? '✓✓' : '✓'}</span>
  </li>;
  return <Modal title="Message info" onClose={onClose} className="grp-dialog grp-info-dialog">
    <div className="grp-msg-preview"><p>{message.content || (message.audioUrl ? '🎤 Voice message' : message.gif ? 'GIF' : message.sticker ? 'Sticker' : '📷 Photo')}</p><small>{when(message.createdAt)}</small></div>
    {info.isPending ? <p className="grp-hint" role="status">Loading…</p> : info.error ? <ErrorState error={info.error} retry={() => void info.refetch()} /> : <>
      <h4 className="grp-section-label"><span className="grp-receipt read">✓✓</span> {`Seen by ${info.data!.readBy.length}`}</h4>
      {info.data!.readBy.length ? <ul className="grp-receipts">{info.data!.readBy.map(r => row(r.user, r.at, 'read'))}</ul> : <p className="grp-hint">No one has seen it yet</p>}
      {info.data!.deliveredTo.length > 0 && <><h4 className="grp-section-label"><span className="grp-receipt got">✓✓</span> {`Delivered to ${info.data!.deliveredTo.length}`}</h4>
        <ul className="grp-receipts">{info.data!.deliveredTo.map(r => row(r.user, r.at, 'got'))}</ul></>}
      {info.data!.waiting.length > 0 && <><h4 className="grp-section-label"><span className="grp-receipt wait">✓</span> {`Not delivered yet ${info.data!.waiting.length}`}</h4>
        <ul className="grp-receipts">{info.data!.waiting.map(u => row(u, null, 'wait'))}</ul></>}
    </>}
  </Modal>;
}

/* ============================================================== group info */

function roleLabel(role: Member['role']) {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : null;
}

function MemberSheet({ group, member, onClose }: { group: Group; member: Member; onClose: () => void }) {
  const { user } = useSession(), client = useQueryClient(), toast = useToast();
  const [confirm, setConfirm] = useState<null | 'remove' | 'owner'>(null);
  const refresh = (g?: Group) => { if (g) client.setQueryData(['messages', user?.id, 'group', group.id], g); void client.invalidateQueries({ queryKey: ['messages'] }); };
  const role = useMutation({ mutationFn: (r: 'admin' | 'member' | 'owner') => api('groupsSetRole', { params: { id: group.id, userId: member.id }, body: { role: r } }), onSuccess: g => { refresh(g); onClose(); }, onError: e => toast(e.message, true) });
  const remove = useMutation({ mutationFn: () => api('groupsRemoveMember', { params: { id: group.id, userId: member.id } }), onSuccess: () => { refresh(); onClose(); }, onError: e => toast(e.message, true) });
  const owner = group.myRole === 'owner', me = member.id === user?.id;
  const canRemove = !me && member.role !== 'owner' && (owner || (group.myRole === 'admin' && member.role === 'member'));
  return <>
    <Modal title={member.displayName} onClose={onClose} className="grp-dialog grp-member-sheet">
      <div className="grp-member-head"><Avatar user={member} size={72} /><strong translate="no">{member.displayName}</strong>{member.username && <small>@{member.username}</small>}
        {roleLabel(member.role) && <em className={`grp-role ${member.role}`}>{roleLabel(member.role)}</em>}</div>
      <div className="grp-actions-list">
        {member.username && <Link href={`/profile/${member.username}`} onClick={onClose}><UserRound size={19} /> View profile</Link>}
        {member.username && !me && <Link href={`/messages?to=${member.username}`} onClick={onClose}><MessageCircle size={19} /> Send message</Link>}
        {owner && !me && member.role === 'member' && <button type="button" disabled={role.isPending} onClick={() => role.mutate('admin')}><Shield size={19} /> Make admin</button>}
        {owner && !me && member.role === 'admin' && <button type="button" disabled={role.isPending} onClick={() => role.mutate('member')}><ShieldOff size={19} /> Remove as admin</button>}
        {owner && !me && <button type="button" disabled={role.isPending} onClick={() => setConfirm('owner')}><Crown size={19} /> Make group owner</button>}
        {canRemove && <button type="button" className="danger" onClick={() => setConfirm('remove')}><UserMinus size={19} /> Remove from group</button>}
      </div>
    </Modal>
    {confirm === 'remove' && <ConfirmDialog title={`Remove ${firstName(member.displayName)}?`} description="They will lose access to this group chat." confirmLabel="Remove" pending={remove.isPending} onClose={() => setConfirm(null)} onConfirm={() => remove.mutate()} />}
    {confirm === 'owner' && <ConfirmDialog tone="primary" title={`Make ${firstName(member.displayName)} the owner?`} description="They will be able to manage everything in the group. You stay as an admin." confirmLabel="Make owner" pending={role.isPending} onClose={() => setConfirm(null)} onConfirm={() => role.mutate('owner')} />}
  </>;
}

function GroupEdit({ group, onDone }: { group: Group; onDone: () => void }) {
  const { user } = useSession(), client = useQueryClient(), toast = useToast(), router = useRouter();
  const [name, setName] = useState(group.name), [description, setDescription] = useState(group.description ?? '');
  const [deleting, setDeleting] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null), [progress, setProgress] = useState<number | null>(null);
  const refresh = (g?: Group) => { if (g) client.setQueryData(['messages', user?.id, 'group', group.id], g); void client.invalidateQueries({ queryKey: ['messages'] }); };
  const save = useMutation({
    mutationFn: () => api('groupsUpdate', { params: { id: group.id }, body: { name: name.trim(), description: description.trim() } }),
    onSuccess: g => { refresh(g); toast('Group updated.'); onDone(); }, onError: e => toast(e.message, true),
  });
  const photo = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api('groupsRemoveAvatar', { params: { id: group.id } });
      const media = await upload(file, setProgress) as Models['MediaDto'];
      try { return await api('groupsSetAvatar', { params: { id: group.id }, body: { mediaId: media.id } }); }
      catch (error) { void api('mediaRemove', { params: { id: media.id } }).catch(() => {}); throw error; }
    },
    onSuccess: g => refresh(g), onError: e => toast(e.message, true), onSettled: () => setProgress(null),
  });
  const perms = useMutation({ mutationFn: (body: { membersCanAdd?: boolean; membersCanEdit?: boolean }) => api('groupsPermissions', { params: { id: group.id }, body }), onSuccess: g => refresh(g), onError: e => toast(e.message, true) });
  const remove = useMutation({ mutationFn: () => api('groupsDelete', { params: { id: group.id } }), onSuccess: () => { refresh(); router.push('/messages'); }, onError: e => toast(e.message, true) });
  const owner = group.myRole === 'owner';
  return <div className="grp-edit">
    <div className="grp-identity">
      <button type="button" className="grp-photo-pick" disabled={photo.isPending} onClick={() => photoInput.current?.click()} aria-label="Change group photo">
        {group.avatarUrl ? <img src={group.avatarUrl} alt="" /> : <Camera size={28} />}
        <span className="grp-photo-badge"><ImagePlus size={14} /></span>
      </button>
      <input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) photo.mutate(f); }} />
      <label className="grp-field"><span>Group name</span><input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
    </div>
    {progress !== null && <small role="status" className="grp-hint">Uploading… {progress}%</small>}
    {group.avatarUrl && <button type="button" className="grp-link-danger" disabled={photo.isPending} onClick={() => photo.mutate(null)}>Remove photo</button>}
    <label className="grp-field"><span>Description</span><textarea value={description} maxLength={255} rows={3} onChange={e => setDescription(e.target.value)} placeholder="What is this group about?" /></label>
    {owner && <>
      <h4 className="grp-section-label">What members can do</h4>
      <label className="grp-toggle"><span><strong>Add people</strong><small>Otherwise only admins can</small></span>
        <input type="checkbox" role="switch" className="switch" checked={group.membersCanAdd} disabled={perms.isPending} onChange={e => perms.mutate({ membersCanAdd: e.target.checked })} /></label>
      <label className="grp-toggle"><span><strong>Change group info and pin messages</strong><small>Name, photo, description</small></span>
        <input type="checkbox" role="switch" className="switch" checked={group.membersCanEdit} disabled={perms.isPending} onChange={e => perms.mutate({ membersCanEdit: e.target.checked })} /></label>
    </>}
    <div className="grp-footer">
      <button type="button" className="button secondary" onClick={onDone}>Cancel</button>
      <button type="button" className="button grp-next" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
    </div>
    {owner && <button type="button" className="grp-delete" onClick={() => setDeleting(true)}><Trash2 size={17} /> Delete group</button>}
    {deleting && <ConfirmDialog title="Delete this group?" description="The group and all its messages will be deleted for everyone. This can't be undone." confirmLabel="Delete group" pending={remove.isPending} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} />}
  </div>;
}

function GroupInfo({ group, onClose, onJump }: { group: Group; onClose: () => void; onJump: (id: string) => void }) {
  const { user } = useSession(), client = useQueryClient(), toast = useToast(), router = useRouter();
  const [tab, setTab] = useState<'members' | 'media'>('members');
  const [editing, setEditing] = useState(false), [adding, setAdding] = useState(false), [leaving, setLeaving] = useState(false);
  const [toAdd, setToAdd] = useState<User[]>([]), [member, setMember] = useState<Member | null>(null), [viewing, setViewing] = useState<string | null>(null);
  const refresh = (g?: Group) => { if (g) client.setQueryData(['messages', user?.id, 'group', group.id], g); void client.invalidateQueries({ queryKey: ['messages'] }); };
  const media = useQuery({ queryKey: ['messages', user?.id, 'group-media', group.id], queryFn: ({ signal }) => api('groupsMedia', { params: { id: group.id }, signal }), enabled: tab === 'media' });
  const mute = useMutation({ mutationFn: () => api('groupsMute', { params: { id: group.id }, body: { muted: !group.muted } }), onSuccess: g => { refresh(g); toast(g.muted ? 'Notifications off for this group.' : 'Notifications on.'); }, onError: e => toast(e.message, true) });
  const add = useMutation({ mutationFn: () => api('groupsAddMembers', { params: { id: group.id }, body: { memberIds: toAdd.map(p => p.id) } }), onSuccess: g => { refresh(g); setAdding(false); setToAdd([]); }, onError: e => toast(e.message, true) });
  const leave = useMutation({ mutationFn: () => api('groupsLeave', { params: { id: group.id } }), onSuccess: () => { onClose(); refresh(); router.push('/messages'); }, onError: e => toast(e.message, true) });
  const admins = group.members.filter(m => m.role !== 'member').length;
  const title = editing ? 'Edit group' : adding ? 'Add members' : 'Group info';
  return <>
    <Modal title={title} onClose={onClose} className="grp-dialog grp-info">
      {editing ? <GroupEdit group={group} onDone={() => setEditing(false)} /> : adding ? <div className="grp-step">
        <Chips people={toAdd} onRemove={id => setToAdd(cur => cur.filter(p => p.id !== id))} />
        <PeoplePicker selected={toAdd} exclude={group.members.map(m => m.id)} disabled={add.isPending} onToggle={p => setToAdd(cur => cur.some(v => v.id === p.id) ? cur.filter(v => v.id !== p.id) : [...cur, p])} />
        <div className="grp-footer">
          <button type="button" className="button secondary" onClick={() => { setAdding(false); setToAdd([]); }}>Cancel</button>
          <button type="button" className="button grp-next" disabled={!toAdd.length || add.isPending} onClick={() => add.mutate()}><UserPlus size={17} />{add.isPending ? 'Adding…' : `Add${toAdd.length ? ` · ${toAdd.length}` : ''}`}</button>
        </div>
      </div> : <div className="grp-info-body">
        <div className="grp-hero">
          <GroupAvatar group={group} size={96} />
          <h3 translate="no">{group.name}</h3>
          <p>{`Group · ${group.memberCount} members`}</p>
        </div>
        <div className="grp-quick">
          {canAdd(group) && group.memberCount < 32 && <button type="button" onClick={() => setAdding(true)}><UserPlus size={20} /><span>Add</span></button>}
          <button type="button" disabled={mute.isPending} onClick={() => mute.mutate()} aria-pressed={group.muted}>{group.muted ? <BellOff size={20} /> : <Bell size={20} />}<span>{group.muted ? 'Unmute' : 'Mute'}</span></button>
          {canEdit(group) && <button type="button" onClick={() => setEditing(true)}><Pencil size={20} /><span>Edit</span></button>}
          <button type="button" className="danger" onClick={() => setLeaving(true)}><LogOut size={20} /><span>Leave</span></button>
        </div>
        {(group.description || group.pinned) && <div className="grp-card">
          {group.description && <div className="grp-about"><small>Description</small><p translate="no">{group.description}</p></div>}
          {group.pinned && <button type="button" className="grp-about pin" onClick={() => { onClose(); onJump(group.pinned!.id); }}><small><Pin size={12} /> Pinned message</small><p><b translate="no">{group.pinned.senderName}:</b> <span translate="no">{group.pinned.preview}</span></p></button>}
        </div>}
        <div className="grp-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members <em>{group.memberCount}</em></button>
          <button type="button" role="tab" aria-selected={tab === 'media'} className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>Media</button>
        </div>
        {tab === 'members' ? <>
          {admins > 0 && <p className="grp-hint left">{admins === 1 ? `1 admin · created ${when(group.createdAt)}` : `${admins} admins · created ${when(group.createdAt)}`}</p>}
          <ul className="grp-members">{group.members.map(m => <li key={m.id}>
            <button type="button" onClick={() => setMember(m)}>
              <Avatar user={m} size={44} />
              <span className="grp-person"><strong><span translate="no">{m.displayName}</span>{m.id === user?.id && <span className="grp-you"> (You)</span>}</strong><small>{m.username ? `@${m.username}` : 'Account unavailable'}</small></span>
              {roleLabel(m.role) && <em className={`grp-role ${m.role}`}>{roleLabel(m.role)}</em>}
            </button>
          </li>)}</ul>
        </> : media.isPending ? <p className="grp-hint" role="status">Loading…</p> : media.error ? <ErrorState error={media.error} retry={() => void media.refetch()} />
          : media.data!.items.length ? <div className="grp-media">{media.data!.items.map(item => <button type="button" key={item.messageId} onClick={() => item.type === 'IMAGE' ? setViewing(item.url) : (onClose(), onJump(item.messageId))}>
            {item.type === 'IMAGE' ? <img src={item.url} alt="" loading="lazy" /> : <video src={item.url} preload="metadata" muted playsInline />}
          </button>)}</div> : <p className="grp-hint">Photos and videos you share will appear here</p>}
      </div>}
    </Modal>
    {member && <MemberSheet group={group} member={member} onClose={() => setMember(null)} />}
    {viewing && <ImageViewer src={viewing} alt="Shared photo" onClose={() => setViewing(null)} />}
    {leaving && <ConfirmDialog title="Leave this group?" description={group.myRole === 'owner' ? 'An admin (or the longest-standing member) becomes the owner. The last person to leave deletes the group.' : 'You will lose access to messages until someone adds you again.'} confirmLabel="Leave group" onClose={() => setLeaving(false)} pending={leave.isPending} onConfirm={() => leave.mutate()} />}
  </>;
}

/* ============================================================== the chat */

export function GroupThread({ id, renderMessage }: { id: string; renderMessage: (message: Message, actions: GroupMessageActions) => ReactNode }) {
  const { user } = useSession(), client = useQueryClient(), toast = useToast(), calls = useCalls();
  const group = useQuery({ queryKey: ['messages', user?.id, 'group', id], queryFn: ({ signal }) => api('groupsGet', { params: { id }, signal }), refetchInterval: 5000 });
  const history = useInfiniteQuery({
    queryKey: ['messages', user?.id, 'group-thread', id], queryFn: ({ pageParam, signal }) => api('groupsMessages', { params: { id }, query: { cursor: pageParam, limit: 30 }, signal }),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.hasMore ? page.nextCursor ?? undefined : undefined, refetchInterval: 3000,
  });
  const messages = [...new Map((history.data?.pages.flatMap(page => page.items) ?? []).map(message => [message.id, message])).values()].reverse();
  const latest = messages.at(-1)?.id;
  const [text, setText] = useState(''), [info, setInfo] = useState(false), [editing, setEditing] = useState<Models['DirectMessageDto'] | null>(null), [reply, setReply] = useState<Models['DirectMessageDto'] | null>(null);
  const [unsending, setUnsending] = useState<Models['DirectMessageDto'] | null>(null), [voice, setVoice] = useState(false), [preview, setPreview] = useState(false);
  const [receipts, setReceipts] = useState<Models['DirectMessageDto'] | null>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const attachment = useMediaAttachment(), file = useRef<HTMLInputElement>(null), input = useRef<HTMLTextAreaElement>(null), scroller = useRef<HTMLDivElement>(null), list = useRef<HTMLOListElement>(null), pinnedRef = useRef(true), acknowledged = useRef('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['messages'] });
  const send = useMutation({ mutationFn: (draft: Draft) => api('groupsSend', { params: { id }, body: draft }), onSuccess: () => { attachment.attached(); setReply(null); refresh(); }, onError: (error, draft) => { if (draft && 'content' in draft && draft.content) setText(current => current || draft.content!); toast(error.message, true); } });
  const edit = useMutation({ mutationFn: () => api('groupsEdit', { params: { id, messageId: editing!.id }, body: { content: text.trim() } }), onSuccess: () => { setEditing(null); setText(''); refresh(); }, onError: error => toast(error.message, true) });
  const unsend = useMutation({ mutationFn: () => api('groupsUnsend', { params: { id, messageId: unsending!.id } }), onSuccess: () => { setUnsending(null); refresh(); }, onError: error => toast(error.message, true) });
  const pin = useMutation({ mutationFn: (messageId: string | null) => api('groupsPin', { params: { id }, body: { messageId } }), onSuccess: g => { client.setQueryData(['messages', user?.id, 'group', id], g); refresh(); }, onError: error => toast(error.message, true) });
  useEffect(() => { if (reply || editing) input.current?.focus({ preventScroll: true }); }, [reply, editing]);
  useEffect(() => { const element = input.current; if (element) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; } }, [text]);
  useEffect(() => { if (pinnedRef.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [latest]);
  useEffect(() => { const observer = new ResizeObserver(() => { if (pinnedRef.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }); if (list.current) observer.observe(list.current); if (scroller.current) observer.observe(scroller.current); return () => observer.disconnect(); }, [group.isPending]);
  useEffect(() => {
    const root = scroller.current, node = latest ? document.getElementById(`msg-${latest}`) : null; if (!root || !node || !latest) return;
    const acknowledge = () => {
      const box = node.getBoundingClientRect(), bounds = root.getBoundingClientRect();
      const read = document.visibilityState === 'visible' && document.hasFocus() && box.bottom > bounds.top && box.top < bounds.bottom && !document.querySelector('dialog:modal');
      const key = `${latest}:${read}`; if (acknowledged.current === key) return;
      acknowledged.current = key;
      void api('groupsAcknowledge', { params: { id }, body: { messageId: latest, read } }).then(() => client.invalidateQueries({ queryKey: ['messages', user?.id, 'groups'] })).catch(() => { acknowledged.current = ''; });
    };
    const observer = new IntersectionObserver(acknowledge, { root }); observer.observe(node);
    root.addEventListener('scroll', acknowledge); document.addEventListener('visibilitychange', acknowledge); window.addEventListener('focus', acknowledge); acknowledge();
    return () => { observer.disconnect(); root.removeEventListener('scroll', acknowledge); document.removeEventListener('visibilitychange', acknowledge); window.removeEventListener('focus', acknowledge); };
  }, [latest, id, client, user?.id, history.data]);
  const submit = () => {
    if (editing) { if (text.trim() && !edit.isPending) edit.mutate(); return; }
    if (send.isPending || attachment.busy || voice || (!text.trim() && !attachment.media)) return;
    const draft = { content: text.trim() || undefined, mediaId: attachment.media?.id, replyToId: reply?.id }; setText(''); pinnedRef.current = true; send.mutate(draft); input.current?.focus({ preventScroll: true });
  };
  const jump = (messageId: string) => {
    const node = document.getElementById(`msg-${messageId}`);
    if (node) { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); node.classList.add('grp-flash'); window.setTimeout(() => node.classList.remove('grp-flash'), 1600); }
    else toast('That message is further up this conversation.');
  };
  if (group.isPending) return <p className="dm-status" role="status">Loading group…</p>;
  if (group.error) return <div className="dm-empty"><ErrorState error={group.error} retry={() => void group.refetch()} /><Link href="/messages" className="button secondary">Back to messages</Link></div>;
  const g = group.data!;
  const editable = canEdit(g);
  const names = g.members.filter(m => m.id !== user?.id).map(m => firstName(m.displayName));
  return <section className="dm-thread group-thread" aria-label={`Group conversation ${g.name}`}>
    <header className="dm-thread-head grp-head">
      <Link href="/messages" className="dm-icon dm-back" aria-label="Back to conversations"><ArrowLeft size={23} /></Link>
      <button type="button" className="grp-head-main" onClick={() => setInfo(true)}>
        <GroupAvatar group={g} size={44} />
        <span className="group-title"><strong translate="no">{g.name}{g.muted && <BellOff size={13} className="grp-muted-icon" aria-label="Muted" />}</strong>
          <small><span translate="no">{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3}` : ''}</span></small></span>
      </button>
      <button className="dm-icon" aria-label="Group info" onClick={() => setInfo(true)}><Info size={23} /></button>
    </header>
    {g.pinned && <div className="grp-pinned">
      <button type="button" onClick={() => jump(g.pinned!.id)}><Pin size={16} /><span><small>Pinned message</small><b translate="no">{g.pinned.senderName}: </b><span translate="no">{g.pinned.preview}</span></span></button>
      {editable && <button type="button" className="dm-icon" aria-label="Unpin" disabled={pin.isPending} onClick={() => pin.mutate(null)}><X size={16} /></button>}
    </div>}
    <div className="dm-scroll" ref={scroller} onScroll={() => { const element = scroller.current; if (element) pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      <LoadMore hasMore={history.hasNextPage} pending={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()} />
      {history.error && <ErrorState error={history.error} retry={() => void history.refetch()} />}
      {!history.isPending && !history.hasNextPage && <div className="dm-intro grp-intro"><GroupAvatar group={g} size={88} /><strong translate="no">{g.name}</strong>
        <span>{`A private group · ${g.memberCount} members`}</span>{g.description && <p translate="no">{g.description}</p>}
        <button type="button" className="button secondary small" onClick={() => setInfo(true)}>Group info</button></div>}
      <ol className="dm-messages" ref={list}>{messages.map((message, index) => {
        if (message.event) {
          const actor = message.senderId === user?.id ? 'You' : firstName(message.sender.displayName);
          return <li key={message.id} id={`msg-${message.id}`} className="grp-event"><span>{groupEventText(message.event, actor)}</span></li>;
        }
        const prev = messages[index - 1], next = messages[index + 1];
        const own = message.senderId === user?.id;
        const first = prev?.senderId !== message.senderId || !!prev?.event, last = next?.senderId !== message.senderId || !!next?.event;
        return <Fragment key={message.id}>
          {!own && first && <li className="group-message-author" translate="no">{message.sender.displayName}</li>}
          {renderMessage(message, {
            own, first, last, pinned: g.pinned?.id === message.id,
            replyAuthor: g.members.find(member => member.id === message.replyTo?.senderId)?.displayName,
            onReply: value => { setReply(value); setEditing(null); },
            onEdit: value => { setEditing(value); setText(value.content ?? ''); setReply(null); attachment.clear(); },
            onUnsend: setUnsending, onJump: jump, onInfo: setReceipts,
            onPin: editable ? value => pin.mutate(g.pinned?.id === value.id ? null : value.id) : undefined,
          })}
        </Fragment>;
      })}</ol>
    </div>
    <form className="dm-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
      {(reply || editing) && <div className="dm-replying">{editing ? <Pencil size={16} /> : <Send size={16} />}<span><strong>{editing ? 'Editing message' : 'Replying to message'}</strong><small>{(editing ?? reply)?.content || 'Attachment'}</small></span><button type="button" className="dm-icon" aria-label={editing ? 'Cancel edit' : 'Cancel reply'} onClick={() => { setReply(null); if (editing) { setEditing(null); setText(''); } }}><X size={17} /></button></div>}
      {attachment.previewUrl && <div className="dm-attachment-preview"><div className="dm-draft-media">{attachment.previewType === 'VIDEO' ? <video src={attachment.previewUrl} controls playsInline /> : <button type="button" aria-label="Open photo preview" onClick={() => setPreview(true)}><img src={attachment.previewUrl} alt="Photo preview before sending" /></button>}</div><button type="button" className="dm-icon" aria-label="Remove attachment" onClick={attachment.clear}><X size={17} /></button></div>}
      {attachment.uploading && <p className="dm-notice">Uploading… {attachment.progress}%</p>}{attachment.error && <p className="dm-notice error">{attachment.error}</p>}
      <div className="dm-compose-row">
        <button type="button" className="dm-camera-launch dm-icon" aria-label="Attach photo or video" hidden={!!text.trim() || !!editing} disabled={attachment.busy || voice} onClick={() => file.current?.click()}><ImagePlus size={23} /></button>
        <textarea ref={input} aria-label="Message" placeholder="Message…" rows={1} maxLength={2000} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) { event.preventDefault(); submit(); } }} />
        <div className="dm-compose-actions" hidden={!!text.trim() || !!editing || !!attachment.media}>
          <StickerButton conversation dock={dock} disabled={send.isPending || attachment.busy || voice || !!attachment.media} onPick={sticker => send.mutate({ stickerId: sticker.id, replyToId: reply?.id })} onGif={gif => send.mutate({ gifId: gif.id, replyToId: reply?.id })} />
          {!calls.busy && <VoiceRecorder disabled={send.isPending || attachment.busy || !!attachment.media} onActiveChange={setVoice} onSend={async audioId => { await send.mutateAsync({ audioId, replyToId: reply?.id }); }} />}
        </div>
        <input ref={file} hidden type="file" accept="image/*,video/*" onChange={event => { void attachment.select(event.target.files?.[0]); event.target.value = ''; }} />
        {(!!text.trim() || !!attachment.media || !!editing) && <button type="submit" className="dm-send" aria-label={editing ? 'Save edit' : 'Send message'} disabled={send.isPending || edit.isPending || attachment.busy || voice || (!text.trim() && !attachment.media)} onPointerDown={event => event.preventDefault()}>{editing ? 'Save' : 'Send'}</button>}
      </div>
    </form>
    <div className="dm-sticker-dock" ref={setDock} />
    {info && <GroupInfo group={g} onClose={() => setInfo(false)} onJump={jump} />}
    {receipts && <MessageInfo groupId={id} message={receipts} onClose={() => setReceipts(null)} />}
    {unsending && <ConfirmDialog title="Unsend message?" description="It will be removed for everyone in this group." confirmLabel="Unsend" pending={unsend.isPending} onClose={() => setUnsending(null)} onConfirm={() => unsend.mutate()} />}
    {preview && attachment.previewUrl && <ImageViewer src={attachment.previewUrl} alt="Photo preview" onClose={() => setPreview(false)} />}
  </section>;
}
