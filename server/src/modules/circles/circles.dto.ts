import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CursorQueryDto } from '../../common/dto/common.dto.js';
import { EmptyToNull, SanitizedText } from '../../common/utils/sanitize.js';
import { MediaDto } from '../media/dto/media.dto.js';
import { UserSummaryDto } from '../users/dto/user.dto.js';

export const CIRCLE_KINDS = ['friends', 'class', 'club'] as const;
export const STREAK_RULES = ['auto', 'all', 'most', 'half'] as const;
export const CIRCLE_ROLES = ['owner', 'admin', 'member'] as const;
export type CircleKind = (typeof CIRCLE_KINDS)[number];
export type StreakRule = (typeof STREAK_RULES)[number];
export type CircleRole = (typeof CIRCLE_ROLES)[number];
const COLOR = /^#[0-9a-f]{6}$/;

export class CreateCircleDto {
  @ApiProperty({ minLength: 2, maxLength: 40 }) @SanitizedText() @IsString() @MinLength(2) @MaxLength(40) name: string;
  @ApiProperty({ maxLength: 16, description: 'One emoji shown as the circle picture' })
  @SanitizedText() @IsString() @MinLength(1) @MaxLength(16) emoji: string;
  @ApiProperty({ example: '#7c5cff', description: 'Lowercase hex accent colour' }) @Matches(COLOR) color: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160 })
  @IsOptional() @EmptyToNull() @SanitizedText() @IsString() @MaxLength(160) description?: string | null;
  @ApiPropertyOptional({ enum: CIRCLE_KINDS, default: 'friends' }) @IsOptional() @IsIn(CIRCLE_KINDS) kind?: CircleKind;
}
export class UpdateCircleDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 40 }) @IsOptional() @SanitizedText() @IsString() @MinLength(2) @MaxLength(40) name?: string;
  @ApiPropertyOptional({ maxLength: 16 }) @IsOptional() @SanitizedText() @IsString() @MinLength(1) @MaxLength(16) emoji?: string;
  @ApiPropertyOptional({ example: '#7c5cff' }) @IsOptional() @Matches(COLOR) color?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160 })
  @IsOptional() @EmptyToNull() @SanitizedText() @IsString() @MaxLength(160) description?: string | null;
  @ApiPropertyOptional({ enum: CIRCLE_KINDS }) @IsOptional() @IsIn(CIRCLE_KINDS) kind?: CircleKind;
  @ApiPropertyOptional({ enum: STREAK_RULES, description: 'auto: everyone up to 6 members, two thirds above' })
  @IsOptional() @IsIn(STREAK_RULES) streakRule?: StreakRule;
  @ApiPropertyOptional({ description: 'Members (not only admins) can see and share the invite link' })
  @IsOptional() @IsBoolean() membersCanInvite?: boolean;
}
export class JoinCircleDto {
  @ApiProperty({ minLength: 6, maxLength: 10 }) @IsString() @Matches(/^[A-Za-z0-9]{6,10}$/) code: string;
}
export class CircleRoleDto {
  @ApiProperty({ enum: ['admin', 'member', 'owner'], description: 'owner transfers ownership; you become an admin' })
  @IsIn(['admin', 'member', 'owner']) role: CircleRole;
}
export class CreateCirclePostDto {
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @SanitizedText({ multiline: true }) @IsString() @MaxLength(1000) content?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Your uploaded photo or video' }) @IsOptional() @IsUUID('all') mediaId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: "Answer today's question" }) @IsOptional() @IsUUID('all') promptId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Add to an open album (photo or video required)' }) @IsOptional() @IsUUID('all') albumId?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 5, description: 'Option index for a poll question' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5) pollChoice?: number;
}
export class CreateCirclePromptDto {
  @ApiProperty({ minLength: 3, maxLength: 200 }) @SanitizedText() @IsString() @MinLength(3) @MaxLength(200) text: string;
  @ApiProperty({ enum: ['text', 'photo', 'poll'] }) @IsIn(['text', 'photo', 'poll']) kind: 'text' | 'photo' | 'poll';
  @ApiPropertyOptional({ type: [String], description: 'Two to six choices for a poll', maxItems: 6 })
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(6) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(40, { each: true })
  options?: string[];
}
export class CreateCircleAlbumDto {
  @ApiProperty({ minLength: 1, maxLength: 60 }) @SanitizedText() @IsString() @MinLength(1) @MaxLength(60) title: string;
  @ApiProperty({ minimum: 1, maximum: 168, description: 'Hours the album accepts uploads' })
  @Type(() => Number) @IsInt() @Min(1) @Max(168) hours: number;
}

