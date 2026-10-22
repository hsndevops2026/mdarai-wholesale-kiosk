import type { AgentConfig } from './config';
import { PrintJournal } from './journal';
import type { Printer } from './printers';
import { renderSlip } from './slip';
import type { SlipPayload } from './types';

export interface AgentApi {
  claim(): Promise<SlipPayload | null>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: string): Promise<void>;
}

export function httpApi(cfg: AgentConfig): AgentApi {
  const call = async (path: string, body: object) => {
    const res = await fetch(`${cfg.apiUrl}/api/print-agent/jobs${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-print-agent-token': cfg.token },
      body: JSON.stringify({ agentId: cfg.agentId, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
    return res.json();
  };
  return {
    claim: () => call('/claim', {}) as Promise<SlipPayload | null>,
    complete: async (id) => void (await call(`/${id}/complete`, {})),
    fail: async (id, error) => void (await call(`/${id}/fail`, { error })),
  };
}

export type Log = (msg: string) => void;

/** Process at most one job. Returns what happened (used by the loop and tests). */
export async function runOnce(cfg: AgentConfig, api: AgentApi, printer: Printer, journal: PrintJournal, log: Log): Promise<'idle' | 'printed' | 'confirmed' | 'failed'> {
  const job = await api.claim();
  if (!job) return 'idle';
  if (journal.has(job.jobId)) {
    // Printed before a crash/network loss: confirm, do not print again.
    await api.complete(job.jobId);
    log(`job ${job.jobId} (${job.order.orderNumber}) was already printed; confirmed without reprinting`);
    return 'confirmed';
  }
  try {
    const slip = renderSlip(job, { width: cfg.paperWidthDots, storeName: cfg.storeName, timeZone: cfg.timeZone });
    await printer.print(job.jobId, slip);
  } catch (err) {
    const msg = (err as Error).message;
    log(`job ${job.jobId} (${job.order.orderNumber}) failed: ${msg}`);
    await api.fail(job.jobId, msg);
    return 'failed';
  }
  journal.add(job.jobId);
  log(`printed ${job.order.orderNumber} (${job.kind}, attempt ${job.attempt}) on ${printer.name}`);
  try {
    await api.complete(job.jobId);
  } catch (err) {
    // The journal guarantees the reclaimed job will not print twice.
    log(`printed but could not confirm ${job.jobId}: ${(err as Error).message}`);
  }
  return 'printed';
}

export async function runLoop(cfg: AgentConfig, api: AgentApi, printer: Printer, journal: PrintJournal, log: Log, signal: AbortSignal) {
  let backoff = cfg.pollIntervalMs;
  while (!signal.aborted) {
    let result: string;
    try {
      result = await runOnce(cfg, api, printer, journal, log);
      backoff = cfg.pollIntervalMs;
    } catch (err) {
      log(`API unreachable: ${(err as Error).message}; retrying in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    // Drain the queue quickly; poll slowly when idle.
    if (result === 'idle') await sleep(cfg.pollIntervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
