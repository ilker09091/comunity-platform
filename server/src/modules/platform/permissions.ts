import type { UserRole } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';

/** Every permission the admin control center checks server-side. */
export const PERMISSIONS = [
  'users.read',
  'users.email.read',
  'users.update',
  'users.warn',
  'users.suspend',
  'users.ban',
  'users.roles.manage',
  'admins.manage',
  'posts.read',
  'posts.moderate',
  'comments.moderate',
  'reels.moderate',
  'media.manage',
  'reports.read',
  'reports.resolve',
  'notifications.broadcast',
  'analytics.read',
  'settings.read',
  'settings.update',
  'audit.read',
  'system.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const SUPPORT: Permission[] = ['users.read', 'users.email.read', 'posts.read', 'reports.read'];
const MODERATOR: Permission[] = [
  'users.read',
  'users.warn',
  'users.suspend',
  'posts.read',
  'posts.moderate',
  'comments.moderate',
  'reels.moderate',
  'reports.read',
  'reports.resolve',
  'analytics.read',
];
const ADMIN: Permission[] = [
  ...MODERATOR,
  'users.email.read',
  'users.update',
  'users.ban',
  'users.roles.manage',
  'media.manage',
  'notifications.broadcast',
  'settings.read',
  'settings.update',
  'audit.read',
  'system.read',
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  USER: [],
  SUPPORT,
  MODERATOR,
  ADMIN,
  SUPER_ADMIN: PERMISSIONS,
};

/** Hierarchy used for "may act on" and "may grant" decisions. */
export const ROLE_RANK: Record<UserRole, number> = { USER: 0, SUPPORT: 1, MODERATOR: 2, ADMIN: 3, SUPER_ADMIN: 4 };
export const STAFF_ROLES: UserRole[] = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

export const isStaff = (role: UserRole) => ROLE_RANK[role] > 0;
export const hasPermission = (role: UserRole, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);

export function assertPermission(role: UserRole, ...permissions: Permission[]) {
  const missing = permissions.filter((p) => !hasPermission(role, p));
  if (missing.length)
    throw AppException.forbidden(ErrorCode.FORBIDDEN, `Missing permission: ${missing.join(', ')}`);
}

/** The actor may only act on accounts of strictly lower rank (never on themselves). */
export function assertOutranks(actor: { id: string; role: UserRole }, target: { id: string; role: UserRole }) {
  if (actor.id === target.id) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'You cannot perform this action on your own account');
  if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role])
    throw AppException.forbidden(ErrorCode.INSUFFICIENT_RANK, 'You cannot act on an account with an equal or higher role');
}

/**
 * Roles an actor may grant: strictly below their own rank. SUPER_ADMIN may grant any role.
 * Granting or removing ADMIN/SUPER_ADMIN additionally requires `admins.manage`.
 */
export function assignableRoles(actorRole: UserRole): UserRole[] {
  const rank = ROLE_RANK[actorRole];
  return (Object.keys(ROLE_RANK) as UserRole[]).filter(
    (role) => actorRole === 'SUPER_ADMIN' || ROLE_RANK[role] < rank,
  );
}
