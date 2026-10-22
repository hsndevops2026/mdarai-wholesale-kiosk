import { describe, expect, it } from 'vitest';
import { EXTRACTION_CASES } from '../../../tests/voice-fixtures/order-extraction.cases';
import { RuleBasedOrderParser } from './rule-parser';

const parser = new RuleBasedOrderParser();

function flatten(text: string, lastProduct?: string) {
  const { commands } = parser.parseSync(text, { lastProduct });
  const rows: Array<[string, string | null, number | null, string | null, string | null]> = [];
  for (const c of commands) {
    if (c.items.length === 0) rows.push([c.intent, null, null, null, null]);
    for (const i of c.items) rows.push([c.intent, i.spoken_product, i.quantity, i.unit, i.new_unit]);
  }
  return rows;
}

describe('RuleBasedOrderParser acceptance cases', () => {
  for (const tc of EXTRACTION_CASES) {
    it(`${tc.id} [${tc.category}] ${tc.text}`, () => {
      const got = flatten(tc.text, tc.lastProduct);
      expect(got.map((r) => r[0])).toEqual(tc.expected.map((e) => e[0]));
      tc.expected.forEach(([, product, qty, unit, newUnit], i) => {
        if (product !== null) expect(got[i][1]).toBe(product);
        expect(got[i][2]).toBe(qty);
        expect(got[i][3]).toBe(unit);
        if (newUnit !== undefined) expect(got[i][4]).toBe(newUnit);
      });
    });
  }
});

describe('RuleBasedOrderParser details', () => {
  it('flags missing quantities for clarification', () => {
    const { commands } = parser.parseSync('بدي حليب تنوفا');
    expect(commands[0]).toMatchObject({ requires_clarification: true, clarification_reason: 'missing_quantity' });
  });
  it('returns search queries', () => {
    expect(parser.parseSync('في عندك زيت كانولا؟').commands[0].search_query).toBe('زيت كانولا');
  });
  it('returns no commands for pure filler', () => {
    expect(parser.parseSync('يعطيك العافية').commands).toEqual([]);
  });
  it('uses the catalog vocabulary to split و off a product word', () => {
    const { commands } = parser.parseSync('بدي كرتونة حليب وسكر', { vocabulary: new Set(['سكر']) });
    expect(commands[0].items.map((i) => i.spoken_product)).toEqual(['حليب', 'سكر']);
  });
});
