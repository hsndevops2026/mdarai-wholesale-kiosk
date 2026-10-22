# Implementation plan

Legend: ✅ done and verified · 🟡 implemented, not verified against the real thing · ⬜ not started

## Phase 1 — Architecture and foundation ✅

- ✅ pnpm monorepo: `apps/api`, `apps/web`, `packages/*`, `services/print-agent` (stub), `tests/*`, `docs/*`
- ✅ Prisma schema and init migration (20 tables), plus hand-written SQL: `pg_trgm` indexes, CHECK constraints, tier-overlap exclusion constraint
- ✅ NestJS API foundation: config validation, Prisma, audit log, rate limiting, guards, health check
- ✅ Next.js 16 web foundation: RTL Arabic, Tailwind 4, MdarAi colors
- 🟡 Dockerfiles and `docker-compose.yml`. Compose syntax validates, and the API production bundle and Next standalone server were smoke-tested outside Docker. **The images have not been built**, because there is no Docker daemon in the build environment.
- ✅ `ARCHITECTURE.md`, this plan, README, `.env.example`

## Phase 2 — Functional ordering (text) ✅

- ✅ Fictional seed: 116 products (Arabic and Hebrew names, aliases), 3 customers, customer prices, quantity tiers, demo staff users, demo kiosk device
- ✅ Pricing engine: precedence, tiers, overlap validation, VAT, decimal-safe
- ✅ Product matcher: Arabic/Hebrew normalisation, synonyms, aliases, ambiguity handling
- ✅ Rule-based order parser: all 9 operations, Palestinian Arabic and Hebrew numbers, units, duals, و-splitting, "بدل" replacement, pronoun references
- ✅ Kiosk API: identify, session, catalog with customer prices, cart CRUD, commands, clarifications, confirm
- ✅ Kiosk UI: keypad, typed order box, clarification cards, catalog and search, touch cart, review, confirmation, idle warning and auto-logout
- ✅ Warehouse UI (basic): login, live list over websocket, details, status changes
- ✅ Excel/CSV import: reads the store's template as-is (`Products` sheet) plus optional carton columns and `Customers` / `Customer_Prices` / `Price_Tiers` sheets. Preview with row-level errors, DB cross-checks, diff, one-time commit, re-validation at commit. Template download and catalog export (round trip verified: 118/118 unchanged)
- ✅ Admin UI: import, kiosk device registration (token shown once) and deactivation
- ⬜ Admin UI for editing customers and prices one by one (use Excel for now)

## Phase 3 — Voice ⬜

- Speech provider abstraction (`packages/speech-providers`): `mock`, `openai`, `elevenlabs`, with a server-side proxy so API keys never reach the tablet
- Browser capture: `getUserMedia` with `noiseSuppression`/`echoCancellation`, VAD, mic status, retry on network loss
- Partial transcript display, with final-only submission (already enforced server-side)
- Voice answers to clarifications ("التاني", "كراتين", "خمسة")
- Evaluation harness: recorded fixtures → measure transcription WER and extraction accuracy **separately**
- Optional: `ORDER_PARSER=openai`, kept only if it beats the rules on recordings

## Phase 4 — Warehouse and printing ⬜

- Print job API (claim / complete / fail, retry with backoff, stale-claim recovery, authorized reprint)
- Print agent: ESC/POS over TCP 9100 (network thermal printer), plus a simulated printer for tests
- Picking slip layout: order number, customer code, aisle/shelf (from the store template), SKU, name, quantity, unit
- Warehouse UI: print status and reprint (the button exists, the endpoint comes in this phase)

## Phase 5 — Testing and deployment ⬜

- 30+ recorded voice requests from real users with store background noise
- Railway (API + Postgres + migrate job) and Vercel or Railway (web). **Nothing gets deployed without explicit approval.**
- Backups, error monitoring, runbooks, user guide

## Open questions for the store (block correctness, not the code)

1. Are wholesale prices quoted before or after VAT? (Currently `PRICES_INCLUDE_VAT=false`.)
2. The template has one unit and one price per product. Do you sell by the carton? If yes: pieces per carton and carton prices (new optional columns). Where are customer-specific prices kept today?
3. Which tablet (iPad or Android) and which printer (model, 58 or 80 mm, network or USB)?
4. When several variants match ("حليب تنوفا"), should one be the default (via alias), or should the system always ask?
5. Security before production: which second factor (PIN, SMS OTP, staff approval)? See `docs/architecture/security-review.md`.
