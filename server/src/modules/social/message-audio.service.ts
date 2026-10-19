import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { STORAGE_DRIVER, type StorageDriver } from '../media/storage/storage.driver.js';
import { VIDEO_PROCESSOR, type VideoProcessor } from '../media/video.processor.js';
import { MessageAudioDto } from './social.dto.js';

@Injectable()
export class MessageAudioService {
  private readonly logger = new Logger(MessageAudioService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(VIDEO_PROCESSOR) private readonly processor: VideoProcessor,
    private readonly urls: MediaUrlService,
    private readonly deletion: ContentDeletionService,
  ) {}
  async upload(ownerId:string,file:Express.Multer.File|undefined):Promise<MessageAudioDto> {
    if(!file?.path) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR,'Record a voice message first');
    const output=join(tmpdir(),`voice-${randomBytes(12).toString('hex')}.m4a`);
    let key:string|undefined,stored=false;
    try {
      if(file.size>10*1024*1024) throw AppException.badRequest(ErrorCode.INVALID_MEDIA,'Voice messages must be under 10 MB');
      // Live WebM recordings often have no container duration. Decode first, then measure
      // the normalized AAC file; do not trust the browser's duration or MIME header.
      await this.processor.clipAudio(file.path,output,0,120_000).catch(()=>{
        throw AppException.badRequest(ErrorCode.INVALID_MEDIA,'This recording could not be processed');
      });
      const probe=await this.processor.probeAudio(output);
      if(!probe||probe.durationMs<250||probe.durationMs>120100)
        throw AppException.badRequest(ErrorCode.INVALID_MEDIA,'Record between one second and two minutes');
      key=`${randomBytes(16).toString('hex')}.m4a`;
      await this.storage.put(key,{filePath:output},'audio/mp4');stored=true;
      const row=await sqlOne<{id:string}>(this.db,`INSERT INTO message_audio_uploads(owner_id,storage_key,duration_ms) VALUES($1,$2,$3) RETURNING id`,[ownerId,key,probe.durationMs]);
      return {id:row!.id,url:this.urls.url(key)!,durationMs:probe.durationMs};
    } catch(error) {
      if(key&&stored)await this.deletion.removeFiles({keys:[key],bytes:0}).catch(()=>{});
      throw error;
    } finally {
      await rm(file.path,{force:true}).catch(()=>{});
      await rm(output,{force:true}).catch(()=>{});
    }
  }
  async remove(ownerId:string,id:string) {
    const row=await sqlOne<{storage_key:string}>(this.db,'DELETE FROM message_audio_uploads WHERE id=$1 AND owner_id=$2 RETURNING storage_key',[id,ownerId]);
    if(!row)throw AppException.notFound();
    await this.deletion.removeFiles({keys:[row.storage_key],bytes:0});
  }
  @Cron(CronExpression.EVERY_30_MINUTES,{name:'voice-upload-cleanup'})
  async cleanup() {
    try {
      const rows=await sqlRows<{storage_key:string}>(this.db,"DELETE FROM message_audio_uploads WHERE created_at<now()-interval '6 hours' RETURNING storage_key");
      await this.deletion.removeFiles({keys:rows.map(r=>r.storage_key),bytes:0});
    }catch(error){this.logger.warn({message:'Voice draft cleanup failed',error:(error as Error).message});}
  }
}
