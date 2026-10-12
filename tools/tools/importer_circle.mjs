// Local configuration adapter. Input travels over stdin; secrets never enter argv/stdout.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'server');
const envPath = path.join(server, '.env');
const operation = process.argv[2];
const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { value += chunk; if (value.length > 16000) reject(new Error('Input too large')); });
  process.stdin.on('end', () => resolve(value || '{}')); process.stdin.on('error', reject);
}));
const require = createRequire(path.join(server, 'package.json'));
let password = '';
try {
  const text = await fs.readFile(envPath, 'utf8');
  const env = parseEnv(text);
  const current = {host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
    username: env.DB_USERNAME || '', database: env.DB_NAME || '', ssl: ['true','1','yes'].includes(env.DB_SSL || '')};
  if (operation === 'read') {
    console.log(JSON.stringify({database: {...current, passwordConfigured: !!env.DB_PASSWORD},
      circleUrl: process.env.CIRCLE_WEB_URL || 'http://localhost:3000',
      serverPort: Number(env.PORT || 3002), storageDriver: env.MEDIA_STORAGE_DRIVER || 'local',
      storageDirectory: env.MEDIA_LOCAL_DIR || './storage/media'}));
  } else {
    if (!['test','apply'].includes(operation)) throw new Error('Unknown configuration operation');
    const config = {host: String(input.host || '').trim(), port: Number(input.port),
      username: String(input.username || '').trim(), database: String(input.database || '').trim(), ssl: input.ssl === true};
    for (const name of ['host','username','database'])
      if (!config[name] || config[name].length > 253 || /[\r\n\0]/.test(config[name])) throw new Error(`Invalid ${name}`);
    if (!/^[a-zA-Z0-9._:[\]-]+$/.test(config.host) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
      throw new Error('Invalid PostgreSQL host/port');
    // Empty password input preserves the existing password; clearing must be explicit.
    password = input.clearPassword === true ? '' : input.password ? String(input.password) : env.DB_PASSWORD || '';
    if (password.length > 2048 || /[\r\n\0]/.test(password)) throw new Error('Invalid password');
    const { Client } = require('pg');
    const client = new Client({...config, user: config.username, password,
      ssl: config.ssl ? {rejectUnauthorized: true} : false,
      connectionTimeoutMillis: 8000, query_timeout: 8000, application_name: 'circle-importer-configuration'});
    let schema;
    try {
      await client.connect();
      const result = await client.query(`SELECT to_regclass('public.users') AS users,
        to_regclass('public.posts') AS posts, to_regclass('public.media') AS media,
        to_regclass('public.post_media') AS post_media, to_regclass('public.typeorm_migrations') AS migrations`);
      const tables = result.rows[0];
      const missingTables = Object.entries(tables).filter(([,value]) => !value).map(([key]) => key);
      const { migrations } = await import(pathToFileURL(path.join(server, 'dist/database/migrations/index.js')).href);
      const expected = migrations.map(Migration => new Migration().name);
      const installed = tables.migrations ? (await client.query('SELECT name FROM typeorm_migrations')).rows.map(row => row.name) : [];
      const missingMigrations = expected.filter(name => !installed.includes(name));
      const missingPrivileges = [];
      for (const table of ['users','posts','media','post_media']) {
        if (!tables[table]) continue;
        const permissions = await client.query(`SELECT has_table_privilege($1,'SELECT') AS read,
          has_table_privilege($1,'INSERT') AND
          has_table_privilege($1,'UPDATE') AND has_table_privilege($1,'DELETE') AS all_writes`, [`public.${table}`]);
        if (!permissions.rows[0].read || !permissions.rows[0].all_writes) missingPrivileges.push(table);
      }
      schema = {compatible: !missingTables.length && !missingMigrations.length && !missingPrivileges.length, missingTables, missingMigrations, missingPrivileges};
    } finally { await client.end().catch(() => {}); }
    if (operation === 'apply' && !schema.compatible) {
      console.log(JSON.stringify({code:'CIRCLE_SCHEMA_MISSING',message:'Bağlantı başarılı ancak Circle tabloları/migrationları eksik. Hedefte mevcut Circle migrationlarını kurmadan bağlantı uygulanmadı.',schema}));
      process.exitCode = 1;
    } else {
      if (operation === 'apply') {
        const values = {DB_HOST:config.host,DB_PORT:String(config.port),DB_USERNAME:config.username,
          DB_PASSWORD:password,DB_NAME:config.database,DB_SSL:String(config.ssl)};
        const literal = value => {
          // Verify dotenv round-trip; do not assume JSON escaping equals dotenv escaping.
          for (const candidate of [`'${value}'`, `"${value}"`, JSON.stringify(value), value]) {
            try { if (parseEnv(`VALUE=${candidate}`).VALUE === value) return candidate; } catch {}
          }
          throw new Error('This value cannot be safely represented in the existing .env format');
        };
        const seen = new Set();
        const lines = text.split(/\r?\n/).map(line => {
          const match = line.match(/^\s*(?:export\s+)?(DB_HOST|DB_PORT|DB_USERNAME|DB_PASSWORD|DB_NAME|DB_SSL)\s*=/);
          if (!match) return line;
          seen.add(match[1]); return `${match[1]}=${literal(values[match[1]])}`;
        });
        for (const [key,value] of Object.entries(values)) if (!seen.has(key)) lines.push(`${key}=${literal(value)}`);
        const updated = lines.join('\n');
        const parsed = parseEnv(updated);
        for (const [key,value] of Object.entries(values)) if (parsed[key] !== value) throw new Error('Configuration did not round-trip safely');
        const temporary = `${envPath}.${crypto.randomUUID()}.tmp`;
        try { await fs.writeFile(temporary,updated,{mode:0o600,flag:'wx'}); await fs.rename(temporary,envPath); }
        finally { await fs.rm(temporary,{force:true}).catch(() => {}); }
      }
      console.log(JSON.stringify({ok:true,saved:operation==='apply',database:{...config,passwordConfigured:!!password},schema,
        message:schema.compatible?'PostgreSQL bağlantısı ve mevcut Circle şeması doğrulandı.':'Bağlantı başarılı; hedef Circle şeması henüz hazır değil.'}));
    }
  }
} catch (error) {
  // PG errors can contain connection parameters. Never echo a supplied/current password.
  let message = String(error.message || 'Database configuration failed');
  if (password) message = message.split(password).join('[hidden]');
  console.log(JSON.stringify({code:'DATABASE_CONFIGURATION_ERROR',message:message.slice(0,1000)}));
  process.exitCode = 1;
}
