import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { CursorQueryDto } from '../../common/dto/common.dto.js';
import { PostDto } from '../posts/dto/post.dto.js';

export class ReelsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({format:'uuid',description:'Existing session for idempotent page refresh. Cursors already identify the session.'})
  @IsOptional() @IsUUID() session?:string;
  @ApiPropertyOptional({type:Boolean,default:false,description:'Start the first cycle with already watched Reels too (history is kept). Not needed for continuous scrolling: later cycles begin automatically.'})
  @IsOptional() @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsBoolean() rewatch?:boolean;
}
export class ReelEntryDto {
  @ApiProperty({description:'Unique queue identity of this recommendation (`cycle:postId`). The same Reel may return in a later discovery cycle.',example:'2:9b2f3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'}) key:string;
  @ApiProperty({format:'uuid'}) postId:string;
  @ApiProperty({minimum:1,description:'Discovery cycle: 1 = unwatched Reels, 2+ = the eligible library again in a new order'}) cycle:number;
}
export class ReelsPageDto {
  @ApiProperty({type:[PostDto]}) items:PostDto[];
  @ApiProperty({type:[ReelEntryDto],description:'One entry per item, in the same order.'}) entries:ReelEntryDto[];
  @ApiProperty({type:String,nullable:true}) nextCursor:string|null;
  @ApiProperty() hasMore:boolean;
  @ApiProperty({format:'uuid'}) sessionId:string;
}
export const REEL_EVENTS=['VIDEO_START','WATCH_MILESTONE','VIDEO_COMPLETE','VIDEO_REPLAY','VIDEO_SKIP'] as const;
export class ReelWatchEventDto {
  @ApiProperty({format:'uuid'}) @IsUUID() postId:string;
  @ApiPropertyOptional({format:'uuid',description:'Exact video attachment, including legacy multi-video posts. Must belong to this post.'}) @IsOptional() @IsUUID() mediaId?:string;
  @ApiProperty({minimum:1,maximum:1000000,description:'Monotonic sequence per post/session; retry duplicates are ignored.'}) @IsInt() @Min(1) @Max(1000000) sequence:number;
  @ApiProperty({enum:REEL_EVENTS}) @IsIn(REEL_EVENTS) type:typeof REEL_EVENTS[number];
  @ApiProperty({minimum:0,maximum:15000,description:'Played wall-clock milliseconds since previous event, bounded again by server elapsed time.'}) @IsInt() @Min(0) @Max(15000) watchedMs:number;
  @ApiProperty({minimum:0,maximum:86400000}) @IsInt() @Min(0) @Max(86400000) positionMs:number;
  @ApiProperty({minimum:1,maximum:86400000}) @IsInt() @Min(1) @Max(86400000) durationMs:number;
}
export class ReelWatchBatchDto {
  @ApiProperty({format:'uuid'}) @IsUUID() sessionId:string;
  @ApiProperty({type:[ReelWatchEventDto],maxItems:20,minItems:1})
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>ReelWatchEventDto) events:ReelWatchEventDto[];
}
export class ReelExposeDto {
  @ApiProperty({format:'uuid'}) @IsUUID() sessionId:string;
  @ApiProperty({format:'uuid',description:'Exact playable post from a direct link; does not reset recommendation history.'}) @IsUUID() postId:string;
}
export class ReelExposureDto {
  @ApiProperty() nextSequence:number;
}
export class ReelFeedbackDto {
  @ApiProperty({format:'uuid'}) @IsUUID() postId:string;
  @ApiProperty({description:'true hides this recommendation; false removes this explicit feedback.'}) @IsBoolean() notInterested:boolean;
}
