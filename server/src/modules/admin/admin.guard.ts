import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiHeader, ApiResponse } from '@nestjs/swagger';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../../common/dto/common.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { BEARER_AUTH } from '../../common/swagger/api-docs.decorators.js';
import { assertPermission, isStaff, type Permission } from '../platform/permissions.js';

const PERMISSIONS_KEY = 'admin:permissions';

/**
 * Admin authorization. Runs after the global JWT guard (so the session is valid and the account
 * active) and requires a staff role plus every permission declared on the handler. Roles and
 * permissions come from the database on each request, never from the request body.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw AppException.unauthorized();
    if (!isStaff(user.role)) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Administrator access required');
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length) assertPermission(user.role, ...required);
    return true;
  }
}

/** Marks a controller as admin-only (staff role) and documents the security contract. */
export function AdminController() {
  return applyDecorators(
    UseGuards(AdminGuard),
    ApiBearerAuth(BEARER_AUTH),
    ApiResponse({ status: 401, description: 'Missing or invalid session', type: ErrorResponseDto }),
    ApiResponse({ status: 403, description: 'Not staff, missing permission (`FORBIDDEN`), insufficient rank or step-up required', type: ErrorResponseDto }),
    ApiResponse({ status: 429, description: 'Rate limit exceeded', type: ErrorResponseDto }),
  );
}

/** Permissions required for the handler (all of them). */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Documents the step-up header required by high-impact operations. */
export const ApiStepUp = () =>
  ApiHeader({
    name: 'X-Step-Up-Token',
    required: true,
    description: 'Token from `POST /admin/step-up` (10 min). Missing/expired → 403 `STEP_UP_REQUIRED`.',
  });
