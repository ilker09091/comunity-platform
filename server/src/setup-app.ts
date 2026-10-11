import { INestApplication, RequestMethod } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { createValidationPipe } from './common/errors/validation.js';
import { BEARER_AUTH } from './common/swagger/api-docs.decorators.js';
import { appConfig } from './config/app.config.js';

export const API_VERSION = '1.3.0';

/** Global HTTP configuration shared by main.ts, e2e tests and the OpenAPI export script. */
export function configureApp(app: INestApplication): ConfigType<typeof appConfig> {
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const express = app as NestExpressApplication;

  if (config.trustProxy) express.set('trust proxy', config.trustProxy);
  express.disable('x-powered-by');
  app.use(
    helmet({
      // JSON API: CSP is set explicitly on media file responses; Swagger UI needs inline assets.
      contentSecurityPolicy: false,
      // Media is loaded cross-origin by the Next.js frontend.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Step-Up-Token'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.setGlobalPrefix(config.apiPrefix, { exclude: [{ path: '/', method: RequestMethod.GET }] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return config;
}

export function buildOpenApiDocument(app: INestApplication, config: ConfigType<typeof appConfig>): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Community Platform Social API')
    .setDescription(
      [
        'REST API for the social platform. All paths are relative to the server root and include the global prefix.',
        '',
        '**Auth:** send `Authorization: Bearer <accessToken>`. Obtain tokens from `/auth/register`, `/auth/login`, rotate with `/auth/refresh`.',
        '**Pagination:** cursor based — `{ items, nextCursor, hasMore }`; pass `nextCursor` back as `cursor`.',
        '**Errors:** `{ statusCode, code, message, details[] }` — branch on `code`.',
        '**Timestamps:** ISO 8601 UTC.',
      ].join('\n'),
    )
    .setVersion(API_VERSION)
    .addServer(config.publicBaseUrl)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_AUTH);

  return SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (controllerKey: string, methodKey: string) => {
      const base = controllerKey.replace(/Controller$/, '');
      return `${base.charAt(0).toLowerCase()}${base.slice(1)}${methodKey.charAt(0).toUpperCase()}${methodKey.slice(1)}`;
    },
  });
}

export function setupSwagger(app: INestApplication, config: ConfigType<typeof appConfig>): OpenAPIObject | null {
  if (!config.swaggerEnabled) return null;
  const document = buildOpenApiDocument(app, config);
  SwaggerModule.setup(`${config.apiPrefix}/${config.swaggerPath}`, app, document, {
    jsonDocumentUrl: `${config.apiPrefix}/${config.swaggerPath}-json`,
    yamlDocumentUrl: `${config.apiPrefix}/${config.swaggerPath}-yaml`,
    swaggerOptions: { persistAuthorization: true },
  });
  return document;
}
