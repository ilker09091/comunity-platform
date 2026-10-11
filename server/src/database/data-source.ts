import { DataSource, DataSourceOptions } from 'typeorm';
import type { AppConfig } from '../config/app.config.js';
import { entities } from './entities.js';
import { migrations } from './migrations/index.js';

/** Single source of truth for TypeORM options (used by the app and the migration CLI). */
export function buildDataSourceOptions(db: AppConfig['db']): DataSourceOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ssl: db.ssl ? { rejectUnauthorized: true } : false,
    entities,
    migrations,
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    migrationsRun: false,
    logging: ['error', 'warn', 'migration'],
    extra: { max: db.poolSize, application_name: 'community-platform-api' },
  };
}

export function createDataSource(db: AppConfig['db']): DataSource {
  return new DataSource(buildDataSourceOptions(db));
}
