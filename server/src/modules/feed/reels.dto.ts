import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { CursorQueryDto } from '../../common/dto/common.dto.js';
import { PostDto } from '../posts/dto/post.dto.js';

export class ReelsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({format:'uuid',description:'Existing session for idempotent page refresh. Cursors already identify the session.'})
  @IsOptional() @IsUUID() session?:string;
  @ApiPropertyOptional({type:Boolean,default:false,description:'Explicit Watch again: new cycle, retaining previous watch history.'})
  @IsOptional() @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsBoolean() rewatch?:boolean;
}
export class ReelsPageDto {
  @ApiProperty({type:[PostDto]}) items:PostDto[];
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
