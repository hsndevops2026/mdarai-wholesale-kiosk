# Architecture — MdarAi Wholesale Voice AI Kiosk

Status: Phase 1–2 implemented (text ordering end to end). Voice, Excel import, printing and deployment are in later phases (see `IMPLEMENTATION_PLAN.md`).

## 1. Shape of the system

```
 Tablet (kiosk, Chrome)          Warehouse PC (browser)           In-store PC / Raspberry Pi
 ┌──────────────────────┐        ┌──────────────────────┐         ┌───────────────────────┐
 │ apps/web  /kiosk     │        │ apps/web  /warehouse │         │ services/print-agent  │
 │ keypad, catalog,     │        │ live order list,     │         │ polls print jobs,     │
 │ cart, mic (phase 3)  │        │ status, reprint      │         │ ESC/POS -> printer    │
 └─────────┬────────────┘        └──────────┬───────────┘         └──────────┬────────────┘
           │ REST (device + session token)  │ REST + socket.io (staff token)  │ REST (agent token), outbound only
           └──────────────────────┬─────────┴─────────────────────────────────┘
                                  ▼
                     ┌─────────────────────────────┐
                     │ apps/api (NestJS 11)        │
                     │  kiosk auth / sessions      │
                     │  CartService ─┬─ ParserService ── rules parser (default) / OpenAI (+rules fallback)
                     │               ├─ CatalogService ── ProductMatcher (in-memory, catalog-grounded)
                     │               └─ PricingService ── pricing-engine (pure, decimal.js)
                     │  OrderService (idempotent confirm, order numbers, print job)
                     │  WarehouseGateway (socket.io)│
                     └──────────────┬──────────────┘
                                    ▼
                     PostgreSQL 16 (Prisma 7, pg_trgm, btree_gist)
```

One Next.js app serves `/kiosk`, `/warehouse` and `/admin` instead of three separate frontends: one build and one deployment, with access separated by tokens and roles on the API. They can be split later without API changes.

## 2. The voice-to-cart pipeline

```
mic ─► STT provider ─► partial transcript (display only)
                    └► FINAL transcript ─► POST /api/kiosk/cart/commands {utteranceId, text}
                                             │
                    ParserService ◄──────────┘  (no DB access; returns commands only)
                         │ ParsedUtterance (Zod-validated)
                         ▼
          for each item: resolve product ─► ProductMatcher (cart first for edits, then catalog)
                         │      MATCHED → apply      AMBIGUOUS / NOT_FOUND → Clarification row
                         ▼
          unit + quantity checks ─► apply to CartItem (inside a per-session advisory lock)
                         ▼
          PricingService recomputes every line ─► CommandResult {applied, messages, clarifications, cart}
```

Guarantees:

- **The LLM never touches data.** Parsers return `ParsedUtterance` (`packages/shared-types`). It is validated with a strict Zod schema with no extra keys, so a model that adds a `price` field is rejected. Products, prices, discounts and carton sizes come only from the database.
- **No uncertain auto-selection.** The matcher only auto-selects when the best candidate scores ≥ 0.78 *and* leads the runner-up by ≥ 0.10. Fuzzy (edit-distance) hits are weighted down, so a fuzzy-only match can never be auto-selected. Anything else becomes a touch clarification.
- **Partial transcripts never reach the cart.** Only final transcripts are posted, and every post carries an `utteranceId`. A retry with the same id returns the stored result (`ProcessedUtterance`, unique per session) instead of applying it again.
- **Replace vs add.** `SET_QUANTITY` ("خلي الحليب سبع كراتين بدل خمس") sets the quantity. `ADD_ITEM` and `INCREASE_QUANTITY` add to an existing line. Anything after "بدل/במקום" is ignored.
- **Concurrency.** All cart mutations of a session run inside `pg_advisory_xact_lock(hashtext(sessionId))`, so the guarantee also holds across several API instances.

### Parsers

| Parser | Cost | Status |
|---|---|---|
| `RuleBasedOrderParser` (`packages/ai-order-parser/src/rule-parser.ts`) | free, offline, ~0.1 ms | default. 34 acceptance sentences pass. Lexicon for Palestinian Arabic numbers (including duals: كرتونتين، حبتين), units, verbs, Hebrew numbers and units, و-splitting |
| `OpenAiOrderParser` | paid | implemented with structured outputs (JSON schema generated from Zod). Not yet evaluated against real speech. Always wrapped in `FallbackOrderParser` → rules |

The rule parser is deliberately kept as the baseline and the fallback. If the store's internet or the LLM fails, ordering continues.

### Product matching (`packages/product-matcher`)

