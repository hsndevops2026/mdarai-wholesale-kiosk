import { Inject, Injectable, Logger } from '@nestjs/common';
import { FallbackOrderParser, OpenAiOrderParser, RuleBasedOrderParser, type ParseContext } from '@mdarai/ai-order-parser';
import type { ParsedUtterance } from '@mdarai/shared-types';
import { APP_CONFIG, type AppConfig } from './config';

/** Chooses the configured order parser. The rule parser is always the fallback. */
@Injectable()
export class ParserService {
  private readonly logger = new Logger('OrderParser');
  private readonly rules = new RuleBasedOrderParser();
  private readonly primary: FallbackOrderParser | null;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.primary =
      cfg.ORDER_PARSER === 'openai' && cfg.OPENAI_API_KEY
        ? new FallbackOrderParser(new OpenAiOrderParser({ apiKey: cfg.OPENAI_API_KEY, model: cfg.OPENAI_PARSER_MODEL }), this.rules, (err) =>
            this.logger.warn(`LLM parser failed, using rules: ${(err as Error).message}`),
          )
        : null;
  }

  async parse(text: string, ctx: ParseContext): Promise<{ utterance: ParsedUtterance; parser: string }> {
    if (this.primary) return this.primary.parseWithSource(text, ctx);
    return { utterance: this.rules.parseSync(text, ctx), parser: this.rules.name };
  }
}
