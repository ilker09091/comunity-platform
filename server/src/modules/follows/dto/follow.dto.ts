import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { UserListItemDto, UserSummaryDto } from '../../users/dto/user.dto.js';

export enum FollowStatusEnum {
  NONE = 'NONE',
  REQUESTED = 'REQUESTED',
  FOLLOWING = 'FOLLOWING',
}

export class FollowResultDto {
  @ApiProperty({
    enum: FollowStatusEnum,
    enumName: 'FollowStatus',
    example: FollowStatusEnum.FOLLOWING,
    description: 'REQUESTED when the target is private and approval is pending',
  })
  status: FollowStatusEnum;

  @ApiProperty({ example: 121, description: "Target's follower count after the operation" })
  followerCount: number;
}

export class FollowRequestDto {
  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  requestedAt: string;
}

export class BlockedUserDto {
  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  blockedAt: string;
}

export class BlockResultDto {
  @ApiProperty({ example: true })
  isBlocking: boolean;
}

export class SuggestedUserDto extends UserListItemDto {
  @ApiProperty({ example: 2, description: 'People you follow who follow this user' })
  mutualFollowerCount: number;
}

export class SuggestedUsersDto {
  @ApiProperty({ type: SuggestedUserDto, isArray: true })
  items: SuggestedUserDto[];
}

export class SuggestionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 5, example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
