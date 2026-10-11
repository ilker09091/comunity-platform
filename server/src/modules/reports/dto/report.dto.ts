import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/common.dto.js';
import { sanitizeText } from '../../../common/utils/sanitize.js';
import { UserRoleEnum, UserSummaryDto } from '../../users/dto/user.dto.js';

export enum ReportTargetTypeEnum {
  POST = 'POST',
  COMMENT = 'COMMENT',
  USER = 'USER',
}

export enum ReportReasonEnum {
  SPAM = 'SPAM',
  HARASSMENT = 'HARASSMENT',
  HATE_SPEECH = 'HATE_SPEECH',
  VIOLENCE = 'VIOLENCE',
  NUDITY = 'NUDITY',
  SELF_HARM = 'SELF_HARM',
  MISINFORMATION = 'MISINFORMATION',
  IMPERSONATION = 'IMPERSONATION',
  INTELLECTUAL_PROPERTY = 'INTELLECTUAL_PROPERTY',
  OTHER = 'OTHER',
}

export enum ReportStatusEnum {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export enum ModerationActionEnum {
  NONE = 'NONE',
  REMOVE_CONTENT = 'REMOVE_CONTENT',
  SUSPEND_USER = 'SUSPEND_USER',
}

const note = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const clean = sanitizeText(value, { multiline: true });
    return clean === '' ? undefined : clean;
  });

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetTypeEnum, enumName: 'ReportTargetType', example: ReportTargetTypeEnum.POST })
  @IsEnum(ReportTargetTypeEnum)
  targetType: ReportTargetTypeEnum;

  @ApiProperty({ format: 'uuid', description: 'Id of the post, comment or user being reported' })
  @IsUUID('all')
  targetId: string;

  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason', example: ReportReasonEnum.SPAM })
  @IsEnum(ReportReasonEnum)
  reason: ReportReasonEnum;

  @ApiPropertyOptional({ maxLength: 1000, example: 'Posting the same link repeatedly.' })
  @IsOptional()
  @note()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReportDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ enum: ReportTargetTypeEnum, enumName: 'ReportTargetType' })
  targetType: ReportTargetTypeEnum;
  @ApiProperty({ format: 'uuid' })
  targetId: string;
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason' })
  reason: ReportReasonEnum;
  @ApiProperty({ type: String, nullable: true })
  details: string | null;
  @ApiProperty({ enum: ReportStatusEnum, enumName: 'ReportStatus', example: ReportStatusEnum.OPEN })
  status: ReportStatusEnum;
  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ModerationReportDto extends ReportDto {
  @ApiProperty({ type: UserSummaryDto })
  reporter: UserSummaryDto;
  @ApiProperty({ example: 3, description: 'Open reports for the same target (from all reporters)' })
  openReportsForTarget: number;
  @ApiProperty({ type: String, nullable: true })
  resolutionNote: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  resolvedById: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt: string | null;
}

export class ModerationReportsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ReportStatusEnum, enumName: 'ReportStatus', default: ReportStatusEnum.OPEN })
  @IsOptional()
  @IsEnum(ReportStatusEnum)
  status?: ReportStatusEnum;

  @ApiPropertyOptional({ enum: ReportTargetTypeEnum, enumName: 'ReportTargetType' })
  @IsOptional()
  @IsEnum(ReportTargetTypeEnum)
  targetType?: ReportTargetTypeEnum;
}

export class ResolveReportDto {
  @ApiProperty({ enum: [ReportStatusEnum.RESOLVED, ReportStatusEnum.DISMISSED], example: ReportStatusEnum.RESOLVED })
  @IsIn([ReportStatusEnum.RESOLVED, ReportStatusEnum.DISMISSED])
  status: ReportStatusEnum.RESOLVED | ReportStatusEnum.DISMISSED;

  @ApiPropertyOptional({
    enum: ModerationActionEnum,
    enumName: 'ModerationAction',
    default: ModerationActionEnum.NONE,
    description: 'Action applied to the target. SUSPEND_USER requires ADMIN. Any action also resolves other open reports for the same target.',
  })
  @IsOptional()
  @IsEnum(ModerationActionEnum)
  action?: ModerationActionEnum;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @note()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SetRoleDto {
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole' })
  @IsEnum(UserRoleEnum)
  role: UserRoleEnum;
}

export class ModerationResultDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'REMOVED', description: 'New moderation status (ACTIVE | REMOVED) or account status (ACTIVE | SUSPENDED) or role' })
  status: string;
}
