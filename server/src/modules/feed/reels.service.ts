import { reelsPolicy,meaningfulThreshold,completionRatio } from './reels-policy.js';
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

type Session={id:string;user_id:string|null;created_at:Date;expires_at:Date;allow_rewatch:boolean;next_position:number;last_creator:string|null;creator_streak:number;cycle:number;seed:number};
type Candidate={id:string;author_id:string;score:number;tier?:number;last_seen?:Date|null};
const playable = `p.kind<>'REPOST' AND EXISTS(SELECT 1 FROM post_media pm JOIN media mv ON mv.id=pm.media_id WHERE pm.post_id=p.id AND mv.type='VIDEO' AND mv.status='READY')`;
const feedbackSql=(v:string)=>`NOT EXISTS(SELECT 1 FROM reel_feedback rf WHERE rf.user_id=${v}::uuid AND rf.post_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM reports rp WHERE rp.reporter_id=${v}::uuid AND rp.target_type='POST' AND rp.target_id=p.id)`;
const invalid=()=>AppException.badRequest(ErrorCode.INVALID_CURSOR,'Recommendation session expired or cursor invalid; refresh for new content');

/** Allocation rounds per page request: enough to fill a page from a tiny library, bounded for safety. */
const MAX_ALLOCATIONS=8;

/** Bounded diversity pass over an SQL-ranked window, never the full media library. */
export function diversify<T extends Candidate>(rows:T[],creator:string|null=null,streak=0,limit=80) {
  const pool=[...rows],items:T[]=[];
  while(pool.length && items.length<limit) {
    const alternative=streak>=2?pool.findIndex(r=>r.author_id!==creator&&(r.tier??0)===(pool[0].tier??0)):-1;
    const [row]=pool.splice(alternative>=0?alternative:0,1);
    streak=row.author_id===creator?streak+1:1;creator=row.author_id;items.push(row);
  }
  return {items,creator,streak:Math.min(streak,32767)};
}

/**
 * Opening a new cycle: the Reels shown last go to the back of the window so the cycle never starts
 * with them (and never repeats the very last one back-to-back). Recomputes the creator streak.
 */
export function avoidRecent<T extends Candidate>(items:T[],recent:string[],creator:string|null,streak:number) {
  const set=new Set(recent);
  const ordered=[...items.filter(r=>!set.has(r.id)),...recent.map(id=>items.find(r=>r.id===id)).filter((r):r is T=>!!r)];
  for(const row of ordered) {streak=row.author_id===creator?streak+1:1;creator=row.author_id;}
  return {items:ordered,creator,streak:Math.min(streak,32767)};
}

