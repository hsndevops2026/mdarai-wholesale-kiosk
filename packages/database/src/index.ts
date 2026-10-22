import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeText } from '@mdarai/product-matcher';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';
export * from './crypto';

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Text indexed with pg_trgm for catalog search. */
export function buildSearchText(p: {
  sku: string;
  nameAr: string;
  nameHe?: string | null;
  brand?: string | null;
  variant?: string | null;
  size?: string | null;
  aliases?: string[];
}): string {
  return normalizeText([p.sku, p.nameAr, p.nameHe, p.brand, p.variant, p.size, ...(p.aliases ?? [])].filter(Boolean).join(' '));
}
