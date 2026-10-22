# Security review: customer identification

## Current (demo) behaviour

A customer types a national ID number on the kiosk keypad and gets a session with their prices and the ability to submit orders.

What is already in place:

- The identify endpoint requires a registered kiosk device token, so it cannot be called from the internet without one.
- IDs are validated (check digit), stored only as HMAC-SHA256 with a server-side pepper, and never logged.
- Failed attempts are audited (without the number). After 5 failures per device in 10 minutes, the device is locked.
- Rate limits apply per IP. Sessions are bound to the device, expire after 180 s idle or 30 min total, and wipe the cart on end.
- Orders still require an explicit touch confirmation, and warehouse staff see who ordered.

## Why this is not enough for production

A national ID number is **an identifier, not a secret**. It appears on invoices, forms and photocopies, and family members and employees know it. Anyone standing at the tablet who knows (or guesses) a customer's ID can:

1. see that customer's **confidential negotiated prices** (commercially sensitive between competing shops), and
2. **submit orders in their name**.

The device lockout slows down guessing but does not stop an insider who knows a specific ID.

Israel's Privacy Protection Law (including Amendment 13, in force since August 2025) also raises the bar for processing ID numbers. A legal review of retention and purpose is recommended before go-live.

## Options (pick one before production)

| Option | Customer friction | Protects prices | Protects orders | Notes |
|---|---|---|---|---|
| **A. ID + 4-digit PIN** set at the counter | low | yes | yes | Recommended default. PIN hashed (scrypt), lockout per customer. A forgotten PIN is reset by staff |
| B. ID + SMS one-time code | medium (needs phone, SMS cost) | yes | yes | Needs an SMS provider (cost). Phone number must be on file |
| C. ID only, but prices hidden until staff approves | low | partly | yes | Order arrives as "pending approval", staff confirm by phone or at the counter |
| D. Customer QR card / NFC tag | low | yes (if the card is kept safe) | yes | Card printing and loss handling |
| E. ID + staff approves each session on the warehouse screen | medium (staff time) | yes | yes | Good for a single small store |

**Recommendation:** A (PIN) for go-live, optionally combined with C for first-time or high-value orders. The data model already allows it: add `pinHash` and `failedPinCount` to `Customer` and a second keypad step.

## Other production checklist items

- Rotate `ID_HASH_PEPPER`, `PRINT_AGENT_TOKEN` and the seed passwords. Never use the demo values.
- Restrict `CORS_ORIGINS` to the real web origin.
- Put the tablet in kiosk mode (Android: screen pinning / managed device. iPad: Guided Access) so customers cannot open other sites or dev tools.
- TLS everywhere (Railway/Vercel provide it). The print agent only makes outbound HTTPS calls.
- Database backups with tested restore (Railway snapshots plus a periodic `pg_dump`).
- Retention policy for `ProcessedUtterance.transcript` (speech text) and `AuditLog`.
