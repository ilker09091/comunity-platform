import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { notBlockedSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaService } from '../media/media.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { UsersService, USER_SUMMARY_COLUMNS, USER_AVATAR_JOIN } from '../users/users.service.js';
import { MessagesService } from './messages.service.js';
import { StickersService } from './stickers.service.js';
import { PushService } from './push.service.js';
import { GifsService } from '../gifs/gifs.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import { CreateGroupDto, GroupDto, GroupDetailDto, GroupMessageDto } from './groups.dto.js';
import { SendMessageDto } from './social.dto.js';

type Db=DataSource|EntityManager;
@Injectable()
export class GroupsService {
  constructor(@InjectDataSource() private readonly db:DataSource,private readonly messages:MessagesService,
    private readonly users:UsersService,private readonly media:MediaService,private readonly stickers:StickersService,
    private readonly gifs:GifsService,private readonly deletion:ContentDeletionService,private readonly push:PushService,
    private readonly posts:PostsQueryService,private readonly urls:MediaUrlService){}

  private async member(m:Db,id:string,userId:string,lock=false) {
    const row=await sqlOne(m,`SELECT g.*,gm.read_seq FROM chat_groups g JOIN chat_group_members gm ON gm.group_id=g.id
      WHERE g.id=$1 AND gm.user_id=$2${lock?' FOR UPDATE OF g':''}`,[id,userId]);
    if(!row)throw AppException.notFound(ErrorCode.NOT_FOUND,'Group not found');return row;
  }
  private owner(row:Record<string,any>,viewer:string) {
    if(row.owner_id!==viewer)throw AppException.forbidden(ErrorCode.FORBIDDEN,'Only the group owner can manage members and settings');
  }
  private async eligible(m:Db,owner:string,ids:string[]) {
    for(const id of ids){
      if(id===owner)continue;
      try{await this.messages.assertCallPeer(owner,id,m);}catch(error){
        if(error instanceof AppException&&error.getStatus()===403)throw AppException.forbidden(ErrorCode.FORBIDDEN,'Add people who follow you or have accepted your messages');
        throw error;
      }
    }
  }
  async create(viewer:string,dto:CreateGroupDto):Promise<GroupDetailDto> {
    const ids=[...new Set([viewer,...dto.memberIds])];
    if(ids.length<3||ids.length>32)throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Choose 2 to 31 other people');
    const id=await this.db.transaction(async m=>{
      await sqlRows(m,'SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
      const full=await sqlOne(m,'SELECT user_id FROM chat_group_members WHERE user_id=ANY($1::uuid[]) GROUP BY user_id HAVING count(*)>=50 LIMIT 1',[ids]);
      if(full)throw AppException.conflict(ErrorCode.CONFLICT,'A person can join up to 50 group chats');
      await this.eligible(m,viewer,ids);
      if(await sqlOne(m,'SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) AND blocked_id=ANY($1::uuid[])',[ids]))
        throw AppException.forbidden(ErrorCode.FORBIDDEN,'Some people cannot be added to the same group');
      const row=await sqlOne<{id:string}>(m,'INSERT INTO chat_groups(name,owner_id) VALUES($1,$2) RETURNING id',[dto.name.trim(),viewer]);
      await sqlRows(m,'INSERT INTO chat_group_members(group_id,user_id) SELECT $1,unnest($2::uuid[])',[row!.id,ids]);
      return row!.id;
    });
    return this.get(viewer,id);
  }
  private summary(r:Record<string,any>):GroupDto {
    return {id:r.id,name:r.name,avatarUrl:this.urls.url(r.avatar_key??null),ownerId:r.owner_id,memberCount:r.member_count,unreadCount:r.unread_count??0,lastMessage:r.last_message??null,updatedAt:iso(r.updated_at)!};
  }
  private columns=`g.*,(SELECT storage_key FROM media WHERE id=g.avatar_media_id) avatar_key,(SELECT count(*)::int FROM chat_group_members x WHERE x.group_id=g.id) member_count,
    (SELECT count(*)::int FROM group_messages msg WHERE msg.group_id=g.id AND msg.seq>gm.read_seq AND msg.sender_id<>$1 AND ${notBlockedSql('msg.sender_id','$1')}) unread_count,
    (SELECT coalesce(msg.content,CASE WHEN msg.gif IS NOT NULL THEN 'GIF' WHEN msg.has_sticker THEN 'Sticker' WHEN msg.audio_key IS NOT NULL THEN 'Voice message' ELSE 'Attachment' END)
      FROM group_messages msg WHERE msg.group_id=g.id AND ${notBlockedSql('msg.sender_id','$1')} ORDER BY msg.created_at DESC,msg.id DESC LIMIT 1) last_message`;
  async list(viewer:string,cursorStr?:string,limit=20) {
    const cursor=decodeCursor(cursorStr,['date','uuid']);
    const rows=await sqlRows(this.db,`SELECT ${this.columns} FROM chat_groups g JOIN chat_group_members gm ON gm.group_id=g.id AND gm.user_id=$1
      ${cursor?'WHERE (g.updated_at,g.id)<($2::timestamptz,$3::uuid)':''} ORDER BY g.updated_at DESC,g.id DESC LIMIT $${cursor?4:2}`,
      cursor?[viewer,...cursor,limit+1]:[viewer,limit+1]);
    return toPage(rows,limit,r=>this.summary(r),r=>[iso(r.updated_at)!,r.id]);
  }
  async get(viewer:string,id:string):Promise<GroupDetailDto> {
    await this.member(this.db,id,viewer);
    const r=await sqlOne(this.db,`SELECT ${this.columns} FROM chat_groups g JOIN chat_group_members gm ON gm.group_id=g.id AND gm.user_id=$1 WHERE g.id=$2`,[viewer,id]);
    const members=await sqlRows(this.db,`SELECT ${USER_SUMMARY_COLUMNS}, ${notBlockedSql('u.id','$2')} visible FROM chat_group_members x JOIN users u ON u.id=x.user_id ${USER_AVATAR_JOIN} WHERE x.group_id=$1 ORDER BY x.joined_at,u.id`,[id,viewer]);
    return {...this.summary(r!),members:members.map(member=>member.visible?this.users.toSummary(member as any):{...this.users.toSummary(member as any),displayName:'Circle user',username:'',avatarUrl:null,isVerified:false})};
  }
  async members(viewer:string,id:string,ids:string[]) {
    await this.db.transaction(async m=>{
      this.owner(await this.member(m,id,viewer,true),viewer);
      await sqlRows(m,'SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
      const full=await sqlOne(m,`SELECT user_id FROM chat_group_members WHERE user_id=ANY($1::uuid[])
        AND user_id NOT IN(SELECT user_id FROM chat_group_members WHERE group_id=$2) GROUP BY user_id HAVING count(*)>=50 LIMIT 1`,[ids,id]);
      if(full)throw AppException.conflict(ErrorCode.CONFLICT,'A person can join up to 50 group chats');
      await this.eligible(m,viewer,ids);
      const all=await sqlRows<{user_id:string}>(m,'SELECT user_id FROM chat_group_members WHERE group_id=$1',[id]);
      const together=[...new Set([...all.map(member=>member.user_id),...ids])];
      if(await sqlOne(m,'SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) AND blocked_id=ANY($1::uuid[])',[together]))throw AppException.forbidden(ErrorCode.FORBIDDEN,'Some people cannot be added to the same group');
      await sqlRows(m,'INSERT INTO chat_group_members(group_id,user_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING',[id,ids]);
      const count=await sqlOne<{n:number}>(m,'SELECT count(*)::int n FROM chat_group_members WHERE group_id=$1',[id]);
      if(count!.n>32)throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'A group can have up to 32 people');
    });return this.get(viewer,id);
  }
  async rename(viewer:string,id:string,name:string) {
    await this.db.transaction(async m=>{this.owner(await this.member(m,id,viewer,true),viewer);await sqlRows(m,'UPDATE chat_groups SET name=$2,updated_at=now() WHERE id=$1',[id,name.trim()]);});
    return this.get(viewer,id);
  }
  async setAvatar(viewer:string,id:string,mediaId:string|null) {
    const files=await this.db.transaction(async m=>{
      const group=await this.member(m,id,viewer,true);this.owner(group,viewer);
      if(group.avatar_media_id===mediaId)return null;
      if(mediaId)await this.media.lockAttachable(m,viewer,[mediaId],{imagesOnly:true});
      await sqlRows(m,'UPDATE chat_groups SET avatar_media_id=$2 WHERE id=$1',[id,mediaId]);
      return this.deletion.deleteMedia(m,group.avatar_media_id?[group.avatar_media_id]:[]);
    });
    if(files)await this.deletion.removeFiles(files);
    return this.get(viewer,id);
  }
  async removeMember(viewer:string,id:string,target:string) {
    if(viewer===target)return this.leave(viewer,id);
    await this.db.transaction(async m=>{this.owner(await this.member(m,id,viewer,true),viewer);await sqlRows(m,'DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2',[id,target]);});
  }
  async leave(viewer:string,id:string) {
    const files=await this.db.transaction(async m=>{
      const group=await this.member(m,id,viewer,true);
      await sqlRows(m,'DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2',[id,viewer]);
      const next=await sqlOne<{user_id:string}>(m,'SELECT user_id FROM chat_group_members WHERE group_id=$1 ORDER BY joined_at,user_id LIMIT 1',[id]);
      if(next){if(group.owner_id===viewer)await sqlRows(m,'UPDATE chat_groups SET owner_id=$2 WHERE id=$1',[id,next.user_id]);return null;}
      const rows=await sqlRows<{media_id:string;audio_key:string}>(m,'SELECT media_id,audio_key FROM group_messages WHERE group_id=$1',[id]);
      await sqlRows(m,'DELETE FROM chat_groups WHERE id=$1',[id]);
      return [await this.deletion.deleteMedia(m,[group.avatar_media_id,...rows.map(r=>r.media_id)].filter(Boolean)),await this.deletion.queueFiles(m,rows.map(r=>r.audio_key).filter(Boolean))];
    });if(files)for(const pending of files)await this.deletion.removeFiles(pending);
  }
  private async hydrate(rows:Record<string,any>[],viewer:string):Promise<GroupMessageDto[]> {
    const clean=rows.map(r=>({...r,id:r.message_id??r.id,recipient_id:viewer,reply_to_id:null}));
    const messages=await this.messages.hydrate(clean,viewer);
    return messages.map((message,i)=>{
      const row=rows[i];
      const parent=row.parent_preview;
      return {...message,sender:this.users.toSummary({...row,id:row.sender_id} as any),
        replyTo:row.reply_to_id?{id:row.reply_to_id,senderId:row.parent_sender??row.sender_id,
          kind:!parent?'UNAVAILABLE':parent.content?'TEXT':parent.has_sticker?'STICKER':parent.audio_key?'AUDIO':parent.gif?'GIF':parent.media_type==='IMAGE'?'PHOTO':parent.media_type==='VIDEO'?'VIDEO':parent.post_id?'POST':'UNAVAILABLE',
          preview:parent?parent.content?.slice(0,140)??null:'Message unavailable',audioDurationMs:parent?.audio_duration_ms??null,
          thumbnailUrl:parent?.gif?.previewUrl??(parent?.media_type==='IMAGE'?this.urls.url(parent.media_key):null)}:null};
    });
  }
  private messageColumns=`msg.*,msg.id AS message_id,${USER_SUMMARY_COLUMNS},CASE WHEN ${notBlockedSql('parent.sender_id','$1')}
    THEN json_build_object('content',parent.content,'has_sticker',parent.has_sticker,'audio_key',parent.audio_key,'audio_duration_ms',parent.audio_duration_ms,
      'gif',parent.gif,'post_id',parent.post_id,'media_type',parent_media.type,'media_key',parent_media.storage_key) END parent_preview,parent.sender_id parent_sender,
    CASE WHEN NOT EXISTS(SELECT 1 FROM chat_group_members x WHERE x.group_id=msg.group_id AND x.user_id<>msg.sender_id AND x.delivered_seq<msg.seq) THEN msg.created_at END delivered_at,
    CASE WHEN NOT EXISTS(SELECT 1 FROM chat_group_members x WHERE x.group_id=msg.group_id AND x.user_id<>msg.sender_id AND x.read_seq<msg.seq) THEN msg.created_at END read_at`;
  private messageJoins=`JOIN users u ON u.id=msg.sender_id ${USER_AVATAR_JOIN} LEFT JOIN group_messages parent ON parent.id=msg.reply_to_id LEFT JOIN media parent_media ON parent_media.id=parent.media_id`;
  async history(viewer:string,id:string,cursorStr?:string,limit=30) {
    await this.member(this.db,id,viewer);const cursor=decodeCursor(cursorStr,['date','uuid']);
    const rows=await sqlRows(this.db,`SELECT ${this.messageColumns} FROM group_messages msg ${this.messageJoins}
      WHERE msg.group_id=$2 AND ${notBlockedSql('msg.sender_id','$1')} ${cursor?'AND (msg.created_at,msg.id)<($3::timestamptz,$4::uuid)':''}
      ORDER BY msg.created_at DESC,msg.id DESC LIMIT $${cursor?5:3}`,
      cursor?[viewer,id,...cursor,limit+1]:[viewer,id,limit+1]);
    const page=toPage(rows,limit,r=>r,r=>[iso(r.created_at)!,r.message_id]);
    return {...page,items:await this.hydrate(page.items,viewer)};
  }
  async send(viewer:string,id:string,dto:SendMessageDto):Promise<GroupMessageDto> {
    await this.member(this.db,id,viewer);
    if(!dto.content?.trim()&&!dto.mediaId&&!dto.stickerId&&!dto.gifId&&!dto.audioId&&!dto.postId)throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Write a message or choose an attachment');
    if(dto.viewOnce)throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'View-once attachments are only available in direct chats');
    if([dto.mediaId,dto.stickerId,dto.gifId,dto.audioId,dto.postId].filter(Boolean).length>1)throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Choose one attachment');
    const gif=dto.gifId?await this.gifs.resolve(dto.gifId):null;
    if(dto.postId)await this.posts.getOne(dto.postId,viewer);
    const message=await this.db.transaction(async m=>{
      await this.member(m,id,viewer,true);
      if(dto.replyToId&&!await sqlOne(m,`SELECT 1 FROM group_messages msg WHERE msg.id=$1 AND msg.group_id=$2 AND ${notBlockedSql('msg.sender_id','$3')}`,[dto.replyToId,id,viewer]))throw AppException.notFound();
      if(dto.stickerId)await this.stickers.assertAvailable(viewer,dto.stickerId,m);
      if(dto.mediaId){const [media]=await this.media.lockAttachable(m,viewer,[dto.mediaId]);if(media.status!=='READY')throw AppException.badRequest(ErrorCode.INVALID_MEDIA,'Wait for the attachment to finish processing');}
      const audio=dto.audioId?await sqlOne(m,'SELECT * FROM message_audio_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE',[dto.audioId,viewer]):null;
      if(dto.audioId&&!audio)throw AppException.notFound(ErrorCode.NOT_FOUND,'Voice recording not found');
      const row=await sqlOne<{id:string}>(m,`INSERT INTO group_messages(group_id,sender_id,content,media_id,post_id,sticker_id,has_sticker,audio_key,audio_duration_ms,gif,reply_to_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[id,viewer,dto.content?.trim()||null,dto.mediaId??null,dto.postId??null,dto.stickerId??null,!!dto.stickerId,audio?.storage_key??null,audio?.duration_ms??null,gif?JSON.stringify(gif):null,dto.replyToId??null]);
      if(audio)await sqlRows(m,'DELETE FROM message_audio_uploads WHERE id=$1',[dto.audioId]);
      await sqlRows(m,'UPDATE chat_groups SET updated_at=now() WHERE id=$1',[id]);return row!.id;
    });
    const members=await sqlRows<{user_id:string}>(this.db,`SELECT user_id FROM chat_group_members WHERE group_id=$1 AND user_id<>$2 AND ${notBlockedSql('user_id','$2')}`,[id,viewer]);
    for(const member of members)this.push.notifyUser(member.user_id);
    return this.one(viewer,id,message);
  }
  private async one(viewer:string,id:string,message:string) {
    const row=await sqlOne(this.db,`SELECT ${this.messageColumns} FROM group_messages msg ${this.messageJoins} WHERE msg.group_id=$2 AND msg.id=$3`,[viewer,id,message]);
    if(!row)throw AppException.notFound();return (await this.hydrate([row],viewer))[0];
  }
  async edit(viewer:string,id:string,message:string,content:string) {
    if(!content.trim())throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Write a message');
    await this.db.transaction(async m=>{
      await this.member(m,id,viewer,true);
      const row=await sqlOne(m,`UPDATE group_messages SET content=$4,edited_at=now() WHERE group_id=$1 AND id=$2 AND sender_id=$3 AND content IS NOT NULL RETURNING id`,[id,message,viewer,content.trim()]);
      if(!row)throw AppException.notFound();
    });return this.one(viewer,id,message);
  }
  async unsend(viewer:string,id:string,message:string) {
    const files=await this.db.transaction(async m=>{
      await this.member(m,id,viewer,true);
      const row=await sqlOne(m,'DELETE FROM group_messages WHERE group_id=$1 AND id=$2 AND sender_id=$3 RETURNING media_id,audio_key',[id,message,viewer]);
      if(!row)throw AppException.notFound();
      return [await this.deletion.deleteMedia(m,row.media_id?[row.media_id]:[]),await this.deletion.queueFiles(m,row.audio_key?[row.audio_key]:[])];
    });for(const pending of files)await this.deletion.removeFiles(pending);
  }
  async acknowledge(viewer:string,id:string,message:string,read=false) {
    await this.member(this.db,id,viewer);
    const row=await sqlOne<{seq:string}>(this.db,'SELECT seq FROM group_messages WHERE id=$1 AND group_id=$2',[message,id]);
    if(!row)throw AppException.notFound();
    await sqlRows(this.db,`UPDATE chat_group_members SET delivered_seq=greatest(delivered_seq,$3),read_seq=greatest(read_seq,CASE WHEN $4 THEN $3::bigint ELSE read_seq END) WHERE group_id=$1 AND user_id=$2`,[id,viewer,row.seq,read]);
  }
}
