import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type UserRole = 'USER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  sessionId: string;
}

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/**
 * Route does not require authentication. If a valid bearer token is supplied the viewer
 * is still resolved (for viewer-specific flags such as `isLiked`).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts the route to the listed roles (in addition to authentication). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Authenticated user (throws if absent — only use on protected routes). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Authenticated user or `null` for anonymous requests on public routes. */
export const Viewer = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | null => {
  return ctx.switchToHttp().getRequest().user ?? null;
});
