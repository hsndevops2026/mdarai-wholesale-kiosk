import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CatalogService } from './core/catalog.service';
import { loadConfig } from './core/config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  // Behind Railway / reverse proxies: trust the first hop for client IPs (rate limiting, audit).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '256kb' });
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: false });
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableShutdownHooks();
  await app.get(CatalogService).reload();
  await app.listen(cfg.PORT, '0.0.0.0');
  Logger.log(`API listening on :${cfg.PORT}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Do not print env values; the config loader only reports which variables are invalid.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
