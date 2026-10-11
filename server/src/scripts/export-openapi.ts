/**
 * Writes the OpenAPI document to the shared docs directory without starting the server or
 * connecting to the database (Nest "preview" mode only builds the module graph).
 *   npm run openapi:export            -> ../docs/api/openapi.json
 *   OPENAPI_OUTPUT=path npm run openapi:export
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadAppConfig } from '../config/app.config.js';
import { buildOpenApiDocument } from '../setup-app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadAppConfig();
const { AppModule } = await import('../app.module.js');

const app = await NestFactory.create(AppModule, { preview: true, logger: ['error', 'warn'] });
app.setGlobalPrefix(config.apiPrefix, { exclude: [{ path: '/', method: RequestMethod.GET }] });
const document = buildOpenApiDocument(app, config);

const output = resolve(process.env.OPENAPI_OUTPUT ?? '../docs/api/openapi.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(document, null, 2) + '\n', 'utf8');
console.log(`OpenAPI ${document.info.version}: ${Object.keys(document.paths).length} paths -> ${output}`);
await app.close();
