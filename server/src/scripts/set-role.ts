/**
 * Explicit, server-side role bootstrap. This is the only way to create the first SUPER_ADMIN
 * (nothing is granted automatically and no credentials are hardcoded):
 *   npm run build && npm run user:set-role -- <username> <USER|SUPPORT|MODERATOR|ADMIN|SUPER_ADMIN>
 * The change is recorded in the append-only admin audit log (source: cli).
 */
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { loadAppConfig } from '../config/app.config.js';
import { createDataSource } from '../database/data-source.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const [username, role] = process.argv.slice(2);
const ROLES = ['USER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];
if (!username || !ROLES.includes(role ?? '')) {
  console.error(`Usage: npm run user:set-role -- <username> <${ROLES.join('|')}>`);
  process.exit(1);
}

const dataSource = createDataSource(loadAppConfig().db);
await dataSource.initialize();
try {
  await dataSource.transaction(async (m) => {
    await m.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY id FOR UPDATE`);
    const [user] = (await m.query(`SELECT id, role FROM users WHERE username = $1 FOR UPDATE`, [username])) as {
      id: string;
      role: string;
    }[];
    if (!user) throw new Error(`User "${username}" not found`);
    if (user.role === role) {
      console.log(`User "${username}" already has role ${role}`);
      return;
    }
    if (user.role === 'SUPER_ADMIN') {
      const [{ n }] = (await m.query(
        `SELECT count(*)::int AS n FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> $1`,
        [user.id],
      )) as { n: number }[];
      if (!n) throw new Error('Refusing to demote the last active SUPER_ADMIN');
    }
    await m.query(`UPDATE users SET role = $2, updated_at = now() WHERE id = $1`, [user.id, role]);
    await m.query(
      `INSERT INTO admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
       VALUES (NULL, 'SYSTEM', 'user.role_changed', 'USER', $1, $2::jsonb)`,
      [user.id, JSON.stringify({ from: user.role, to: role, source: 'cli', osUser: userInfo().username })],
    );
    console.log(`User "${username}" is now ${role} (was ${user.role})`);
  });
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
