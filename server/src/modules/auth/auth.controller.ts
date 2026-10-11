import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { AuthService, ClientMeta } from './auth.service.js';
import { AuthResponseDto, ChangePasswordDto, LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto.js';

// Stricter per-IP limits for credential endpoints (AUTH_THROTTLE_LIMIT per AUTH_THROTTLE_TTL_SECONDS).
const authLimit = () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10);
const authTtl = () => Number(process.env.AUTH_THROTTLE_TTL_SECONDS ?? 60) * 1000;
const AuthThrottle = () => Throttle({ default: { limit: authLimit, ttl: authTtl } });

const meta = (req: Request): ClientMeta => ({ userAgent: req.get('user-agent'), ip: req.ip });

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AuthThrottle()
  @Post('register')
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiErrors(400, 409)
  register(@Body() dto: RegisterDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.auth.register(dto, meta(req));
  }

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email or username',
    description: 'Unknown accounts and wrong passwords both return 401 `INVALID_CREDENTIALS`.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(400, 401, 403)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.auth.login(dto, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: () => authLimit() * 3, ttl: authTtl } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate tokens',
    description:
      'Exchanges a refresh token for a new access + refresh token pair. Refresh tokens are single use: ' +
      'replaying a used token revokes the whole session. Clients must serialise refresh calls.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(400, 401, 403)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Revoke the current session (access and refresh tokens)' })
  @ApiNoContentResponse({ description: 'Session revoked' })
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }

  @Post('background-session')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  @ApiAuth()
  @ApiOperation({
    summary: 'Create a separate background importer session for the current account',
    description: 'Independent single-use refresh chain. Logout-all, password changes and account restrictions revoke it normally. Never accepts another user ID.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(401, 403, 429)
  backgroundSession(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<AuthResponseDto> {
    return this.auth.backgroundSession(user.id, meta(req));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  @ApiNoContentResponse({ description: 'All sessions revoked' })
  async logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logoutAll(user.id);
  }

  @AuthThrottle()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Change password', description: 'Revokes all other sessions; the current session stays valid.' })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiErrors(400)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user.id, user.sessionId, dto);
  }
}
