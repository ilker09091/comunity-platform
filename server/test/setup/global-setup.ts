import { applyTestEnv } from './test-env.js';
import { loadAppConfig } from '../../src/config/app.config.js';
import { createDataSource } from '../../src/database/data-source.js';

/** Creates the test database if needed and applies all migrations once per run. */
export default async function globalSetup() {
  applyTestEnv();
  const { db } = loadAppConfig();

  const admin = createDataSource({ ...db, database: 'postgres' });
  await admin.initialize();
  try {
    const exists: unknown[] = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db.database]);
    if (!exists.length) await admin.query(`CREATE DATABASE "${db.database.replace(/"/g, '')}"`);
  } finally {
    await admin.destroy();
  }

  const dataSource = createDataSource(db);
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
