import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { EmptyToNull, SanitizedText } from '../../../common/utils/sanitize.js';
import { USERNAME_RE } from '../../users/dto/user.dto.js';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../auth/dto/auth.dto.js';
import { AdminUserRefDto, ReasonDto } from './admin.dto.js';

export class AdminSessionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String, nullable: true, description: 'Browser/app as reported at sign-in' }) userAgent: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Only with `users.email.read`' }) ipAddress: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) revokedReason: string | null;
  @ApiProperty() active: boolean;
}
export class RevokedSessionsDto {
  @ApiProperty() revoked: number;
}

export class AdminCircleMembershipDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() emoji: string;
  @ApiProperty() color: string;
  @ApiProperty() role: string;
  @ApiProperty() memberCount: number;
  @ApiProperty({ format: 'date-time' }) joinedAt: string;
}
export class AdminUserActivityDto {
  @ApiProperty() messagesSent: number;
  @ApiProperty() messagesReceived: number;
  @ApiProperty({ description: 'People they have exchanged direct messages with' }) conversations: number;
  @ApiProperty({ description: 'Calls in the last 30 days (both directions)' }) recentCalls: number;
  @ApiProperty() activeStories: number;
  @ApiProperty() stickers: number;
  @ApiProperty() bookmarks: number;
  @ApiProperty() likesGiven: number;
  @ApiProperty() reportsFiled: number;
  @ApiProperty({ type: [AdminCircleMembershipDto] }) circles: AdminCircleMembershipDto[];
  @ApiProperty({ description: 'Posts per day for the last 14 UTC days, oldest first', type: [Number] }) postsByDay: number[];
}

export class AdminUserNoteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: AdminUserRefDto, nullable: true }) author: AdminUserRefDto | null;
  @ApiProperty() canDelete: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class CreateAdminUserNoteDto {
  @ApiProperty({ minLength: 2, maxLength: 2000 }) @SanitizedText({ multiline: true }) @IsString() @MinLength(2) @MaxLength(2000) body: string;
}

/** Staff edits to a profile, e.g. removing an offensive name or picture. Always audited with a reason. */
export class AdminUpdateProfileDto extends ReasonDto {
  @ApiPropertyOptional({ maxLength: 50 }) @IsOptional() @SanitizedText() @IsString() @MinLength(1) @MaxLength(50) displayName?: string;
  @ApiPropertyOptional({ pattern: USERNAME_RE.source }) @IsOptional() @IsString()
  @Matches(USERNAME_RE, { message: 'username must be 3-30 characters: letters, digits or underscore' }) username?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional() @EmptyToNull() @SanitizedText({ multiline: true }) @IsString() @MaxLength(300) bio?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional() @EmptyToNull() @SanitizedText() @IsString() @MaxLength(100) location?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional() @EmptyToNull() @ValidateIf((_, value) => value !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'website must be an http(s) URL' }) @MaxLength(200) website?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrivate?: boolean;
  @ApiPropertyOptional({ description: 'Delete the profile photo' }) @IsOptional() @IsBoolean() removeAvatar?: boolean;
  @ApiPropertyOptional({ description: 'Delete the cover image' }) @IsOptional() @IsBoolean() removeCover?: boolean;
}
export class AdminProfileResultDto {
  @ApiProperty({ type: [String], description: 'Fields that actually changed' }) changed: string[];
}

export class AdminResetPasswordDto extends ReasonDto {
  @ApiPropertyOptional({ description: `Omit to generate a strong temporary password. ${PASSWORD_MESSAGE}` })
  @IsOptional() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) password?: string;
}
export class AdminResetPasswordResultDto {
  @ApiProperty({ type: String, nullable: true, description: 'The generated password, shown once; null when you chose it' })
  temporaryPassword: string | null;
  @ApiProperty({ description: 'Devices that were signed out' }) revokedSessions: number;
}
