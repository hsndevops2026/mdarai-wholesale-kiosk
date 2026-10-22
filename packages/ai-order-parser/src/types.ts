import type { ParsedUtterance } from '@mdarai/shared-types';

export interface ParseContext {
  /** Spoken name of the product the customer referred to last ("خليهم سبعة"). */
  lastProduct?: string | null;
  /** Product names currently in the cart (helps the LLM resolve references). */
  cartProducts?: string[];
  /** Normalised catalog words, used to split a leading "و" off product names. */
  vocabulary?: Set<string>;
}

/**
 * Converts a final transcript into structured commands. Implementations
 * must not touch the database, prices or the catalog: they only describe
 * what the customer said. Product resolution and pricing happen later in
 * deterministic code.
 */
export interface OrderParser {
  readonly name: string;
  parse(text: string, ctx?: ParseContext): Promise<ParsedUtterance>;
}
