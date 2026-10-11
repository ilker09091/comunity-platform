import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp, setupSwagger } from './setup-app.js';

async function bootstrap() {
  const json = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'json';
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    logger: new ConsoleLogger({ json, colors: !json }),
  });
  const config = configureApp(app);
  setupSwagger(app, config);
  await app.listen(config.port);

  const base = `${config.publicBaseUrl}/${config.apiPrefix}`;
  Logger.log(`API listening on ${base}`, 'Bootstrap');
  if (config.swaggerEnabled) Logger.log(`Swagger UI: ${base}/${config.swaggerPath}  JSON: ${base}/${config.swaggerPath}-json`, 'Bootstrap');
}
await bootstrap();
