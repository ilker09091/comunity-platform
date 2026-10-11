import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { appConfig } from '../../config/app.config.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { postVisibleSql, sqlOne, sqlRows } from '../../common/utils/sql.js';
import { PostsQueryService } from '../posts/posts-query.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { ReelExposeDto, ReelFeedbackDto, ReelsPageDto, ReelsQueryDto, ReelWatchBatchDto } from './reels.dto.js';

type Session={id:string;user_id:string|null;created_at:Date;expires_at:Date;allow_rewatch:boolean;next_position:number;last_creator:string|null;creator_streak:number};
type Candidate={id:string;author_id:string;score:number};
const playable = `p.kind<>'REPOST' AND EXISTS(SELECT 1 FROM post_media pm JOIN media mv ON mv.id=pm.media_id WHERE pm.post_id=p.id AND mv.type='VIDEO' AND mv.status='READY')`;
const feedbackSql=(v:string)=>`NOT EXISTS(SELECT 1 FROM reel_feedback rf WHERE rf.user_id=${v}::uuid AND rf.post_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM reports rp WHERE rp.reporter_id=${v}::uuid AND rp.target_type='POST' AND rp.target_id=p.id)`;
const invalid=()=>AppException.badRequest(ErrorCode.INVALID_CURSOR,'Recommendation session expired or cursor invalid; refresh for new content');

/** Bounded diversity pass over an SQL-ranked window, never the full media library. */
export function diversify<T extends Candidate>(rows:T[],creator:string|null=null,streak=0,limit=80) {
  const pool=[...rows],items:T[]=[];
  while(pool.length && items.length<limit) {
    const alternative=streak>=2?pool.findIndex(r=>r.author_id!==creator):-1;
    const [row]=pool.splice(alternative>=0?alternative:0,1);
    streak=row.author_id===creator?streak+1:1;creator=row.author_id;items.push(row);
  }
  return {items,creator,streak:Math.min(streak,32767)};
}

@Injectable()
export class ReelsService {
  constructor(@InjectDataSource() private readonly db:DataSource,private readonly posts:PostsQueryService,
    private readonly settings:PlatformSettingsService,@Inject(appConfig.KEY) private readonly config:ConfigType<typeof appConfig>) {}

