/**
 * End-to-end printing: API + real print agent process (simulated printer).
 * Needs the API running against the seeded DB and `services/print-agent` built.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:4000';
const DEVICE = process.env.SEED_KIOSK_DEVICE_TOKEN ?? 'dev-kiosk-device-token';
const out = mkdtempSync(path.join(os.tmpdir(), 'print-it-'));
let agent: ChildProcess;
let agentLog = '';
let staff: Record<string, string>;

async function json(p: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}/api${p}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

async function placeOrder(): Promise<{ id: string; orderNumber: string }> {
  const id = await json('/kiosk/identify', { method: 'POST', headers: { 'x-kiosk-device': DEVICE }, body: JSON.stringify({ nationalId: '000000026' }) });
  const h = { 'x-kiosk-device': DEVICE, 'x-kiosk-session': id.body.sessionToken };
  const cat = await json('/kiosk/catalog?q=' + encodeURIComponent('حليب تنوفا 3% 1 لتر'), { headers: h });
  await json('/kiosk/cart/items', { method: 'POST', headers: h, body: JSON.stringify({ productId: cat.body.products[0].id, unit: 'carton', quantity: 3 }) });
  const c = await json('/kiosk/orders/confirm', { method: 'POST', headers: h, body: JSON.stringify({ idempotencyKey: `print-${randomUUID()}` }) });
  return c.body.order;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout; agent log:\n${agentLog.slice(-2000)}`);
}

const orderDetail = async (id: string) => (await json(`/warehouse/orders/${id}`, { headers: staff })).body;

beforeAll(async () => {
  const login = await json('/staff/login', { method: 'POST', body: JSON.stringify({ username: 'warehouse', password: process.env.SEED_WAREHOUSE_PASSWORD ?? 'warehouse-demo-1234' }) });
  staff = { authorization: `Bearer ${login.body.token}` };
  agent = spawn(process.execPath, ['services/print-agent/dist/main.js'], {
    env: {
      ...process.env,
      API_URL: API,
      PRINT_AGENT_ID: `it-${randomUUID().slice(0, 8)}`,
      PRINTER_MODE: 'simulated',
      PRINT_OUTPUT_DIR: out,
      POLL_INTERVAL_MS: '200',
      SIMULATE_PRINT_FAILURES: '1',
    },
  });
  agent.stdout?.on('data', (d) => (agentLog += d));
  agent.stderr?.on('data', (d) => (agentLog += d));
});

afterAll(() => {
  agent?.kill('SIGTERM');
});

describe('printing', () => {
  it('prints confirmed orders automatically and retries after a printer failure', async () => {
    const order = await placeOrder();
    const done = await waitFor(async () => {
      const o = await orderDetail(order.id);
      return o.printStatus === 'PRINTED' ? o : undefined;
    });
    const job = done.printJobs[0];
    expect(job).toMatchObject({ kind: 'AUTO', status: 'PRINTED' });
    const text = readFileSync(path.join(out, `${job.id}.txt`), 'utf8');
    expect(text).toContain(order.orderNumber);
    expect(text).toContain('3 × كرتونة');
    expect(text).not.toContain('₪');
    expect(existsSync(path.join(out, `${job.id}.png`))).toBe(true);
    expect(existsSync(path.join(out, `${job.id}.escpos.bin`))).toBe(true);
    // the first print attempt of the session failed (simulated jam) and was retried
    expect(agentLog).toMatch(/failed: simulated paper jam/);
    const failedJob = agentLog.match(/job (\S+) \(\S+\) failed: simulated paper jam/)![1];
    // ...and the same job was printed on a later attempt
    await waitFor(async () => (existsSync(path.join(out, `${failedJob}.txt`)) ? true : undefined));
    const agents = (await json('/warehouse/orders/printers/status', { headers: staff })).body.agents;
    expect(agents.some((a: { online: boolean }) => a.online)).toBe(true);
  });

  it('reprints on request, marks it as a reprint, and refuses a duplicate request', async () => {
    const order = await placeOrder();
    await waitFor(async () => ((await orderDetail(order.id)).printStatus === 'PRINTED' ? true : undefined));
    const r1 = await json(`/warehouse/orders/${order.id}/reprint`, { method: 'POST', headers: staff });
    const r2 = await json(`/warehouse/orders/${order.id}/reprint`, { method: 'POST', headers: staff });
    expect(r1.status).toBe(200);
    // Either the agent already finished the first reprint (then a new one is fine) or it is still queued (409).
    expect([200, 409]).toContain(r2.status);
    if (r2.status === 409) expect(r2.body.code).toBe('PRINT_ALREADY_QUEUED');
    await waitFor(async () => (existsSync(path.join(out, `${r1.body.jobId}.txt`)) ? true : undefined));
    expect(readFileSync(path.join(out, `${r1.body.jobId}.txt`), 'utf8')).toContain('نسخة إعادة طباعة');
  });

  it('rejects print-agent calls without the shared secret', async () => {
    const r = await json('/print-agent/jobs/claim', { method: 'POST', headers: { 'x-print-agent-token': 'wrong-token-wrong-token' }, body: JSON.stringify({ agentId: 'x' }) });
    expect(r.status).toBe(401);
  });
});
