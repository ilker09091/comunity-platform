import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { UsersService, USER_SUMMARY_COLUMNS, USER_AVATAR_JOIN, type UserSummaryRow } from '../users/users.service.js';
import { MessagesService } from './messages.service.js';
import { PushService } from './push.service.js';
import { CallActionDto, CallConfigDto, CallDto, CallQueryDto, CallSignalInputDto, CallStateDto, StartCallDto } from './calls.dto.js';

interface CallRow {
  id: string; caller_id: string; callee_id: string; caller_device: string; callee_device: string | null;
  state: 'ringing'|'accepted'|'ended'; kind: 'audio'|'video'; created_at: Date; accepted_at: Date|null; end_reason: string|null;
}
@Injectable()
export class CallsService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly users: UsersService,
    private readonly messages: MessagesService, private readonly push: PushService) {}

  config(userId: string): CallConfigDto {
    const stun = (process.env.CALL_STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map(s=>s.trim()).filter(Boolean);
    const turn = (process.env.CALL_TURN_URLS ?? '').split(',').map(s=>s.trim()).filter(Boolean);
    const secret = process.env.CALL_TURN_SECRET;
    const iceServers: CallConfigDto['iceServers'] = stun.length ? [{ urls: stun }] : [];
    if (turn.length && secret) {
      const username = `${Math.floor(Date.now()/1000)+86400}:${userId}`;
      iceServers.push({ urls: turn, username, credential: createHmac('sha1',secret).update(username).digest('base64') });
    }
    return { iceServers, relayConfigured: !!(turn.length && secret) };
  }
  private async expire(m: DataSource|EntityManager, userId: string) {
    const ended=await sqlRows<{id:string}>(m, `UPDATE calls SET state='ended',ended_at=now(),end_reason=CASE WHEN state='ringing' THEN 'missed' ELSE 'disconnected' END
      WHERE state<>'ended' AND (caller_id=$1 OR callee_id=$1) AND (
        (state='ringing' AND created_at<now()-interval '60 seconds') OR
        (state='accepted' AND (caller_seen_at<now()-interval '45 seconds' OR callee_seen_at<now()-interval '45 seconds')) OR
        created_at<now()-interval '4 hours' OR
        EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=caller_id AND b.blocked_id=callee_id) OR (b.blocker_id=callee_id AND b.blocked_id=caller_id)) OR
        EXISTS(SELECT 1 FROM users u WHERE u.id IN(caller_id,callee_id) AND u.status<>'ACTIVE'))
      RETURNING id`,[userId]);
    await this.record(m,ended.map(r=>r.id));
  }
  /**
   * Instagram-style call history: each finished call becomes one entry in the conversation, from
   * the caller, with its outcome and length. Answered/declined calls need no attention, so they
   * arrive already read; a missed call stays unread for the person who missed it.
   */
  private async record(m: DataSource|EntityManager, ids: string[]) {
    if(!ids.length) return;
    const missed=await sqlRows<{recipient_id:string;read_at:Date|null}>(m,`INSERT INTO direct_messages
        (sender_id,recipient_id,created_at,call_id,call_kind,call_status,call_duration_s,delivered_at,read_at)
      SELECT c.caller_id,c.callee_id,c.ended_at,c.id,c.kind,o.status,
        CASE WHEN o.status='completed' THEN GREATEST(0,round(extract(epoch FROM c.ended_at-c.accepted_at)))::int END,
        CASE WHEN o.status IN('completed','declined') THEN c.ended_at END,
        CASE WHEN o.status IN('completed','declined') THEN c.ended_at END
      FROM calls c CROSS JOIN LATERAL (SELECT CASE WHEN c.accepted_at IS NOT NULL THEN 'completed'
        WHEN c.end_reason IN('declined','cancelled') THEN c.end_reason ELSE 'missed' END AS status) o
      WHERE c.id=ANY($1::uuid[]) AND c.state='ended' AND c.ended_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=c.caller_id AND b.blocked_id=c.callee_id) OR (b.blocker_id=c.callee_id AND b.blocked_id=c.caller_id))
      ON CONFLICT (call_id) DO NOTHING
      RETURNING recipient_id,read_at`,[ids]);
    // A missed call notifies like a message; the ringing notification is replaced by it.
    for(const row of missed) if(!row.read_at) this.push.notifyUser(row.recipient_id);
  }
  private async row(m: DataSource|EntityManager, id: string, userId: string, lock=false) {
    const row = await sqlOne<CallRow>(m,`SELECT * FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)${lock?' FOR UPDATE':''}`,[id,userId]);
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND,'Call not found');
    return row;
  }
  private owns(row: CallRow,userId: string,device: string) { return (row.caller_id===userId?row.caller_device:row.callee_device)===device; }
  private async dto(row: CallRow,userId: string,device: string): Promise<CallDto> {
    const peerId=row.caller_id===userId?row.callee_id:row.caller_id;
    const peer=await sqlOne<UserSummaryRow>(this.db,`SELECT ${USER_SUMMARY_COLUMNS} FROM users u ${USER_AVATAR_JOIN} WHERE u.id=$1`,[peerId]);
    if(!peer) throw AppException.notFound(ErrorCode.USER_NOT_FOUND,'User not found');
    const relationship=await this.users.relationship(userId,peerId);
    if(relationship.isBlockedBy || relationship.isBlocking) { peer.display_name='User not found';peer.username='';peer.avatar_key=null; }
    return { id:row.id,kind:row.kind,state:row.state,outgoing:row.caller_id===userId,
      canControl:this.owns(row,userId,device)||(row.state==='ringing'&&row.callee_id===userId),
      peer:this.users.toSummary(peer),createdAt:row.created_at.toISOString(),acceptedAt:row.accepted_at?.toISOString()??null,endReason:row.end_reason };
  }
  async current(userId: string,device: string) {
    await this.expire(this.db,userId);
    const row=await sqlOne<CallRow>(this.db,`SELECT * FROM calls WHERE state<>'ended' AND (caller_id=$1 OR callee_id=$1) ORDER BY created_at DESC LIMIT 1`,[userId]);
    return { call:row?await this.dto(row,userId,device):null };
  }
  async start(userId: string,input: StartCallDto) {
    await this.messages.assertCallPeer(userId,input.peerId);
    const row=await this.db.transaction(async m=>{
      // Lock both participants in stable order: simultaneous and crossing calls cannot overlap.
      for(const id of [userId,input.peerId].sort()) await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,8192))',[id]);
      await this.expire(m,userId); await this.expire(m,input.peerId);
      await this.messages.assertCallPeer(userId,input.peerId,m);
      if(await sqlOne(m,`SELECT 1 FROM calls WHERE state<>'ended' AND (caller_id=ANY($1::uuid[]) OR callee_id=ANY($1::uuid[]))`,[[userId,input.peerId]]))
        throw AppException.conflict(ErrorCode.INVALID_STATE,'You or this person are already in a call');
      return (await sqlOne<CallRow>(m,`INSERT INTO calls(caller_id,callee_id,kind,caller_device) VALUES($1,$2,$3,$4) RETURNING *`,[userId,input.peerId,input.kind,input.deviceId]))!;
    });
    this.push.notifyUser(input.peerId,'calls');
    return this.dto(row,userId,input.deviceId);
  }
  async action(userId: string,id: string,input: CallActionDto) {
    await this.expire(this.db,userId);
    const row=await this.db.transaction(async m=>{
      const row=await this.row(m,id,userId,true);
      if(row.state==='ended') {
        if(input.action!=='end')throw AppException.conflict(ErrorCode.INVALID_STATE,'This call has ended');
        return row;
      }
      if(input.action==='accept') {
        if(row.callee_id!==userId || row.state!=='ringing') throw AppException.conflict(ErrorCode.INVALID_STATE,'This call was already answered or ended');
        await this.messages.assertCallPeer(row.caller_id,row.callee_id,m);
        return (await sqlOne<CallRow>(m,`UPDATE calls SET state='accepted',accepted_at=now(),callee_device=$2,callee_seen_at=now(),caller_seen_at=now() WHERE id=$1 RETURNING *`,[id,input.deviceId]))!;
      }
      if(input.action==='reject' ? row.callee_id!==userId||row.state!=='ringing' : !this.owns(row,userId,input.deviceId))
        throw AppException.forbidden(ErrorCode.FORBIDDEN,'This call belongs to another device');
      const ended=(await sqlOne<CallRow>(m,`UPDATE calls SET state='ended',ended_at=now(),end_reason=$2 WHERE id=$1 RETURNING *`,[id,input.action==='reject'?'declined':row.state==='ringing'?'cancelled':'hangup']))!;
      await this.record(m,[ended.id]);
      return ended;
    });
    return this.dto(row,userId,input.deviceId);
  }
  async poll(userId: string,id: string,q: CallQueryDto): Promise<CallStateDto> {
    await this.expire(this.db,userId);
    const row=await this.row(this.db,id,userId);
    if(!this.owns(row,userId,q.deviceId) && !(row.state==='ringing'&&row.callee_id===userId))
      throw AppException.forbidden(ErrorCode.FORBIDDEN,'This call belongs to another device');
    if(row.state!=='ended'&&this.owns(row,userId,q.deviceId))
      await sqlRows(this.db,`UPDATE calls SET ${row.caller_id===userId?'caller_seen_at':'callee_seen_at'}=now() WHERE id=$1 AND state<>'ended'`,[id]);
    const signals=row.state==='accepted'?await sqlRows<{id:string;kind:'description'|'ice';payload:string}>(this.db,
      'SELECT id,kind,payload FROM call_signals WHERE call_id=$1 AND sender_id<>$2 AND id>$3 ORDER BY id LIMIT 100',[id,userId,q.after??0]):[];
    return { call:await this.dto(row,userId,q.deviceId),signals:signals.map(s=>({...s,id:Number(s.id)})),cursor:signals.length?Number(signals.at(-1)!.id):q.after??0 };
  }
  async signal(userId: string,id: string,input: CallSignalInputDto) {
    let data: Record<string,unknown>;
    try { data=JSON.parse(input.payload); } catch { throw AppException.badRequest(ErrorCode.BAD_REQUEST,'Invalid call signal'); }
    if(!data || typeof data!=='object' || Array.isArray(data) || (input.kind==='description'
      ? !['offer','answer'].includes(String(data.type))||typeof data.sdp!=='string'||data.sdp.length>60000
      : typeof data.candidate!=='string'||data.candidate.length>4096)) throw AppException.badRequest(ErrorCode.BAD_REQUEST,'Invalid call signal');
    await this.expire(this.db,userId);
    await this.db.transaction(async m=>{
      const row=await this.row(m,id,userId,true);
      if(row.state!=='accepted'||!this.owns(row,userId,input.deviceId)) throw AppException.forbidden(ErrorCode.FORBIDDEN,'Call is not active on this device');
      // A block immediately terminates signaling, even if introduced between polls.
      await this.messages.assertCallPeer(row.caller_id,row.callee_id,m);
      const count=await sqlOne<{n:number}>(m,'SELECT count(*)::int n FROM call_signals WHERE call_id=$1',[id]);
      if((count?.n??0)>=2000) throw AppException.badRequest(ErrorCode.BAD_REQUEST,'Call signaling limit reached');
      await m.query('INSERT INTO call_signals(call_id,sender_id,kind,payload) VALUES($1,$2,$3,$4)',[id,userId,input.kind,input.payload]);
    });
  }
  @Cron('0 * * * *')
  async cleanup() { await this.db.query(`DELETE FROM calls WHERE created_at<now()-interval '1 day'`); }
}
