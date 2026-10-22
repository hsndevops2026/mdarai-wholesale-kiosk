/**
 * Integration tests against a running API + seeded Postgres.
 *   API_URL (default http://localhost:4000), SEED_KIOSK_DEVICE_TOKEN, SEED_WAREHOUSE_PASSWORD
 * The API must run with KIOSK_MAX_FAILED_IDENTIFY high enough for repeated runs (see docs).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandResult } from '@mdarai/shared-types';

const API = `${process.env.API_URL ?? 'http://localhost:4000'}/api`;
const DEVICE = process.env.SEED_KIOSK_DEVICE_TOKEN ?? 'dev-kiosk-device-token';

async function call<T = any>(path: string, opts: { method?: string; body?: unknown; session?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'x-kiosk-device': DEVICE,
      ...(opts.session ? { 'x-kiosk-session': opts.session } : {}),
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

async function login(nationalId = '000000018') {
  const r = await call('/kiosk/identify', { body: { nationalId } });
  expect(r.status).toBe(200);
  return r.body.sessionToken as string;
}

const say = (session: string, text: string, utteranceId = randomUUID()) =>
  call<CommandResult>('/kiosk/cart/commands', { session, body: { utteranceId, text } });

const pick = (r: CommandResult, i: number, label: string) => {
  const opt = r.clarifications[i].options.find((o) => o.label.includes(label));
  if (!opt) throw new Error(`option ${label} not found`);
  return { id: r.clarifications[i].id, value: opt.value };
};

describe('kiosk API', () => {
  it('rejects requests without a registered device', async () => {
    const r = await call('/kiosk/identify', { body: { nationalId: '000000018' }, headers: { 'x-kiosk-device': 'nope-nope-nope' } });
    expect(r.status).toBe(401);
  });

  it('builds an order over several utterances with customer pricing and tiers', async () => {
    const s = await login();
    const r1 = await say(s, 'بدي خمس كراتين חלב תנובה وثلاث كراتين زيت');
    expect(r1.status).toBe(200);
    expect(r1.body.clarifications.map((c) => c.kind)).toEqual(['PRODUCT_CHOICE', 'PRODUCT_CHOICE']);
    expect(r1.body.cart.lines).toHaveLength(0);

    const milk = pick(r1.body, 0, 'حليب تنوفا 3% 1 لتر');
    const oil = pick(r1.body, 1, 'زيت عباد الشمس 1 لتر');
    await call(`/kiosk/cart/clarifications/${milk.id}/resolve`, { session: s, body: { value: milk.value } });
    const r2 = await call<CommandResult>(`/kiosk/cart/clarifications/${oil.id}/resolve`, { session: s, body: { value: oil.value } });
    expect(r2.body.cart.lines.map((l) => [l.sku, l.unit, l.quantity, l.unitPrice])).toEqual([
      ['DAI-001', 'carton', 5, '74.00'], // C-1001 customer price (default 78.00)
      ['OIL-003', 'carton', 3, '112.00'], // C-1001 customer price (default 120.00)
    ]);

    // replacement, not addition
    const r3 = await say(s, 'خلي الحليب سبع كراتين بدل خمس');
    expect(r3.body.cart.lines.find((l) => l.sku === 'DAI-001')?.quantity).toBe(7);

    // 10+ cartons -> C-1001 customer tier 72.00
    const r4 = await say(s, 'زيد الحليب تلات كراتين');
    const m = r4.body.cart.lines.find((l) => l.sku === 'DAI-001')!;
    expect([m.quantity, m.unitPrice, m.pricingRule, m.lineTotal]).toEqual([10, '72.00', 'CUSTOMER_TIER', '720.00']);

    const r5 = await say(s, 'شيل الزيت');
    expect(r5.body.cart.lines.map((l) => l.sku)).toEqual(['DAI-001']);
    expect(r5.body.cart).toMatchObject({ subtotal: '720.00', vat: '129.60', total: '849.60' });
    await call('/kiosk/logout', { method: 'POST', session: s });
  });

  it('applies a retried utterance only once', async () => {
    const s = await login();
    const id = randomUUID();
    await say(s, 'بدي كرتونتين سكر أبيض 1 كيلو', id);
    const again = await say(s, 'بدي كرتونتين سكر أبيض 1 كيلو', id);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.cart.lines).toEqual([expect.objectContaining({ sku: 'GRN-006', quantity: 2, unit: 'carton' })]);
    await call('/kiosk/logout', { method: 'POST', session: s });
  });

  it('asks for the unit when it is missing and both units are sold', async () => {
    const s = await login();
    const r = await say(s, 'بدي عشرة زيت ذرة');
    expect(r.body.clarifications[0]).toMatchObject({ kind: 'UNIT_CHOICE' });
    const done = await call<CommandResult>(`/kiosk/cart/clarifications/${r.body.clarifications[0].id}/resolve`, { session: s, body: { value: 'piece' } });
    expect(done.body.cart.lines).toEqual([expect.objectContaining({ sku: 'OIL-002', unit: 'piece', quantity: 10 })]);
    await call('/kiosk/logout', { method: 'POST', session: s });
  });

  it('confirms idempotently, ends the session and isolates customers', async () => {
    const a = await login('000000018');
    await call('/kiosk/cart/items', { session: a, body: { productId: (await firstProductId(a)).id, unit: 'carton', quantity: 2 } });
    const key = `test-${randomUUID()}`;
    const c1 = await call('/kiosk/orders/confirm', { session: a, body: { idempotencyKey: key } });
    const c2 = await call('/kiosk/orders/confirm', { session: a, body: { idempotencyKey: key } });
    expect(c1.status).toBe(200);
    expect(c2.body.duplicate).toBe(true);
    expect(c2.body.order.orderNumber).toBe(c1.body.order.orderNumber);
    expect((await call('/kiosk/cart', { session: a })).status).toBe(401);

    // another customer's session cannot reuse the key to read that order
    const b = await login('000000026');
    const stolen = await call('/kiosk/orders/confirm', { session: b, body: { idempotencyKey: key } });
    expect(stolen.status).toBe(409);
    await call('/kiosk/logout', { method: 'POST', session: b });
  });

  it('refuses to confirm an empty cart or one with open questions', async () => {
    const s = await login();
    expect((await call('/kiosk/orders/confirm', { session: s, body: { idempotencyKey: `t-${randomUUID()}` } })).body.code).toBe('CART_EMPTY');
    await say(s, 'بدي خمس كراتين حليب');
    expect((await call('/kiosk/orders/confirm', { session: s, body: { idempotencyKey: `t-${randomUUID()}` } })).body.code).toBe('PENDING_CLARIFICATIONS');
    await call('/kiosk/logout', { method: 'POST', session: s });
  });

  it('protects warehouse endpoints', async () => {
    expect((await call('/warehouse/orders')).status).toBe(401);
    const login = await call('/staff/login', { body: { username: 'warehouse', password: process.env.SEED_WAREHOUSE_PASSWORD ?? 'warehouse-demo-1234' } });
    const auth = { authorization: `Bearer ${login.body.token}` };
    const list = await call('/warehouse/orders?status=NEW', { headers: auth });
    expect(list.status).toBe(200);
    const id = list.body.orders[0].id;
    expect((await call(`/warehouse/orders/${id}/status`, { body: { status: 'DELIVERED' }, headers: auth })).status).toBe(409);
    expect((await call(`/warehouse/orders/${id}/status`, { body: { status: 'PREPARING' }, headers: auth })).body.status).toBe('PREPARING');
  });
});

async function firstProductId(session: string) {
  const r = await call('/kiosk/catalog?q=كولا', { session });
  return r.body.products[0] as { id: string };
}
