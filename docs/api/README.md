# API reference (v0, phases 1–2)

Base URL: `{API}/api`. JSON in and out. Errors: `{ code, message }` with an Arabic `message` for display.

Headers: `x-kiosk-device` (kiosk device token), `x-kiosk-session` (customer session), `Authorization: Bearer <staff token>`.

## Kiosk (device token required)

| Method | Path | Auth | Body / query | Returns |
|---|---|---|---|---|
| POST | `/kiosk/identify` | device | `{nationalId}` | `{sessionToken, expiresAt, idleTimeoutSeconds, customer}` |
| GET | `/kiosk/session` | session | – | customer, cart, clarifications |
| POST | `/kiosk/heartbeat` | session | – | 204 |
| POST | `/kiosk/logout` | session | – | 204 (cart wiped) |
| GET | `/kiosk/catalog` | session | `q, category, take, skip` | `{total, products[]}` with customer prices |
| GET | `/kiosk/categories` | session | – | `{categories[]}` |
| GET | `/kiosk/cart` | session | – | `{cart, clarifications}` |
| POST | `/kiosk/cart/items` | session | `{productId, unit, quantity}` | `{cart}` (adds to existing line) |
| PATCH | `/kiosk/cart/items/:id` | session | `{quantity?, unit?}` | `{cart}` |
| DELETE | `/kiosk/cart/items/:id` | session | – | `{cart}` |
| DELETE | `/kiosk/cart` | session | – | `{cart}` |
| POST | `/kiosk/cart/commands` | session | `{utteranceId, text, source}` (FINAL transcript only) | `CommandResult` |
| POST | `/kiosk/cart/clarifications/:id/resolve` | session | `{value}` | `CommandResult` |
| POST | `/kiosk/cart/clarifications/:id/dismiss` | session | – | `{clarifications}` |
| POST | `/kiosk/orders/confirm` | session (ended allowed for retries) | `{idempotencyKey}` | `{duplicate, order}` |

`CommandResult` (see `packages/shared-types`): `{utteranceId, transcript, parser, applied[], messages[], clarifications[], searchResults[], cart, duplicate}`.

Error codes: `RATE_LIMITED`, `DEVICE_REQUIRED`, `DEVICE_INVALID`, `CUSTOMER_NOT_FOUND`, `TOO_MANY_ATTEMPTS`, `SESSION_REQUIRED`, `SESSION_INVALID`, `SESSION_EXPIRED`, `SESSION_ENDED`, `VALIDATION_FAILED`, `UNIT_NOT_SOLD`, `CART_EMPTY`, `PENDING_CLARIFICATIONS`, `IDEMPOTENCY_KEY_REUSED`, `PRODUCT_UNAVAILABLE`.

## Staff

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/staff/login` | `{username, password}` | `{token, expiresAt, user}` |
| POST | `/staff/logout` | – | 204 |
| GET | `/staff/me` | – | user |
| GET | `/warehouse/orders` | `status=NEW,PREPARING&from&to&q&take&skip` | `{total, orders[]}` |
| GET | `/warehouse/orders/:id` | – | order with items, print jobs, status history |
| POST | `/warehouse/orders/:id/status` | `{status}` | order (allowed transitions only) |
| POST | `/warehouse/orders/:id/reprint` | – | `{jobId, status}`. 409 `PRINT_ALREADY_QUEUED` while one is waiting |
| GET | `/warehouse/orders/printers/status` | – | `{agents: [{id, lastSeen, online}]}` |

## Print agent (header `x-print-agent-token`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/print-agent/jobs/claim` | `{agentId}` | 204 when idle, else the slip payload (no prices) |
| POST | `/print-agent/jobs/:id/complete` | `{agentId}` | `{status}`, idempotent |
| POST | `/print-agent/jobs/:id/fail` | `{agentId, error}` | `{status, nextAttemptAt}` |

## Admin (role ADMIN)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/admin/import/preview` | multipart `file` (.xlsx / .csv, ≤ 10 MB) | `{id, summary, issues[], changes[], canCommit}`. No data changes |
| POST | `/admin/import/:id/commit` | – | `{summary}`. Once per preview, valid 1 h, re-validated |
| GET | `/admin/import/template` | `?data=1` exports the current catalog | xlsx file |
| GET | `/admin/kiosk-devices` | – | `{devices[]}` |
| POST | `/admin/kiosk-devices` | `{name}` | `{id, name, token}`. The token is shown only once |
| POST | `/admin/kiosk-devices/:id/deactivate` | – | ends any open session on it |

## WebSocket

socket.io namespace `/warehouse`, `auth: { token: <staff token> }`. Events: `order.created`, `order.updated`, `print.updated` (payloads carry ids; fetch details over REST).

## Health

`GET /health` → `{status: "ok"}` (checks the DB).
