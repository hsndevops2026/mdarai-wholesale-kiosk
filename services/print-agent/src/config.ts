export type PrinterMode = 'simulated' | 'network' | 'stdout';

export interface AgentConfig {
  apiUrl: string;
  token: string;
  agentId: string;
  mode: PrinterMode;
  printerHost: string;
  printerPort: number;
  /** Printable width in dots: 576 for 80 mm paper, 384 for 58 mm (at 203 dpi). */
  paperWidthDots: number;
  outputDir: string;
  journalFile: string;
  pollIntervalMs: number;
  storeName: string;
  timeZone: string;
  /** Simulated printer only: fail the first N prints (to exercise retries). */
  simulateFailures: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const token = env.PRINT_AGENT_TOKEN ?? '';
  if (token.length < 16) throw new Error('PRINT_AGENT_TOKEN must be set (>= 16 chars)');
  const mode = (env.PRINTER_MODE ?? 'simulated') as PrinterMode;
  if (!['simulated', 'network', 'stdout'].includes(mode)) throw new Error('PRINTER_MODE must be simulated, network or stdout');
  const outputDir = env.PRINT_OUTPUT_DIR ?? './print-output';
  return {
    apiUrl: (env.API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
    token,
    agentId: env.PRINT_AGENT_ID ?? 'store-1',
    mode,
    printerHost: env.PRINTER_HOST ?? '192.168.1.50',
    printerPort: Number(env.PRINTER_PORT ?? 9100),
    paperWidthDots: Number(env.PAPER_WIDTH_DOTS ?? 576),
    outputDir,
    journalFile: env.PRINT_JOURNAL_FILE ?? `${outputDir}/printed-jobs.log`,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 3000),
    storeName: env.STORE_NAME ?? 'MdarAi Wholesale',
    timeZone: env.BUSINESS_TIMEZONE ?? 'Asia/Jerusalem',
    simulateFailures: Number(env.SIMULATE_PRINT_FAILURES ?? 0),
  };
}
