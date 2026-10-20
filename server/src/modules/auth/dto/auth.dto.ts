import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { sanitizeText } from '../../../common/utils/sanitize.js';
import { MeDto, USERNAME_RE } from '../../users/dto/user.dto.js';

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/s;
export const PASSWORD_MESSAGE = 'password must be 8-128 characters and contain at least one letter and one digit';

export class RegisterDto {
  @ApiProperty({ example: 'jane@example.com', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'jane_doe', description: '3–30 chars: letters, digits, underscore. Case-insensitively unique.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(USERNAME_RE, { message: 'username must be 3-30 characters: letters, digits or underscore' })
  username: string;

  @ApiProperty({ example: 'correct-horse-42', minLength: 8, maxLength: 128, description: PASSWORD_MESSAGE })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiPropertyOptional({ example: 'Jane Doe', maxLength: 50, description: 'Defaults to the username' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? sanitizeText(value, { multiline: false }) : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'jane@example.com', description: 'Email address or username' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier: string;

  @ApiProperty({ example: 'correct-horse-42' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…', description: 'Refresh token from the last auth response (single use)' })
  @IsString()
  @MinLength(20)
  @MaxLength(2048)
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'correct-horse-42' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ example: 'even-better-horse-43', description: PASSWORD_MESSAGE })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'Bearer', enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…' })
  accessToken: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T12:00:00.000Z' })
  accessTokenExpiresAt: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…', description: 'Single-use; rotated on every refresh' })
  refreshToken: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-18T12:00:00.000Z' })
  refreshTokenExpiresAt: string;

  @ApiProperty({ type: MeDto })
  user: MeDto;
}
