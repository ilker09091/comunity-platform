/**
 * Migration CLI (runs from the compiled output):
 *   npm run migration:run      apply pending migrations
 *   npm run migration:revert   revert the most recent migration
 *   npm run migration:show     list migrations and their status
 */
import { existsSync } from 'node:fs';
import { loadAppConfig } from '../config/app.config.js';
import { createDataSource } from './data-source.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const command = process.argv[2] ?? 'run';
const config = loadAppConfig();
const dataSource = createDataSource(config.db);

try {
  await dataSource.initialize();
  if (command === 'run') {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    console.log(applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'No pending migrations');
  } else if (command === 'revert') {
    await dataSource.undoLastMigration({ transaction: 'each' });
    console.log('Reverted the most recent migration');
  } else if (command === 'show') {
    const pending = await dataSource.showMigrations();
    console.log(pending ? 'There are pending migrations' : 'All migrations applied');
  } else {
    console.error(`Unknown command "${command}". Use run | revert | show.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
