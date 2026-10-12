import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeText } from '../../../common/utils/sanitize.js';

export enum UserRoleEnum {
  USER = 'USER',
  SUPPORT = 'SUPPORT',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum UserStatusEnum {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  BANNED = 'BANNED',
  DEACTIVATED = 'DEACTIVATED',
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

/** Usernames that would collide with static routes or impersonate the platform. */
export const RESERVED_USERNAMES = new Set([
  'me', 'admin', 'administrator', 'root', 'api', 'auth', 'login', 'logout', 'register', 'signup',
  'settings', 'search', 'explore', 'feed', 'notifications', 'messages', 'moderation', 'support',
  'help', 'about', 'home', 'system', 'null', 'undefined', 'official', 'staff', 'security',
]);

export class UserSummaryDto {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id: string;

  @ApiProperty({ example: 'jane_doe' })
  username: string;

  @ApiProperty({ example: 'Jane Doe' })
  displayName: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Signed URL' })
  avatarUrl: string | null;

  @ApiProperty({ example: false })
  isPrivate: boolean;

  @ApiProperty({ example: false, description: 'Blue verification badge, granted by administrators' })
  isVerified: boolean;
}

export class UserListItemDto extends UserSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'Coffee, code and cats.' })
  bio: string | null;

  @ApiProperty({ example: 120 })
  followerCount: number;

  @ApiProperty({ description: 'Viewer follows this user (false for anonymous viewers)', example: false })
  isFollowing: boolean;

  @ApiProperty({ description: 'This user follows the viewer', example: false })
  followsYou: boolean;
}

export class UserProfileDto extends UserSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'Coffee, code and cats.' })
  bio: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Berlin' })
  location: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'https://jane.dev' })
  website: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Signed URL' })
  coverUrl: string | null;

  @ApiProperty({ example: 120 })
  followerCount: number;

  @ApiProperty({ example: 87 })
  followingCount: number;

  @ApiProperty({ example: 42 })
  postCount: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: false, description: 'The viewer is this user' })
  isSelf: boolean;

  @ApiProperty({ example: false })
  isFollowing: boolean;

  @ApiProperty({ example: false })
  followsYou: boolean;

  @ApiProperty({ example: false, description: 'Viewer has a pending follow request to this (private) user' })
  isFollowRequested: boolean;

  @ApiProperty({ example: false, description: 'Viewer has blocked this user' })
  isBlocking: boolean;

  @ApiProperty({
    example: true,
    description: 'Viewer may see posts/followers/following (false for private accounts the viewer does not follow, or when blocking)',
  })
  canViewContent: boolean;
}

/** Private representation of the authenticated user. Never returned for other users. */
export class MeDto {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id: string;
  @ApiProperty({ example: 'jane_doe' })
  username: string;
  @ApiProperty({ example: 'jane@example.com' })
  email: string;
  @ApiProperty({ example: 'Jane Doe' })
  displayName: string;
  @ApiProperty({ example: false, description: 'Blue verification badge, granted by administrators' })
  isVerified: boolean;
  @ApiProperty({ type: String, nullable: true, example: null })
  avatarUrl: string | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  coverUrl: string | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  bio: string | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  location: string | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  website: string | null;
  @ApiProperty({ example: false })
  isPrivate: boolean;
  @ApiProperty({ enum: UserRoleEnum, enumName: 'UserRole', example: UserRoleEnum.USER })
  role: UserRoleEnum;
  @ApiProperty({ enum: UserStatusEnum, enumName: 'UserStatus', example: UserStatusEnum.ACTIVE })
  status: UserStatusEnum;
  @ApiProperty({ example: 0 })
  followerCount: number;
  @ApiProperty({ example: 0 })
  followingCount: number;
  @ApiProperty({ example: 0 })
  postCount: number;
  @ApiProperty({ example: 0, description: 'Pending incoming follow requests' })
  pendingFollowRequestCount: number;
  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  createdAt: string;
  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  updatedAt: string;
}

const optionalText = () => Transform(({ value }) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const clean = sanitizeText(value, { multiline: false });
  return clean === '' ? null : clean;
});

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'jane_doe', description: '3–30 chars: letters, digits, underscore. Case-insensitively unique.' })
  @IsOptional()
  @IsString()
  @Matches(USERNAME_RE, { message: 'username must be 3-30 characters: letters, digits or underscore' })
  username?: string;

  @ApiPropertyOptional({ example: 'Jane Doe', minLength: 1, maxLength: 50 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? sanitizeText(value, { multiline: false }) : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, example: 'Coffee, code and cats.', description: 'Send null or "" to clear' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null) return null;
    if (typeof value !== 'string') return value;
    const clean = sanitizeText(value, { multiline: true });
    return clean === '' ? null : clean;
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  bio?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: 'Berlin' })
  @IsOptional()
  @optionalText()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, example: 'https://jane.dev', description: 'http(s) URL' })
  @IsOptional()
  @optionalText()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'website must be an http(s) URL' })
  @MaxLength(200)
  website?: string | null;

  @ApiPropertyOptional({
    example: false,
    description: 'Private accounts require follow approval. Switching to public auto-approves pending requests.',
  })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class ProfileImageMediaDto {
  @ApiProperty({ format: 'uuid', description: 'An unattached image you uploaded' })
  @IsUUID('all')
  mediaId: string;
}
