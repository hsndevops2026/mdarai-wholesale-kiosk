# Notes for AI coding agents

- Monorepo with pnpm workspaces. Packages compile with `tsc` to CommonJS `dist/`. After changing a package, rebuild it (`pnpm build:packages`) before running the API. Vitest aliases packages to their `src`.
- **Next.js 16** (`apps/web`): read `node_modules/next/dist/docs/` before using framework APIs. Request APIs are async, `middleware` is now `proxy`, Turbopack is the default.
- **Prisma 7**: generator `prisma-client` with output `packages/database/src/generated/prisma` (gitignored). A driver adapter (`@prisma/adapter-pg`) is required. Config lives in `packages/database/prisma.config.ts`.
- NestJS 11 needs `emitDecoratorMetadata`. Do not run the API through esbuild/tsx. Build with `tsc`.
- Invariants that must stay true:
  - LLM/parser output never writes to the DB directly and never supplies prices, SKUs or carton sizes.
  - Only `POST /api/kiosk/orders/confirm` creates orders, and only from a touch action.
  - Never auto-select an ambiguous product match.
  - Never log or store raw national IDs.
  - Cart mutations go through `CartService.withSessionLock`.
- Use fictional data only. Never commit `.env`.
