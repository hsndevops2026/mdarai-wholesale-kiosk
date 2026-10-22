import { httpApi, runLoop } from './agent';
import { loadConfig } from './config';
import { PrintJournal } from './journal';
import { createPrinter } from './printers';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

async function main() {
  const cfg = loadConfig();
  const printer = createPrinter(cfg);
  const journal = new PrintJournal(cfg.journalFile);
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => controller.abort());
  log(`print agent "${cfg.agentId}" -> ${cfg.apiUrl}, printer ${printer.name}, paper ${cfg.paperWidthDots} dots`);
  await runLoop(cfg, httpApi(cfg), printer, journal, log, controller.signal);
  log('stopped');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
