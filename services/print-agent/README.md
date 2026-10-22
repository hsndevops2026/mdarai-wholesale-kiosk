# Print agent

A small Node.js program that runs **inside the store** (any always-on PC, mini-PC or Raspberry Pi on the same network as the printer). It:

1. polls the API every few seconds (`POST /api/print-agent/jobs/claim`), outbound only, so **no ports need to be opened** on the store's router,
2. renders the picking slip as an image (Arabic and Hebrew shaped correctly, so the printer does not need Arabic fonts),
3. sends it to the thermal printer as ESC/POS raster over raw TCP port 9100,
4. reports `complete` or `fail` back to the API.

The slip has the order number, customer code and name, and per line: quantity and unit, product name (Arabic and Hebrew), aisle-shelf, SKU, and pieces per carton. **Prices are not printed.** Lines are sorted by aisle and shelf for a faster picking walk. Reprints carry a black «نسخة إعادة طباعة» banner.

## Reliability

| Situation | What happens |
|---|---|
| Printer off, out of paper, unreachable | job reported as failed, retried after 5 s, 10 s, 20 s… (max 5 min apart, 5 attempts), then marked **FAILED** on the warehouse screen. Staff can reprint |
| Agent crashes or loses network mid-print | the job is reclaimed after `PRINT_CLAIM_TIMEOUT_SECONDS` (API, default 120 s). The local journal (`printed-jobs.log`) records jobs that were physically printed, so a reclaimed job is **confirmed without printing a second copy** |
| API unreachable | agent keeps retrying with backoff up to 60 s. Jobs wait safely in the database |
| Two agents running | `FOR UPDATE SKIP LOCKED` makes each job go to exactly one agent |
| Double-tap on «إعادة طباعة» | refused while a reprint of the same order is still queued |

## Setup

Requirements: Node 22. A network ESC/POS thermal printer (80 mm = 576 dots, 58 mm = 384 dots at 203 dpi) with a **fixed IP**.

```bash
pnpm install && pnpm --filter @mdarai/print-agent build
export API_URL=https://<your-api>          # the API's public URL
export PRINT_AGENT_TOKEN=<same value as on the API>
export PRINT_AGENT_ID=store-1
export PRINTER_MODE=network                # simulated | network | stdout
export PRINTER_HOST=192.168.1.50 PRINTER_PORT=9100
export PAPER_WIDTH_DOTS=576                # 384 for 58 mm paper
export STORE_NAME="اسم المحل"
pnpm --filter @mdarai/print-agent start
```

Run it as a service so it starts with the machine (see `docs/deployment/print-agent-service.md`).

`PRINTER_MODE=simulated` writes `<jobId>.png`, `.txt` and `.escpos.bin` to `PRINT_OUTPUT_DIR` instead of printing. Use it for testing without a printer.

**Not yet verified on a physical printer.** USB-only printers need a small adapter (CUPS or Windows spooler raw queue). Send us the printer model and we will add it.

Fonts: Noto Sans Arabic and Noto Sans Hebrew (SIL Open Font License, `fonts/OFL.txt`).