@Injectable()
export class ReelsService {
  private readonly policy=reelsPolicy();
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
    const began=performance.now();
    const result=await this.db.transaction(async m=>{
      const id=cursor?.id??q.session;
      const session=id?await this.session(m,id,viewer):await sqlOne<Session>(m,
        `INSERT INTO reel_recommendation_sessions(user_id,allow_rewatch) VALUES($1,$2) RETURNING *`,[viewer,q.rewatch===true]);
      if(!session) throw invalid();
      const position=cursor?.position??0;
      if(position>session.next_position) throw invalid();
      const visible=`i.session_id=$2 AND i.position>$3 AND NOT i.direct AND ${playable} AND ${postVisibleSql('p','a','$1')} AND ${feedbackSql('$1')}`;
      // Allocate until the page (plus one look-ahead) is filled or nothing eligible remains. Each round
      // either appends entries or reports exhaustion, so this never spins.
      let open=true;
      for(let round=0;round<MAX_ALLOCATIONS;round++) {
        const ahead=await sqlOne<{n:number}>(m,`SELECT count(*)::int n FROM (SELECT 1 FROM reel_recommendation_impressions i JOIN posts p ON p.id=i.post_id JOIN users a ON a.id=p.author_id WHERE ${visible} LIMIT $4) bounded`,[viewer,session.id,position,limit+1]);
        if((ahead?.n??0)>=limit+1) break;
        if(!(await this.allocate(m,session,viewer))) {open=false;break;}
      }
      const rows=await sqlRows<{post_id:string;position:number;cycle:number}>(m,`SELECT i.post_id,i.position,i.cycle FROM reel_recommendation_impressions i
        JOIN posts p ON p.id=i.post_id JOIN users a ON a.id=p.author_id
        WHERE ${visible} ORDER BY i.position LIMIT $4`,[viewer,session.id,position,limit+1]);
      const items=rows.slice(0,limit);
      // More exists when a look-ahead row is ready, or the session can still open further cycles.
      const more=items.length>0 && (rows.length>limit || open);
      if(items.length) await sqlRows(m,`UPDATE reel_recommendation_impressions SET delivered_at=coalesce(delivered_at,now()) WHERE session_id=$1 AND position=ANY($2::int[])`,[session.id,items.map(r=>r.position)]);
      return {rows:items,sessionId:session.id,nextCursor:more?this.cursor(session.id,items[items.length-1].position):null,hasMore:more,cycle:session.cycle,sessionEnded:session.next_position>=this.policy.maxEntries};
    });
    // Hydrate also checks visibility, protecting against a block/delete during this transaction.
    // The same Reel can occur twice in a page (a tiny library spanning cycles); hydrate keeps duplicates.
    const posts=await this.posts.hydrate(result.rows.map(r=>r.post_id),viewer);
    const available=new Set(posts.map(p=>p.id));
    const entries=result.rows.filter(r=>available.has(r.post_id)).map(r=>({key:`${result.sessionId}:${r.cycle}:${r.position}:${r.post_id}`,postId:r.post_id,cycle:r.cycle,position:r.position}));
    if(this.policy.diagnostics)console.debug('[reels]',{cycle:result.cycle,returned:entries.length,duplicates:entries.length-new Set(entries.map(e=>e.key)).size,cursorAdvanced:!!result.nextCursor,queryMs:Math.round(performance.now()-began)});
    return {items:posts,entries,sessionId:result.sessionId,nextCursor:result.nextCursor,hasMore:result.hasMore&&entries.length>0,cycle:result.cycle,sessionEnded:result.sessionEnded};
  }

  /**
   * Appends the next ranked window to the session. Returns false only when nothing more can be served:
   * no eligible Reel at all, or just the single Reel already shown (the player loops it natively).
   * Cycle 1 = Reels not yet meaningfully watched; when a cycle runs dry the next one starts and every
   * eligible Reel is available again (at most once per cycle), in a new relevance-weighted shuffle.
   */
  private async allocate(m:EntityManager,s:Session,viewer:string|null):Promise<boolean> {
    if(s.next_position>=this.policy.maxEntries)return false;
    let rows=await this.rank(m,s,viewer,s.cycle);
    let recent:string[]=[];
    if(!rows.length) {
      const next=s.cycle+1;
      rows=await this.rank(m,s,viewer,next);
      // What the viewer saw last, ignoring entries that have since become unavailable (blocked, removed…).
      const candidates=new Set(rows.map(r=>r.id));
      const shown=(await sqlRows<{post_id:string}>(m,`SELECT post_id FROM reel_recommendation_impressions WHERE session_id=$1 ORDER BY position DESC LIMIT 20`,[s.id]))
        .map(r=>r.post_id).filter(id=>candidates.has(id));
      if(!rows.some(r=>r.id!==shown[0])) return false;
      s.cycle=next;
      // Hold back the most recently shown Reels (fewer when the library is tiny, so it never deadlocks).
      recent=[...new Set(shown)].slice(0,Math.min(3,rows.length-1));
    }
    let window=diversify(rows,s.last_creator,s.creator_streak,Math.min(80,this.policy.maxEntries-s.next_position));
    if(recent.length) window=avoidRecent(window.items,recent,s.last_creator,s.creator_streak);
    if(!window.items.length) return false;
    // Constant-sized INSERT, no separate write per candidate.
    await sqlRows(m,`INSERT INTO reel_recommendation_impressions(session_id,post_id,position,score,cycle)
      SELECT $1,id,$2+ord::int,score,$5 FROM unnest($3::uuid[],$4::double precision[]) WITH ORDINALITY AS x(id,score,ord)`,
      [s.id,s.next_position,window.items.map(r=>r.id),window.items.map(r=>r.score),s.cycle]);
    await sqlRows(m,`UPDATE reel_recommendation_sessions SET next_position=next_position+$2,last_creator=$3,creator_streak=$4,cycle=$5 WHERE id=$1`,
      [s.id,window.items.length,window.creator,window.streak,s.cycle]);
    Object.assign(s,{next_position:s.next_position+window.items.length,last_creator:window.creator,creator_streak:window.streak});
    return true;
  }

  /**
   * Ranks at most 320 candidates for a cycle from bounded windows (newest, oldest, other creators and a
   * pseudo-random slice of the id index); no ORDER BY random() over the library. The shuffle term is
   * stable per session+cycle (so retries return the same order) and stronger after cycle 1.
   */
  private async rank(m:EntityManager,s:Session,viewer:string|null,cycle:number) {
    // Cycle 1 skips Reels already meaningfully watched (only those watched this session when rewatching).
    const eligible=`${playable} AND ${postVisibleSql('p','a','$1')} AND ${feedbackSql('$1')}
      AND NOT EXISTS(SELECT 1 FROM reel_recommendation_impressions si WHERE si.session_id=$2 AND si.cycle=$3 AND si.post_id=p.id)
      AND ($4::boolean=false OR (
        NOT EXISTS(SELECT 1 FROM reel_watch_history wh WHERE wh.user_id=$1::uuid AND wh.post_id=p.id AND wh.meaningful_at IS NOT NULL AND wh.meaningful_at>=$5::timestamptz)
        AND NOT EXISTS(SELECT 1 FROM post_likes lk WHERE lk.user_id=$1 AND lk.post_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM bookmarks bk WHERE bk.user_id=$1 AND bk.post_id=p.id)))`;
    const pivot=createHmac('md5',String(s.seed)).update(`${cycle}:${s.next_position}`).digest('hex');
    const w=this.policy.weights;
    const params=[viewer,s.id,cycle,cycle===1,s.allow_rewatch?s.created_at:new Date(0),
      `${pivot.slice(0,8)}-${pivot.slice(8,12)}-${pivot.slice(12,16)}-${pivot.slice(16,20)}-${pivot.slice(20,32)}`,s.seed,
      this.policy.exposureSeconds,this.policy.watchSeconds,this.policy.engagementSeconds,
      w.recency,w.engagement,w.quality,w.creator,w.content,w.exploration];
    const began=performance.now();
    const rows=await sqlRows<Candidate>(m,`WITH recent AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible} ORDER BY p.created_at DESC,p.id DESC LIMIT 160
      ), older AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible} ORDER BY p.created_at,p.id LIMIT 80
      ), pivot AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible} AND p.id>=$6::uuid ORDER BY p.id LIMIT 80
      ), wrap AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible} ORDER BY p.id LIMIT greatest(0,80-(SELECT count(*) FROM pivot))
      ), alternative AS (
        SELECT p.id,p.author_id FROM posts p JOIN users a ON a.id=p.author_id WHERE ${eligible}
          AND p.author_id IS DISTINCT FROM (SELECT author_id FROM recent LIMIT 1) ORDER BY p.created_at DESC,p.id DESC LIMIT 80
      ) , rediscovery AS (
        SELECT p.id FROM reel_watch_history rh JOIN posts p ON p.id=rh.post_id JOIN users a ON a.id=p.author_id
        WHERE rh.user_id=$1 AND rh.last_exposed_at IS NOT NULL AND $3>1 AND ${eligible}
        ORDER BY rh.last_exposed_at ASC LIMIT 80
      ), candidates AS (SELECT id FROM recent UNION SELECT id FROM older UNION SELECT id FROM pivot UNION SELECT id FROM wrap UNION SELECT id FROM alternative UNION SELECT id FROM rediscovery),
      interactions AS (
          (SELECT post_id,1.0 AS weight FROM post_likes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500)
          UNION ALL (SELECT post_id,2.0 FROM bookmarks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500)
          UNION ALL (SELECT referenced_post_id,2.0 FROM posts WHERE author_id=$1 AND kind IN ('REPOST','QUOTE') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500)
          UNION ALL (SELECT post_id,least(3,coalesce(watched_ms/nullif(duration_ms,0)::numeric,0))+least(3,completion_count) FROM reel_watch_history WHERE user_id=$1 AND meaningful_at IS NOT NULL ORDER BY last_interaction_at DESC LIMIT 500)
      ), signals AS (
        SELECT p.author_id,sum(x.weight) AS positive FROM interactions x JOIN posts p ON p.id=x.post_id GROUP BY p.author_id
      ), tags AS (
        SELECT lower(t.tag[1]) tag,sum(x.weight) weight FROM interactions x JOIN posts ip ON ip.id=x.post_id
        CROSS JOIN LATERAL regexp_matches(left(ip.content,1000),'#([[:alnum:]_]{2,40})','g') t(tag)
        GROUP BY lower(t.tag[1]) ORDER BY sum(x.weight) DESC LIMIT 50
      ), negative AS (
        SELECT p.author_id,sum(x.weight) AS n FROM (
          (SELECT post_id,2 AS weight FROM reel_feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100)
          UNION ALL (SELECT post_id,least(2,skip_count) FROM reel_watch_history WHERE user_id=$1 AND meaningful_at IS NULL AND skip_count>0 ORDER BY last_interaction_at DESC LIMIT 500)
          UNION ALL (SELECT target_id,3 FROM reports WHERE reporter_id=$1 AND target_type='POST' ORDER BY created_at DESC LIMIT 100)
        ) x JOIN posts p ON p.id=x.post_id GROUP BY p.author_id
      ), features AS (
        SELECT p.id,p.author_id,p.created_at,
        greatest(h.last_exposed_at,h.last_started_at,h.meaningful_at,seen.exposed_at,lk.created_at,bk.created_at) AS last_seen,
        h.meaningful_at IS NOT NULL OR seen.meaningful_at IS NOT NULL AS consumed,
        lk.created_at IS NOT NULL OR bk.created_at IS NOT NULL AS engaged,
        greatest(h.meaningful_at,seen.meaningful_at) AS meaningful_at,
        greatest(lk.created_at,bk.created_at) AS engagement_at,
        ($11::double precision/(1+greatest(0,extract(epoch FROM (now()-p.created_at))/259200.0))
        + $12::double precision*(1-exp(-(p.like_count+2*p.comment_count+3*p.bookmark_count+p.repost_count+p.quote_count)/20.0))
        + $13::double precision*coalesce(quality.completion,0.3)
        + $14::double precision*greatest(0,least(1,(CASE WHEN EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.author_id) THEN 0.6 ELSE 0 END)
          +least(0.4,coalesce(sig.positive,0)/15.0)-least(0.8,coalesce(neg.n,0)/8.0)))
        + $15::double precision*coalesce(topic.affinity,0)
        + $16::double precision/(1+(SELECT count(*) FROM reel_recommendation_impressions di JOIN posts dp ON dp.id=di.post_id WHERE di.session_id=$2 AND di.cycle=$3 AND dp.author_id=p.author_id))
        )::double precision AS base_score,
        (('x'||lpad(substr(md5($7::text||':'||$3::text||':'||p.id::text),1,8),16,'0'))::bit(64)::bigint/4294967295.0) jitter
      FROM candidates c JOIN posts p ON p.id=c.id
      LEFT JOIN reel_watch_history h ON h.user_id=$1 AND h.post_id=p.id
      LEFT JOIN post_likes lk ON lk.user_id=$1 AND lk.post_id=p.id
      LEFT JOIN bookmarks bk ON bk.user_id=$1 AND bk.post_id=p.id
      LEFT JOIN LATERAL(SELECT max(exposed_at) exposed_at,max(meaningful_at) meaningful_at FROM reel_recommendation_impressions WHERE session_id=$2 AND post_id=p.id AND exposed_at IS NOT NULL) seen ON true
      LEFT JOIN signals sig ON sig.author_id=p.author_id LEFT JOIN negative neg ON neg.author_id=p.author_id
      LEFT JOIN LATERAL(SELECT least(1,coalesce(sum(t.weight),0)/10.0)::double precision affinity FROM tags t WHERE EXISTS(SELECT 1 FROM regexp_matches(left(p.content,1000),'#([[:alnum:]_]{2,40})','g') ct(tag) WHERE lower(ct.tag[1])=t.tag)) topic ON true
      LEFT JOIN LATERAL (SELECT (count(*) FILTER(WHERE h.completion_count>0)+3.0)/(count(*)+10.0) AS completion
        FROM (SELECT completion_count FROM reel_watch_history WHERE post_id=p.id AND meaningful_at IS NOT NULL ORDER BY last_viewed_at DESC LIMIT 100) h) quality ON true
      ), tiered AS (
        SELECT *,CASE
          WHEN last_seen IS NULL AND NOT consumed AND NOT engaged THEN 0
          WHEN NOT consumed AND NOT engaged AND last_seen<now()-$8*interval '1 second' THEN 1
          WHEN consumed AND NOT engaged AND meaningful_at<now()-$9*interval '1 second' AND last_seen<now()-$8*interval '1 second' THEN 2
          WHEN engaged AND greatest(engagement_at,meaningful_at)<now()-$10*interval '1 second' AND last_seen<now()-$8*interval '1 second' THEN 3
          WHEN NOT consumed AND NOT engaged THEN 4 WHEN NOT engaged THEN 5 ELSE 6 END tier
        FROM features
      ) SELECT id,author_id,tier,last_seen,
        greatest(0,least(1,base_score*(CASE WHEN tier>=2 THEN .25+.75*least(1,greatest(0,extract(epoch FROM(now()-last_seen)))/greatest(1,$9)) ELSE 1 END))) score
      FROM tiered
      ORDER BY tier,CASE WHEN tier>=2 THEN last_seen END ASC NULLS FIRST,
        floor(base_score*100) DESC,jitter DESC,id DESC LIMIT 320`,params);
    if(this.policy.diagnostics)console.debug('[reels rank]',{cycle,candidates:rows.length,unseen:rows.filter(r=>r.tier===0).length,rediscovery:rows.filter(r=>(r.tier??0)>=2).length,queryMs:Math.round(performance.now()-began)});
    return rows;
  }

  async expose(viewer:string|null,body:ReelExposeDto) {
    await this.settings.assertFeature('reels');
    return this.db.transaction(async m=>{
      const s=await this.session(m,body.sessionId,viewer);
      const post=await sqlOne(m,`SELECT p.id FROM posts p JOIN users a ON a.id=p.author_id WHERE p.id=$2 AND ${playable} AND ${postVisibleSql('p','a','$1')} AND ${feedbackSql('$1')}`,[viewer,body.postId]);
      if(!post) throw AppException.notFound(ErrorCode.POST_NOT_FOUND,'Reel unavailable');
      let entry=await sqlOne<{position:number;cycle:number;last_sequence:number;exposed_at:Date|null;delivered_at:Date|null}>(m,
        `SELECT position,cycle,last_sequence,exposed_at,delivered_at FROM reel_recommendation_impressions WHERE session_id=$1 AND post_id=$2 AND ($3::int IS NULL OR position=$3) ORDER BY delivered_at DESC NULLS LAST,position DESC LIMIT 1`,[s.id,body.postId,body.position??null]);
      if(!entry&&body.position)throw AppException.notFound(ErrorCode.POST_NOT_FOUND,'Recommendation entry unavailable');
      if(!entry) {
        entry=await sqlOne(m,`INSERT INTO reel_recommendation_impressions(session_id,post_id,position,direct,cycle,delivered_at) VALUES($1,$2,$3,true,$4,now()) RETURNING position,cycle,last_sequence,exposed_at,delivered_at`,[s.id,body.postId,s.next_position+1,s.cycle]);
        await sqlRows(m,`UPDATE reel_recommendation_sessions SET next_position=next_position+1 WHERE id=$1`,[s.id]);
      }
      if(!entry)throw invalid();
      if(body.position&&body.visibleMs!==undefined&&(!entry.delivered_at||Date.now()-entry.delivered_at.getTime()<700))throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'A delivered entry must be visibly on screen for 750ms');
      await sqlRows(m,`UPDATE reel_recommendation_impressions SET activated_at=coalesce(activated_at,now()),delivered_at=coalesce(delivered_at,now()) WHERE session_id=$1 AND position=$2`,[s.id,entry.position]);
      if(!body.prepare&&!entry.exposed_at) {
        await sqlRows(m,`UPDATE reel_recommendation_impressions SET exposed_at=now() WHERE session_id=$1 AND position=$2`,[s.id,entry.position]);
        if(viewer)await sqlRows(m,`INSERT INTO reel_watch_history(user_id,post_id,first_exposed_at,last_exposed_at,impression_count) VALUES($1,$2,now(),now(),1)
          ON CONFLICT(user_id,post_id) DO UPDATE SET first_exposed_at=coalesce(reel_watch_history.first_exposed_at,now()),last_exposed_at=now(),impression_count=reel_watch_history.impression_count+1`,[viewer,body.postId]);
      }
      return {nextSequence:Number(entry.last_sequence)+1,position:entry.position,cycle:entry.cycle};
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
        WHERE i.session_id=$2 AND i.post_id=ANY($3::uuid[]) AND (i.exposed_at IS NOT NULL OR i.activated_at IS NOT NULL) AND ${postVisibleSql('p','a','$1')}
        ORDER BY i.post_id,i.cycle DESC`,[viewer,s.id,body.events.map(e=>e.postId)]);
      const impressions=new Map(rows.map(row=>[`${row.post_id}:${row.position}`,row]));
      const latest=new Map<string,typeof rows[number]>();for(const row of rows)if(!latest.has(row.post_id))latest.set(row.post_id,row);
      for(const event of body.events) {
        const i=event.position?impressions.get(`${event.postId}:${event.position}`):latest.get(event.postId);
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
        const meaningful=watched>=meaningfulThreshold(duration);
        const complete=event.type==='VIDEO_COMPLETE' && !i.completed && loopWatched>=duration*completionRatio(duration) && event.positionMs>=duration*completionRatio(duration);
        const replay=event.type==='VIDEO_REPLAY' && i.completed && event.positionMs<=Math.max(2000,duration*.1);
        const skip=event.type==='VIDEO_SKIP' && !i.skipped && !meaningful && watched<Math.min(2000,duration*.25);
        if(viewer) await sqlRows(m,`INSERT INTO reel_watch_history(user_id,post_id,watched_ms,duration_ms,meaningful_at,completion_count,replay_count,skip_count,first_started_at,last_started_at)
          VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,$6,$7,$8,CASE WHEN $9 THEN now() ELSE NULL END,CASE WHEN $9 THEN now() ELSE NULL END)
          ON CONFLICT(user_id,post_id) DO UPDATE SET last_viewed_at=now(),last_interaction_at=now(),
            watched_ms=reel_watch_history.watched_ms+EXCLUDED.watched_ms,duration_ms=EXCLUDED.duration_ms,
            first_started_at=coalesce(reel_watch_history.first_started_at,EXCLUDED.first_started_at),last_started_at=coalesce(EXCLUDED.last_started_at,reel_watch_history.last_started_at),
            meaningful_at=CASE WHEN $5 THEN now() ELSE reel_watch_history.meaningful_at END,
            completion_count=reel_watch_history.completion_count+$6,replay_count=reel_watch_history.replay_count+$7,skip_count=reel_watch_history.skip_count+$8`,
          [viewer,event.postId,credited,duration,meaningful,complete?1:0,replay?1:0,skip?1:0,isStart]);
        await sqlRows(m,`UPDATE reel_recommendation_impressions SET last_sequence=$3,watched_ms=$4,duration_ms=$5,last_position_ms=$6,
          meaningful_at=CASE WHEN $7 THEN now() ELSE meaningful_at END,completed=$8,skipped=skipped OR $9,
          loop_watched_ms=$10,started_at=coalesce(started_at,now()),last_event_at=now() WHERE session_id=$1 AND post_id=$2 AND cycle=$11`,
          [s.id,event.postId,event.sequence,watched,duration,event.positionMs,meaningful,replay?false:(i.completed||complete),skip,replay?0:loopWatched,i.cycle]);
        Object.assign(i,{last_sequence:event.sequence,watched_ms:watched,duration_ms:duration,completed:replay?false:(i.completed||complete),loop_watched_ms:replay?0:loopWatched,started_at:i.started_at??now,last_event_at:now,skipped:i.skipped||skip});
      }
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup():Promise<void> {
    // Temporary impressions expire. Persistent watch aggregates/explicit feedback are NOT purged.
    await sqlRows(this.db,`DELETE FROM reel_recommendation_sessions WHERE expires_at<now()`);
  }
}
