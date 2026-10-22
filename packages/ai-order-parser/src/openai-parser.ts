import { ParsedUtteranceSchema, type ParsedUtterance } from '@mdarai/shared-types';
import { z } from 'zod';
import type { OrderParser, ParseContext } from './types';

export const ORDER_PARSER_SYSTEM_PROMPT = `You convert a customer's spoken wholesale order into JSON commands.
The customer speaks Palestinian Arabic and often mixes in Hebrew product or brand words (e.g. "بدي خمس كراتين חלב תנובה").
The text is a speech-recognition transcript and may contain recognition errors.

Rules:
- Copy product words exactly as spoken into spoken_product (Arabic or Hebrew script as heard). Never translate them into a catalog name, never invent SKUs, brands, sizes, prices, discounts, stock or pieces-per-carton.
- quantity: integer the customer said, else null. Arabic dual forms count as 2 (كرتونتين = 2 cartons, حبتين = 2 pieces). "كرتونة زيت" without a number = 1 carton.
- unit: "carton" for كرتونة/كراتين/קרטון/ארגז, "piece" for قطعة/حبة/علبة/יחידה, null if not said. Sizes like "1 لتر" or "500 غرام" belong to spoken_product, not quantity.
- intents: ADD_ITEM (بدي/ضيف/اعطيني), SET_QUANTITY (خلي/صير/غير ... to an absolute number; "خلي الحليب سبع كراتين بدل خمس" = SET 7, ignore the old value after بدل), INCREASE_QUANTITY (زيد), DECREASE_QUANTITY (نقص, or شيل with a number), REMOVE_ITEM (شيل/احذف/ما بدي without a number), CHANGE_UNIT (switch unit, put it in new_unit), SEARCH_PRODUCT (asking whether a product exists or its price; put the words in search_query), REQUEST_TOTAL (asking for the total), REQUEST_CLARIFICATION (cannot tell what the customer wants).
- One command may hold several items of the same intent. Use several commands when intents differ.
- If the customer refers to a product with a pronoun ("خليهم سبعة"), use the product name from the context.
- Set requires_clarification=true with a short clarification_reason when quantity or product is missing for ADD_ITEM/SET_QUANTITY.
- Never decide that an order is confirmed; confirmation only happens on the touchscreen.`;

export interface OpenAiParserOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** JSON schema for OpenAI strict structured outputs, generated from the Zod schema. */
export function parsedUtteranceJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ParsedUtteranceSchema, { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export class OpenAiOrderParser implements OrderParser {
  readonly name: string;

  constructor(private readonly opts: OpenAiParserOptions) {
    this.name = `openai:${opts.model}`;
  }

  async parse(text: string, ctx: ParseContext = {}): Promise<ParsedUtterance> {
    const f = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    const context = {
      cart_products: ctx.cartProducts ?? [],
      last_product: ctx.lastProduct ?? null,
    };
    try {
      const res = await f(`${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: 0,
          messages: [
            { role: 'system', content: ORDER_PARSER_SYSTEM_PROMPT },
            { role: 'user', content: `Context: ${JSON.stringify(context)}\nTranscript: ${text}` },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'parsed_utterance', strict: true, schema: parsedUtteranceJsonSchema() },
          },
        }),
      });
      if (!res.ok) throw new Error(`OpenAI request failed with status ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenAI returned no content');
      // Strict schema validation: anything the model returns outside the contract is rejected.
      return ParsedUtteranceSchema.parse(JSON.parse(content));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Use the primary parser, falling back to another (e.g. rules) when it fails. */
export class FallbackOrderParser implements OrderParser {
  readonly name: string;

  constructor(
    private readonly primary: OrderParser,
    private readonly fallback: OrderParser,
    private readonly onError?: (err: unknown) => void,
  ) {
    this.name = `${primary.name}|${fallback.name}`;
  }

  async parse(text: string, ctx?: ParseContext): Promise<ParsedUtterance> {
    return (await this.parseWithSource(text, ctx)).utterance;
  }

  async parseWithSource(text: string, ctx?: ParseContext): Promise<{ utterance: ParsedUtterance; parser: string }> {
    try {
      return { utterance: await this.primary.parse(text, ctx), parser: this.primary.name };
    } catch (err) {
      this.onError?.(err);
      return { utterance: await this.fallback.parse(text, ctx), parser: this.fallback.name };
    }
  }
}