  private cursor(id:string,position:number) {
    const body=Buffer.from(JSON.stringify([1,id,position])).toString('base64url');
    return body+'.'+createHmac('sha256',this.config.auth.jwtSecret).update(body).digest('base64url');
  }
  private decode(value:string) {
    try {
      const [body,mac,...extra]=value.split('.');
      const expected=createHmac('sha256',this.config.auth.jwtSecret).update(body).digest();
      const supplied=Buffer.from(mac,'base64url');
      if(extra.length || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw invalid();
      const data:unknown=JSON.parse(Buffer.from(body,'base64url').toString());
      if(!Array.isArray(data)||data.length!==3||data[0]!==1||!/^[-0-9a-f]{36}$/.test(data[1])||!Number.isInteger(data[2])||data[2]<0) throw invalid();
      return {id:String(data[1]),position:Number(data[2])};
    } catch {throw invalid();}
  }
  private async session(m:EntityManager,id:string,viewer:string|null):Promise<Session> {
    const row=await sqlOne<Session>(m,'SELECT * FROM reel_recommendation_sessions WHERE id=$1 FOR UPDATE',[id]);
    if(!row || row.user_id!==viewer || row.expires_at.getTime()<=Date.now()) throw invalid();
    return row;
  }

  /** Snapshot-ranked 80-item windows, a signed keyset cursor and immutable assigned positions.
   * Privacy/blocks/moderation are rechecked on EVERY page; watched exclusion only applies to
   * new candidates, allowing explicit backward navigation in the already delivered list.
   */
  async page(viewer:string|null,q:ReelsQueryDto):Promise<ReelsPageDto> {
    await this.settings.assertFeature('reels');
    const cursor=q.cursor?this.decode(q.cursor):null, limit=q.limit??15;
    if(cursor && q.session && cursor.id!==q.session) throw invalid();
    const result=await this.db.transaction(async m=>{
      const id=cursor?.id??q.session;
      const session=id?await this.session(m,id,viewer):await sqlOne<Session>(m,
        `INSERT INTO reel_recommendation_sessions(user_id,allow_rewatch) VALUES($1,$2) RETURNING *`,[viewer,q.rewatch===true]);
      if(!session) throw invalid();
      const position=cursor?.position??0;
      if(position>session.next_position) throw invalid();
      const existing=await sqlOne<{n:number}>(m,`SELECT count(*)::int n FROM reel_recommendation_impressions i JOIN posts p ON p.id=i.post_id JOIN users a ON a.id=p.author_id
        WHERE i.session_id=$2 AND i.position>$3 AND NOT i.direct AND ${playable} AND ${postVisibleSql('p','a','$1')} AND ${feedbackSql('$1')}`,[viewer,session.id,position]);
      if((existing?.n??0)<limit+1) await this.allocate(m,session,viewer);
      const rows=await sqlRows<{post_id:string;position:number}>(m,`SELECT i.post_id,i.position FROM reel_recommendation_impressions i
        JOIN posts p ON p.id=i.post_id JOIN users a ON a.id=p.author_id
        WHERE i.session_id=$2 AND i.position>$3 AND NOT i.direct AND ${playable} AND ${postVisibleSql('p','a','$1')} AND ${feedbackSql('$1')}
        ORDER BY i.position LIMIT $4`,[viewer,session.id,position,limit+1]);
      const more=rows.length>limit,items=rows.slice(0,limit);
      if(items.length) await sqlRows(m,`UPDATE reel_recommendation_impressions SET exposed_at=coalesce(exposed_at,now()) WHERE session_id=$1 AND post_id=ANY($2::uuid[])`,[session.id,items.map(r=>r.post_id)]);
      return {ids:items.map(r=>r.post_id),sessionId:session.id,nextCursor:more?this.cursor(session.id,items[items.length-1].position):null,hasMore:more};
    });
    // Hydrate also checks visibility, protecting against a block/delete during this transaction.
    return {items:await this.posts.hydrate(result.ids,viewer),sessionId:result.sessionId,nextCursor:result.nextCursor,hasMore:result.hasMore};
  }

  private async allocate(m:EntityManager,s:Session,viewer:string|null) {
    const eligible=`${playable} AND p.created_at<=$3 AND ${postVisibleSql('p','a','$1')} AND ${feedbackSql('$1')}
      AND NOT EXISTS(SELECT 1 FROM reel_recommendation_impressions si WHERE si.session_id=$2 AND si.post_id=p.id)
      AND NOT EXISTS(SELECT 1 FROM reel_watch_history wh WHERE wh.user_id=$1::uuid AND wh.post_id=p.id
        AND wh.meaningful_at IS NOT NULL AND ($4::boolean=false OR wh.meaningful_at>=$3))`;
    const rows=await sqlRows<Candidate>(m,`WITH recent AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible} ORDER BY p.created_at DESC,p.id DESC LIMIT 160
      ), older AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible} ORDER BY p.created_at,p.id LIMIT 80
      ), alternative AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible}
          AND p.author_id IS DISTINCT FROM (SELECT author_id FROM recent LIMIT 1) ORDER BY p.created_at DESC,p.id DESC LIMIT 80
      ), candidates AS (SELECT id FROM recent UNION SELECT id FROM older UNION SELECT id FROM alternative),
      signals AS (
        SELECT p.author_id,sum(x.weight) AS positive FROM (
          (SELECT post_id,1.0 AS weight FROM post_likes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500)
          UNION ALL (SELECT post_id,2.0 FROM bookmarks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500)
          UNION ALL (SELECT referenced_post_id,2.0 FROM posts WHERE author_id=$1 AND kind IN ('REPOST','QUOTE') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500)
          UNION ALL (SELECT post_id,least(3,completion_count)::numeric FROM reel_watch_history WHERE user_id=$1 ORDER BY last_interaction_at DESC LIMIT 500)
        ) x JOIN posts p ON p.id=x.post_id GROUP BY p.author_id
      ), negative AS (
        SELECT p.author_id,sum(x.weight) AS n FROM (
          (SELECT post_id,2 AS weight FROM reel_feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100)
          UNION ALL (SELECT post_id,least(2,skip_count) FROM reel_watch_history WHERE user_id=$1 AND meaningful_at IS NULL AND skip_count>0 ORDER BY last_interaction_at DESC LIMIT 500)
          UNION ALL (SELECT target_id,3 FROM reports WHERE reporter_id=$1 AND target_type='POST' ORDER BY created_at DESC LIMIT 100)
        ) x JOIN posts p ON p.id=x.post_id GROUP BY p.author_id
      )
      SELECT p.id,p.author_id,
        (0.22/(1+greatest(0,extract(epoch FROM ($3::timestamptz-p.created_at))/259200.0))
        + 0.18*(1-exp(-(p.like_count+2*p.comment_count+3*p.bookmark_count+p.repost_count+p.quote_count)/20.0))
        + 0.20*coalesce(quality.completion,0.3)
        + 0.25*greatest(0,least(1,(CASE WHEN EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.author_id) THEN 0.6 ELSE 0 END)
          +least(0.4,coalesce(sig.positive,0)/15.0)-least(0.8,coalesce(neg.n,0)/8.0)))
        + 0.15/(1+(SELECT count(*) FROM reel_recommendation_impressions di JOIN posts dp ON dp.id=di.post_id WHERE di.session_id=$2 AND dp.author_id=p.author_id))
        )::double precision AS score
      FROM candidates c JOIN posts p ON p.id=c.id
      LEFT JOIN signals sig ON sig.author_id=p.author_id LEFT JOIN negative neg ON neg.author_id=p.author_id
      LEFT JOIN LATERAL (SELECT (count(*) FILTER(WHERE h.completion_count>0)+3.0)/(count(*)+10.0) AS completion
        FROM (SELECT completion_count FROM reel_watch_history WHERE post_id=p.id AND meaningful_at IS NOT NULL ORDER BY last_viewed_at DESC LIMIT 100) h) quality ON true
      ORDER BY score DESC,p.created_at DESC,p.id DESC LIMIT 320`,[viewer,s.id,s.created_at,s.allow_rewatch]);
    const window=diversify(rows,s.last_creator,s.creator_streak);
    if(!window.items.length) return;
    // Constant-sized INSERT, no separate write per candidate.
    await sqlRows(m,`INSERT INTO reel_recommendation_impressions(session_id,post_id,position,score)
      SELECT $1,id,$2+ord::int,score FROM unnest($3::uuid[],$4::double precision[]) WITH ORDINALITY AS x(id,score,ord)`,
      [s.id,s.next_position,window.items.map(r=>r.id),window.items.map(r=>r.score)]);
    await sqlRows(m,`UPDATE reel_recommendation_sessions SET next_position=next_position+$2,last_creator=$3,creator_streak=$4 WHERE id=$1`,[s.id,window.items.length,window.creator,window.streak]);
  }

  async expose(viewer:string|null,body:ReelExposeDto) {
    await this.settings.assertFeature('reels');
    return this.db.transaction(async m=>{
      const s=await this.session(m,body.sessionId,viewer);
      const post=await sqlOne(m,`SELECT p.id FROM posts p JOIN users a ON a.id=p.author_id WHERE p.id=$2 AND ${playable} AND ${postVisibleSql('p','a','$1')}`,[viewer,body.postId]);
      if(!post) throw AppException.notFound(ErrorCode.POST_NOT_FOUND,'Reel unavailable');
      const found=await sqlOne(m,`SELECT last_sequence FROM reel_recommendation_impressions WHERE session_id=$1 AND post_id=$2`,[s.id,body.postId]);
      if(!found) {
        await sqlRows(m,`INSERT INTO reel_recommendation_impressions(session_id,post_id,position,direct,exposed_at) VALUES($1,$2,$3,true,now())`,[s.id,body.postId,s.next_position+1]);
        await sqlRows(m,`UPDATE reel_recommendation_sessions SET next_position=next_position+1 WHERE id=$1`,[s.id]);
      } else await sqlRows(m,`UPDATE reel_recommendation_impressions SET exposed_at=coalesce(exposed_at,now()) WHERE session_id=$1 AND post_id=$2`,[s.id,body.postId]);
      return {nextSequence:(Number(found?.last_sequence) || 0)+1};
    });
  }

  async feedback(viewer:string,body:ReelFeedbackDto):Promise<void> {
    await this.posts.getVisible(body.postId,viewer);
    if(body.notInterested) await sqlRows(this.db,`INSERT INTO reel_feedback(user_id,post_id) VALUES($1,$2) ON CONFLICT(user_id,post_id) DO UPDATE SET created_at=now()`,[viewer,body.postId]);
    else await sqlRows(this.db,'DELETE FROM reel_feedback WHERE user_id=$1 AND post_id=$2',[viewer,body.postId]);
  }

  async watch(viewer:string|null,body:ReelWatchBatchDto):Promise<void> {
    await this.settings.assertFeature('reels');
    await this.db.transaction(async m=>{
      const s=await this.session(m,body.sessionId,viewer);
      const rows=await sqlRows(m,`SELECT i.*, mv.videos FROM reel_recommendation_impressions i
        JOIN posts p ON p.id=i.post_id JOIN users a ON a.id=p.author_id
        JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',v.id,'duration',v.duration_ms) ORDER BY pm.position) AS videos FROM post_media pm JOIN media v ON v.id=pm.media_id WHERE pm.post_id=p.id AND v.type='VIDEO' AND v.status='READY') mv ON mv.videos IS NOT NULL
        WHERE i.session_id=$2 AND i.post_id=ANY($3::uuid[]) AND i.exposed_at IS NOT NULL AND ${postVisibleSql('p','a','$1')}`,[viewer,s.id,body.events.map(e=>e.postId)]);
      const impressions=new Map(rows.map(row=>[row.post_id,row]));
      for(const event of body.events) {
        const i=impressions.get(event.postId);
        if(!i) throw AppException.notFound(ErrorCode.POST_NOT_FOUND,'Reel was not exposed to this session or is no longer available');
        if(event.sequence<=i.last_sequence) continue;
        const video=event.mediaId?i.videos.find((v:{id:string})=>v.id===event.mediaId):i.videos[0];
        if(!video) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Video attachment does not belong to this playable post');
        const duration=Number(video.duration||(event.type==='VIDEO_START'?event.durationMs:i.duration_ms)||event.durationMs);
        if(Math.abs(duration-event.durationMs)>Math.max(1000,duration*.1) || event.positionMs>duration+1000)
          throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Invalid playback duration or position');
        const now=new Date(), isStart=event.type==='VIDEO_START';
        if(!isStart && !i.started_at) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'VIDEO_START is required before watch milestones');
        const elapsed=i.last_event_at?Math.max(0,now.getTime()-new Date(i.last_event_at).getTime()):0;
        // Time claims can never exceed actual time since the accepted preceding event.
        const credited=isStart?0:Math.min(event.watchedMs,15000,Math.floor(elapsed*1.1+250));
        const watched=Number(i.watched_ms)+credited,loopWatched=Number(i.loop_watched_ms)+credited;
        const meaningful=watched>=Math.max(250,Math.min(2000,duration*.5));
        const complete=event.type==='VIDEO_COMPLETE' && !i.completed && loopWatched>=duration*.85 && event.positionMs>=duration*.85;
        const replay=event.type==='VIDEO_REPLAY' && i.completed && event.positionMs<=Math.max(2000,duration*.1);
        const skip=event.type==='VIDEO_SKIP';
        if(viewer) await sqlRows(m,`INSERT INTO reel_watch_history(user_id,post_id,watched_ms,duration_ms,meaningful_at,completion_count,replay_count,skip_count)
          VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,$6,$7,$8)
          ON CONFLICT(user_id,post_id) DO UPDATE SET last_viewed_at=now(),last_interaction_at=now(),
            watched_ms=reel_watch_history.watched_ms+EXCLUDED.watched_ms,duration_ms=EXCLUDED.duration_ms,
            meaningful_at=CASE WHEN $5 THEN now() ELSE reel_watch_history.meaningful_at END,
            completion_count=reel_watch_history.completion_count+$6,replay_count=reel_watch_history.replay_count+$7,skip_count=reel_watch_history.skip_count+$8`,
          [viewer,event.postId,credited,duration,meaningful,complete?1:0,replay?1:0,skip?1:0]);
        await sqlRows(m,`UPDATE reel_recommendation_impressions SET last_sequence=$3,watched_ms=$4,duration_ms=$5,last_position_ms=$6,
          meaningful_at=CASE WHEN $7 THEN now() ELSE meaningful_at END,completed=$8,skipped=skipped OR $9,
          loop_watched_ms=$10,started_at=coalesce(started_at,now()),last_event_at=now() WHERE session_id=$1 AND post_id=$2`,
          [s.id,event.postId,event.sequence,watched,duration,event.positionMs,meaningful,replay?false:(i.completed||complete),skip,replay?0:loopWatched]);
        Object.assign(i,{last_sequence:event.sequence,watched_ms:watched,duration_ms:duration,completed:replay?false:(i.completed||complete),loop_watched_ms:replay?0:loopWatched,started_at:i.started_at??now,last_event_at:now});
      }
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup():Promise<void> {
    // Temporary impressions expire. Persistent watch aggregates/explicit feedback are NOT purged.
    await sqlRows(this.db,`DELETE FROM reel_recommendation_sessions WHERE expires_at<now()`);
  }
}
