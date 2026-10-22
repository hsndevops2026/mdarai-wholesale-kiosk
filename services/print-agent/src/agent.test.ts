import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runOnce, type AgentApi } from './agent';
import type { AgentConfig } from './config';
import { encodeRaster, toMonochrome } from './escpos';
import { PrintJournal } from './journal';
import { NetworkPrinter, SimulatedPrinter, type Printer } from './printers';
import { renderSlip, slipText } from './slip';
import type { SlipPayload } from './types';

const job = (id = 'job-1', kind: 'AUTO' | 'REPRINT' = 'AUTO'): SlipPayload => ({
  jobId: id,
  kind,
  attempt: 1,
  order: {
    orderNumber: 'W-20261022-0007',
    createdAt: '2026-10-22T08:15:00.000Z',
    customer: { code: 'C-1001', name: 'أبو أحمد', businessName: 'بقالة النور (وهمي)' },
    items: [
      { sku: 'DAI-001', barcode: null, nameAr: 'حليب تنوفا 3% 1 لتر', nameHe: 'חלב תנובה 3% 1 ליטר', unit: 'carton', quantity: 7, piecesPerCarton: 12, pieceLabel: null, aisle: 'A1', shelf: 'S02' },
      { sku: 'GRN-003', barcode: null, nameAr: 'رز بسمتي 1 كيلو', nameHe: null, unit: 'piece', quantity: 10, piecesPerCarton: 10, pieceLabel: 'كيس', aisle: null, shelf: null },
    ],
  },
});

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'pa-'));
const cfg = (dir: string): AgentConfig => ({
  apiUrl: 'http://x', token: 'x'.repeat(16), agentId: 'a1', mode: 'simulated', printerHost: '', printerPort: 0, paperWidthDots: 576,
  outputDir: dir, journalFile: path.join(dir, 'j.log'), pollIntervalMs: 10, storeName: 'Test', timeZone: 'Asia/Jerusalem', simulateFailures: 0,
});

function fakeApi(payloads: Array<SlipPayload | null>): AgentApi & { completed: string[]; failed: string[] } {
  const completed: string[] = [];
  const failed: string[] = [];
  return {
    completed,
    failed,
    claim: vi.fn(async () => payloads.shift() ?? null),
    complete: vi.fn(async (id: string) => void completed.push(id)),
    fail: vi.fn(async (id: string) => void failed.push(id)),
  };
}

describe('ESC/POS', () => {
  it('packs pixels into 1-bit rows', () => {
    const rgba = new Uint8ClampedArray(16 * 1 * 4).fill(255);
    rgba.set([0, 0, 0, 255], 0); // first pixel black
    rgba.set([0, 0, 0, 255], 9 * 4); // pixel 9 black
    const { bytesPerRow, bits } = toMonochrome(rgba, 16, 1);
    expect(bytesPerRow).toBe(2);
    expect([...bits]).toEqual([0x80, 0x40]);
  });
  it('emits init, GS v 0 raster bands and a cut', () => {
    const rgba = new Uint8ClampedArray(8 * 300 * 4).fill(255);
    const out = encodeRaster(rgba, 8, 300);
    expect([...out.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...out.subarray(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0, 1, 0, 0, 1]); // 256-row band
    expect([...out.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
});

describe('slip', () => {
  it('renders an image sized for 80 mm and 58 mm paper', () => {
    for (const width of [576, 384]) {
      const s = renderSlip(job(), { width, storeName: 'Test', timeZone: 'Asia/Jerusalem' });
      expect(s.width).toBe(width);
      expect(s.height).toBeGreaterThan(300);
      expect(s.height % 8).toBe(0);
      expect(s.png.subarray(1, 4).toString()).toBe('PNG');
    }
  });
  it('has no prices and marks reprints', () => {
    const t = slipText(job('j', 'REPRINT'), 'Test', 'Asia/Jerusalem');
    expect(t).toContain('W-20261022-0007');
    expect(t).toContain('7 × كرتونة');
    expect(t).toContain('10 × كيس');
    expect(t).toContain('نسخة إعادة طباعة');
    expect(t).not.toMatch(/₪|\d+\.\d\d/);
  });
});

describe('agent', () => {
  it('prints, journals and confirms a job', async () => {
    const dir = tmp();
    const api = fakeApi([job('j1')]);
    const r = await runOnce(cfg(dir), api, new SimulatedPrinter(dir), new PrintJournal(path.join(dir, 'j.log')), () => {});
    expect(r).toBe('printed');
    expect(api.completed).toEqual(['j1']);
  });

  it('reports printer failures to the API for retry', async () => {
    const dir = tmp();
    const api = fakeApi([job('j2')]);
    const r = await runOnce(cfg(dir), api, new SimulatedPrinter(dir, 1), new PrintJournal(path.join(dir, 'j.log')), () => {});
    expect(r).toBe('failed');
    expect(api.failed).toEqual(['j2']);
  });

  it('does not print twice when a printed job is reclaimed after a crash', async () => {
    const dir = tmp();
    const journal = new PrintJournal(path.join(dir, 'j.log'));
    const printer: Printer = { name: 'p', print: vi.fn(async () => {}) };
    const api = fakeApi([job('j3'), job('j3')]);
    (api.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));
    expect(await runOnce(cfg(dir), api, printer, journal, () => {})).toBe('printed');
    // restart: journal reloaded from disk
    const reloaded = new PrintJournal(path.join(dir, 'j.log'));
    expect(await runOnce(cfg(dir), api, printer, reloaded, () => {})).toBe('confirmed');
    expect(printer.print).toHaveBeenCalledTimes(1);
    expect(api.completed).toEqual(['j3']);
  });

  it('sends ESC/POS bytes to a network printer over TCP 9100-style raw socket', async () => {
    const received: Buffer[] = [];
    const server = net.createServer((s) => s.on('data', (d) => received.push(d)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    const slip = renderSlip(job(), { width: 384, storeName: 'T', timeZone: 'Asia/Jerusalem' });
    await new NetworkPrinter('127.0.0.1', port).print('j', slip);
    await new Promise((r) => setTimeout(r, 50));
    server.close();
    const all = Buffer.concat(received);
    expect([...all.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect(all.length).toBe(encodeRaster(slip.rgba, slip.width, slip.height).length);
  });

  it('fails clearly when the printer is unreachable', async () => {
    const slip = renderSlip(job(), { width: 384, storeName: 'T', timeZone: 'Asia/Jerusalem' });
    await expect(new NetworkPrinter('127.0.0.1', 1, 2000).print('j', slip)).rejects.toThrow(/unreachable|timeout/);
  });
});