- Normalisation for Arabic (alef/ya/ta-marbuta variants, diacritics, tatweel, Arabic-Indic digits) and Hebrew (niqqud, final letters). Definite-article and conjunction prefixes (ال/وال/بال, ה/וה) are stripped as token variants.
- Cross-language synonym groups (حليب↔חלב, زيت↔שמן, تنوفا↔תנובה…), editable in the `SynonymGroup` table.
- Per-product aliases (`ProductAlias`). An alias equal to a generic word ("طحينة" on the 500 g SKU) makes that SKU the default for the generic word. This is how the store expresses "when they say X they mean this one".
- Scoring = 0.75 × query coverage + 0.25 × name precision. Short tokens (≤ 3 letters) and numeric/size tokens must match exactly, so "زيت" does not match "زيتون" and "1%" does not match "3%".
- The catalog (≤ 5,000 products) is held in memory and matched in a few ms. A benchmark test over 5,200 products checks this. PostgreSQL `pg_trgm` GIN indexes exist on `Product.searchText` and `ProductAlias.aliasNorm` for SQL-side search if the catalog grows beyond memory. A dedicated search engine is not justified at this size.

## 3. Pricing (`packages/pricing-engine`)

Pure functions over decimal strings (decimal.js, ROUND_HALF_UP to agorot).

Precedence per line (first match wins):

1. customer-specific quantity tier (`PriceTier.customerId = customer`)
2. customer-specific unit price (`CustomerPrice`)
3. default quantity tier (`PriceTier.customerId = null`). This level was added between the requested 2 and 3 so store-wide volume discounts are possible.
4. default unit price (`Product.defaultPiecePrice` / `defaultCartonPrice`)

- Carton prices are never derived from piece prices. A `null` price means the unit is not sold.
- PERCENT_OFF tiers apply to the customer's unit price when one exists, else to the default.
- Overlapping tiers are rejected twice: in code (`validateTiers`, used by import) and in the database (`EXCLUDE USING gist … int4range && …`).
- VAT is configurable (`VAT_RATE=0.18`, `PRICES_INCLUDE_VAT=false`). The default assumes wholesale prices exclude VAT. **This must be confirmed with the store.**
- Prices are recalculated on every cart change and again on confirmation. `OrderItem` stores the full snapshot (list price, unit price, discount, rule, tier id).

## 4. Sessions and security model

| Actor | Credential | Notes |
|---|---|---|
| Kiosk device | `x-kiosk-device` token (SHA-256 stored) | Provisioned once per tablet. Without it the identify endpoint is unreachable, which blocks ID enumeration from the internet |
| Customer | national ID → `x-kiosk-session` token | **Demo-only identification**, see `docs/architecture/security-review.md`. 180 s idle timeout, 30 min max. One active session per device. Cart and clarifications are deleted when a session ends |
| Staff | username/password (scrypt) → bearer token | roles `WAREHOUSE`, `ADMIN`, 12 h sessions |
| Print agent | `x-print-agent-token` shared secret | outbound polling only, no inbound ports in the store |

- National IDs are stored only as `HMAC-SHA256(ID_HASH_PEPPER, id)` and never logged. Failed attempts are audited without the number.
- After 5 failed identifications per device in 10 minutes, identification is locked for that device.
- Global rate limit (`RATE_LIMIT_PER_MINUTE`), with stricter limits on identify (10/min) and staff login (10/min).
- `AuditLog` records session start/end, commands (intents and counts only), order confirmation and status changes.

## 5. Orders

`POST /api/kiosk/orders/confirm {idempotencyKey}` is the **only** way to create an order. Speech can never confirm. The client generates the key once when the review screen opens. A retry returns the same order, even after the session has ended. A key reused by another session is rejected.

Inside one transaction under the session lock: it validates the session, rejects open clarifications and an empty cart, re-validates products and units, recalculates prices, allocates the order number (`W-YYYYMMDD-NNNN`, per-day counter in `Asia/Jerusalem`), creates the order with its price snapshot and an AUTO print job (`dedupeKey` unique), writes an audit entry, and ends the session. After commit it emits `order.created` to the warehouse websocket.

Fulfilment status (`NEW → PREPARING → READY → DELIVERED`, or `CANCELLED`) is tracked separately from print status (`PENDING/PRINTING/PRINTED/FAILED`). Transitions are whitelisted and use optimistic concurrency.

## 6. Key decisions

| Decision | Why |
|---|---|
| pnpm monorepo, CommonJS packages built with `tsc` | NestJS decorators need `emitDecoratorMetadata`. Shared packages are consumed by API, web and print agent |
| Prisma 7 with `@prisma/adapter-pg` | current stable major. Prisma 8 was still a release candidate when this was written |
| NestJS 11, Next.js 16, TypeScript 5.9 | stable, widely documented versions. NestJS 12 and TypeScript 7 had just been released |
| Rule parser first, LLM optional | free, testable, deterministic baseline. The LLM is only kept if it measurably beats the rules on real recordings |
| In-memory matcher over SQL search | 5,000 products fit in memory. Deterministic, unit-testable, a few ms per query |
| Advisory locks for cart mutations | correct under retries, double taps and several API instances |
| Single web app | one deploy, shared UI code |
| Not using n8n in the order path | the core flow must work without it. n8n can subscribe to events later (reports, notifications) |
