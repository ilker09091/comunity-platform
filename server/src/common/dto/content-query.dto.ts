import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CursorQueryDto } from './common.dto.js';
import type { ContentFilter } from '../utils/content.js';

export class ContentQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ['home','reels','all'], default: 'home', description: 'Server-side attachment classification; reposts/quotes resolve their original. home excludes every VIDEO attachment, including processing videos.' })
  @IsOptional()
  @IsIn(['home','reels','all'])
  content?: ContentFilter;
}
