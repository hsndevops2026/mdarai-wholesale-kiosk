import { describe, expect, it, vi } from 'vitest';
import { FallbackOrderParser, OpenAiOrderParser, parsedUtteranceJsonSchema } from './openai-parser';
import { RuleBasedOrderParser } from './rule-parser';

const reply = (content: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status }));

describe('OpenAiOrderParser', () => {
  it('produces a strict JSON schema (no optional properties, no extra keys)', () => {
    const schema = parsedUtteranceJsonSchema() as { additionalProperties: boolean; required: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['commands']);
    const text = JSON.stringify(schema);
    expect(text).toContain('"spoken_product"');
  });

  it('validates the model output with Zod', async () => {
    const ok = {
      commands: [{ intent: 'ADD_ITEM', items: [{ spoken_product: 'حليب', quantity: 5, unit: 'carton', new_unit: null }], search_query: null, requires_clarification: false, clarification_reason: null }],
    };
    const p = new OpenAiOrderParser({ apiKey: 'k', model: 'm', fetchImpl: reply(ok) as unknown as typeof fetch });
    await expect(p.parse('بدي خمس كراتين حليب')).resolves.toEqual(ok);
  });

  it('rejects invented fields such as prices', async () => {
    const bad = {
      commands: [{ intent: 'ADD_ITEM', items: [{ spoken_product: 'حليب', quantity: 5, unit: 'carton', new_unit: null, price: 3 }], search_query: null, requires_clarification: false, clarification_reason: null }],
    };
    const p = new OpenAiOrderParser({ apiKey: 'k', model: 'm', fetchImpl: reply(bad) as unknown as typeof fetch });
    await expect(p.parse('x')).rejects.toThrow();
  });

  it('falls back to the rule parser when the LLM fails', async () => {
    const p = new OpenAiOrderParser({ apiKey: 'k', model: 'm', fetchImpl: reply({}, 500) as unknown as typeof fetch });
    const onError = vi.fn();
    const f = new FallbackOrderParser(p, new RuleBasedOrderParser(), onError);
    const r = await f.parseWithSource('بدي كرتونة زيت');
    expect(r.parser).toBe('rules');
    expect(r.utterance.commands[0].items[0]).toMatchObject({ spoken_product: 'زيت', quantity: 1, unit: 'carton' });
    expect(onError).toHaveBeenCalledOnce();
  });
});
