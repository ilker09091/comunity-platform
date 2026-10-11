import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { appConfig } from '../../config/app.config.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { isStaff } from './permissions.js';
import { PlatformSettingsService } from './platform-settings.service.js';

/**
 * Read-only maintenance mode. Blocks writes by ordinary users only: reads, authentication,
 * marking notifications read and every staff request stay available, so administrators can
 * never lock themselves out.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly settings: PlatformSettingsService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const { general } = await this.settings.get();
    if (!general.readOnlyMode) return true;
    if (req.user && isStaff(req.user.role)) return true;
    const path = req.path.replace(new RegExp(`^/${this.config.apiPrefix}`), '');
    if (/^\/(auth|admin)\//.test(path) || /^\/notifications\/(read-all|[^/]+\/read)$/.test(path) || path === '/users/me/inbox/read')
      return true;
    throw new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.READ_ONLY_MODE,
      general.maintenanceMessage || 'Circle is in read-only maintenance mode. Please try again later.',
    );
  }
}
