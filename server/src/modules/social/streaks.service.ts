import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne } from '../../common/utils/sql.js';
import { MessagesService } from './messages.service.js';
import { StreakDto } from './calls.dto.js';

export interface StreakRow { days:number; last_day:string|null; low_day:string|null; high_day:string|null; month:string|null; restores_used:number }
const DAY=86400000;
export function describeStreak(row: StreakRow|null, viewerIsLow:boolean, now=new Date()): StreakDto {
  const today=now.toISOString().slice(0,10), month=today.slice(0,7)+'-01';
  const last=row?.last_day?Date.parse(row.last_day+'T00:00:00Z'):NaN;
  const expires=last+3*DAY, expired=Number.isFinite(last)&&now.getTime()>=expires;
  const remaining=3-(row?.month===month?row.restores_used:0);
  return { days:row?.days??0,state:expired?'expired':(row?.days??0)<3?'building':now.getTime()>=last+2*DAY?'fading':'active',
    sentToday:(viewerIsLow?row?.low_day:row?.high_day)===today,peerSentToday:(viewerIsLow?row?.high_day:row?.low_day)===today,
    canRestore:expired&&(row?.days??0)>=3&&now.getTime()<expires+2*DAY&&remaining>0,
    restoresRemaining:remaining,expiresAt:Number.isFinite(last)?new Date(expires).toISOString():null };
}
@Injectable()
export class StreaksService {
  constructor(@InjectDataSource() private readonly db:DataSource,private readonly messages:MessagesService) {}
  async get(viewer:string,peer:string):Promise<StreakDto> {
    await this.messages.assertConversationPeer(viewer,peer);
    const row=await sqlOne<StreakRow>(this.db,`SELECT days,last_completed_day::text last_day,low_sent_day::text low_day,
      high_sent_day::text high_day,restore_month::text AS "month",restores_used FROM message_streaks WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)`,[viewer,peer]);
    return describeStreak(row,viewer<peer);
  }
  async restore(viewer:string,peer:string) {
    await this.messages.assertCallPeer(viewer,peer);
    const result=await this.db.query(`UPDATE message_streaks SET last_completed_day=(now() AT TIME ZONE 'UTC')::date-1,
      restores_used=CASE WHEN restore_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date THEN restores_used+1 ELSE 1 END,
      restore_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
      WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid) AND days>=3
        AND now()>=(last_completed_day+3)::timestamp AT TIME ZONE 'UTC'
        AND now()<(last_completed_day+5)::timestamp AT TIME ZONE 'UTC'
        AND (restore_month IS DISTINCT FROM date_trunc('month',now() AT TIME ZONE 'UTC')::date OR restores_used<3)
      RETURNING low_id`,[viewer,peer]);
    // pg UPDATE query returns [rows,count] through TypeORM.
    const rows=Array.isArray(result[0])?result[0]:result;
    if(!rows.length) throw AppException.conflict(ErrorCode.INVALID_STATE,'This streak cannot be restored');
    return this.get(viewer,peer);
  }
}