export class CircleStreakDto {
  @ApiProperty({ description: 'Current shared streak; 0 once it has lapsed' }) days: number;
  @ApiProperty() best: number;
  @ApiProperty({ description: 'Members who did something for the circle today (UTC)' }) todayCount: number;
  @ApiProperty({ description: 'How many are needed today to keep the streak' }) needed: number;
  @ApiProperty() completedToday: boolean;
  @ApiProperty() contributedToday: boolean;
  @ApiProperty({ description: 'The streak ends unless today is completed' }) atRisk: boolean;
}
export class CircleDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() emoji: string;
  @ApiProperty() color: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: CIRCLE_KINDS }) kind: CircleKind;
  @ApiProperty({ enum: CIRCLE_ROLES }) role: CircleRole;
  @ApiProperty() memberCount: number;
  @ApiProperty({ type: [UserSummaryDto], description: 'Up to five members for the avatar stack' }) members: UserSummaryDto[];
  @ApiProperty({ type: CircleStreakDto }) streak: CircleStreakDto;
  @ApiProperty({ enum: STREAK_RULES }) streakRule: StreakRule;
  @ApiProperty() membersCanInvite: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Only for people allowed to invite' }) inviteCode: string | null;
  @ApiProperty({ description: "You have answered today's question" }) answeredToday: boolean;
  @ApiProperty({ description: 'Something new since you last opened the circle' }) hasNew: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class CircleInviteDto {
  @ApiProperty() name: string;
  @ApiProperty() emoji: string;
  @ApiProperty() color: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: CIRCLE_KINDS }) kind: CircleKind;
  @ApiProperty() memberCount: number;
  @ApiProperty({ type: [UserSummaryDto] }) members: UserSummaryDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Set when you are already a member' }) circleId: string | null;
  @ApiProperty() full: boolean;
}
export class CircleMemberDto {
  @ApiProperty({ type: UserSummaryDto }) user: UserSummaryDto;
  @ApiProperty({ enum: CIRCLE_ROLES }) role: CircleRole;
  @ApiProperty({ format: 'date-time' }) joinedAt: string;
  @ApiProperty() contributedToday: boolean;
}
export class CirclePostDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserSummaryDto }) author: UserSummaryDto;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: MediaDto, nullable: true }) media: MediaDto | null;
  @ApiProperty({ type: Number, nullable: true }) pollChoice: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) promptId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) albumId: string | null;
  @ApiProperty() canDelete: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class CirclePromptDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date', description: 'UTC day' }) day: string;
  @ApiProperty({ enum: ['text', 'photo', 'poll'] }) kind: 'text' | 'photo' | 'poll';
  @ApiProperty() text: string;
  @ApiProperty({ type: [String], nullable: true }) options: string[] | null;
  @ApiProperty({ type: UserSummaryDto, nullable: true, description: 'Written by a circle admin; null for the built-in question' })
  author: UserSummaryDto | null;
  @ApiProperty() answeredCount: number;
  @ApiProperty() memberCount: number;
  @ApiProperty({ type: CirclePostDto, nullable: true }) myAnswer: CirclePostDto | null;
  @ApiProperty({ type: [CirclePostDto], description: "Empty until you answer (today's question only)" }) answers: CirclePostDto[];
  @ApiProperty({ type: [Number], nullable: true, description: 'Votes per option once you have answered a poll' }) results: number[] | null;
}
export class CircleAlbumDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: UserSummaryDto, nullable: true }) createdBy: UserSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) closesAt: string;
  @ApiProperty() open: boolean;
  @ApiProperty() itemCount: number;
  @ApiProperty({ type: [MediaDto], description: 'Up to four newest photos/videos' }) preview: MediaDto[];
  @ApiProperty() canDelete: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class CircleItemsQueryDto extends CursorQueryDto {}
