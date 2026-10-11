import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Points every e2e test at a dedicated `<DB_NAME>_test` database. Runs before any test module
 * (and AppModule) is imported, in both the global setup and each test worker.
 */
export function applyTestEnv() {
  if (process.env.__TEST_ENV_APPLIED) return;
  if (existsSync('.env')) process.loadEnvFile('.env');
  const testDb = process.env.TEST_DB_NAME ?? `${process.env.DB_NAME}_test`;
  if (!testDb.endsWith('_test')) {
    throw new Error(`Refusing to run destructive e2e tests against "${testDb}" (name must end with _test)`);
  }
  Object.assign(process.env, {
    __TEST_ENV_APPLIED: '1',
    NODE_ENV: 'test',
    DB_NAME: testDb,
    THROTTLE_ENABLED: 'false',
    JWT_EXPIRES_IN: '15m',
    MEDIA_LOCAL_DIR: join(tmpdir(), 'community-platform-e2e-media'),
    MEDIA_CLEANUP_ENABLED: 'false',
    PUBLIC_BASE_URL: 'http://localhost:0',
  });
}

applyTestEnv();
