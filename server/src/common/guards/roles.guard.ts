import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/auth.decorators.js';
import type { AuthUser } from '../decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../errors/app.exception.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw AppException.unauthorized();
    if (!roles.includes(user.role) && user.role !== 'SUPER_ADMIN') {
      throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Insufficient permissions');
    }
    return true;
  }
}
