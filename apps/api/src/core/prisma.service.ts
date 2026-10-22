import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@mdarai/database';
import { APP_CONFIG, type AppConfig } from './config';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.client = createPrismaClient(cfg.DATABASE_URL);
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}

/** Prisma interactive-transaction client type. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
