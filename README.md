# MdarAi Wholesale Voice AI Kiosk

A touchscreen ordering kiosk for wholesale stores in Israel. Customers identify themselves, say or type their order in Palestinian Arabic (with Hebrew product names mixed in), fix it by voice or touch, and confirm. The order then appears on the warehouse dashboard.

> **Status:** Phases 1–2. The text ordering flow works end to end with fictional data. Voice input, Excel import, printing and cloud deployment are not built yet. See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).
> Customer identification by national ID is **demo-only**. Read [`docs/architecture/security-review.md`](docs/architecture/security-review.md) before any production use.

## Layout

```
apps/api              NestJS REST + socket.io API
apps/web              Next.js app: /kiosk, /warehouse (and /admin later)
packages/shared-types Zod schemas + shared view types
packages/database     Prisma schema, migrations, seed (fictional data)
packages/pricing-engine   deterministic pricing (decimal.js)
packages/product-matcher  Arabic/Hebrew catalog matching
packages/ai-order-parser  rule-based parser + optional OpenAI parser
packages/speech-providers STT abstraction (phase 3)
services/print-agent  in-store print agent (phase 4)
tests/                integration, e2e (Playwright), voice fixtures
docs/                 architecture, API, deployment, user guide
```

Design and decisions: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Run locally

Requirements: Node 22, pnpm 10, PostgreSQL 16 with the `pg_trgm` and `btree_gist` extensions (included in the standard postgres packages and Docker image).

```bash
cp .env.example .env            # dev defaults, fictional data only
pnpm install
createdb kiosk                  # or: docker compose up -d db
set -a; . ./.env; set +a
pnpm db:migrate && pnpm db:seed
pnpm build:packages
pnpm --filter @mdarai/api build && pnpm --filter @mdarai/api start     # http://localhost:4000
pnpm --filter @mdarai/web dev                                            # http://localhost:3000
```

Or run everything in Docker: `docker compose up --build` (see the note in IMPLEMENTATION_PLAN about verification).

### Demo data (fictional)

| What | Value |
|---|---|
| Kiosk device token (enter once on `/kiosk`) | `dev-kiosk-device-token` |
| Customer IDs | `000000018` (أبو أحمد, has special prices), `000000026` (أم خالد), `000000034` (سامر) |
| Warehouse login | `warehouse` / `warehouse-demo-1234` |
| Admin login | `admin` / `admin-demo-1234` |

Try on the kiosk: «بدي خمس كراتين חלב תנובה وثلاث كراتين زيت», pick the variants, then «خلي الحليب سبع كراتين بدل خمس».

## Tests

```bash
pnpm test:unit                       # pricing, matcher, parser (34 extraction sentences), OpenAI parser (mocked)
pnpm test:integration                # needs the API running against the seeded DB
PW_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e   # browser test of the full kiosk flow
```

## Maintenance

- Catalog changes made in the DB are picked up by the API within 5 minutes (in-memory cache).
- Schema changes: edit `packages/database/prisma/schema.prisma`, then `pnpm --filter @mdarai/database exec prisma migrate dev --name <change>`.
- Matching vocabulary: add product aliases (per product) or synonym groups (`SynonymGroup` table) instead of changing code.
