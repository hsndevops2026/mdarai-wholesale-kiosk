import { defineConfig } from 'prisma/config';

// DATABASE_URL comes from the environment (docker-compose, Railway, or a local .env loaded by the shell).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://kiosk:kiosk@localhost:5432/kiosk',
  },
});
