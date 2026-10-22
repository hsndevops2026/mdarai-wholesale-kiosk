import { normalizeText, toAsciiDigits } from '@mdarai/product-matcher';
import type { CommandIntent, ParsedCommand, ParsedItem, ParsedUtterance, SalesUnit } from '@mdarai/shared-types';
import {
  BECAME,
  DUAL_UNITS,
  FILLERS,
  HOW_MUCH,
  INSTEAD_OF,
  INTENT_VERBS,
  NEGATIONS,
  NUMBER_WORDS,
  PRICE_WORDS,
  PRONOUN_VERB_SUFFIX,
  SEARCH_WORDS,
  SIZE_UNITS,
  TOTAL_WORDS,
  UNIT_WORDS,
} from './lexicon';
import type { OrderParser, ParseContext } from './types';

type Tok =
  | { kind: 'num'; value: number; raw: string }
  | { kind: 'dual'; value: number; unit: SalesUnit; raw: string }
  | { kind: 'unit'; unit: SalesUnit; prefixed: boolean; raw: string }
  | { kind: 'verb'; intent: CommandIntent; pronoun: boolean; raw: string }
  | { kind: 'neg' | 'instead' | 'boundary' | 'total' | 'howmuch' | 'became' | 'price' | 'search' | 'filler'; raw: string }
  | { kind: 'word'; raw: string; norm: string };

interface Clause {
  toks: Tok[];
  /** Product words that appeared before the quantity ("حليب خمس كراتين"). */
  wordsBeforeQty: boolean;
  hasQty: boolean;
  hasWords: boolean;
}

const UNIT_PREFIXES = ['بال', 'ب', 'ال'];

function lookupUnit(norm: string): { unit: SalesUnit; prefixed: boolean } | null {
  const direct = UNIT_WORDS.get(norm);
  if (direct) return { unit: direct, prefixed: false };
  for (const p of UNIT_PREFIXES) {
    if (norm.startsWith(p) && norm.length - p.length >= 3) {
      const u = UNIT_WORDS.get(norm.slice(p.length));
      if (u) return { unit: u, prefixed: p !== 'ال' };
    }
  }
  return null;
}

function lookupVerb(norm: string): { intent: CommandIntent; pronoun: boolean } | null {
  for (const [intent, words] of INTENT_VERBS) {
    if (words.has(norm)) return { intent, pronoun: PRONOUN_VERB_SUFFIX.test(norm) };
  }
  return null;
}

/** Classify one normalised token without any conjunction handling. */
function classify(raw: string, norm: string): Tok {
  if (/^\d+$/.test(norm)) return { kind: 'num', value: Number(norm), raw };
  const n = NUMBER_WORDS.get(norm);
  if (n !== undefined) return { kind: 'num', value: n, raw };
  const dual = DUAL_UNITS.get(norm);
  if (dual) return { kind: 'dual', value: dual.quantity, unit: dual.unit, raw };
  const unit = lookupUnit(norm);
  if (unit) return { kind: 'unit', ...unit, raw };
  const verb = lookupVerb(norm);
  if (verb) return { kind: 'verb', ...verb, raw };
  if (NEGATIONS.has(norm)) return { kind: 'neg', raw };
  if (INSTEAD_OF.has(norm)) return { kind: 'instead', raw };
  if (TOTAL_WORDS.has(norm)) return { kind: 'total', raw };
  if (HOW_MUCH.has(norm)) return { kind: 'howmuch', raw };
  if (BECAME.has(norm)) return { kind: 'became', raw };
  if (PRICE_WORDS.has(norm)) return { kind: 'price', raw };
  if (SEARCH_WORDS.has(norm)) return { kind: 'search', raw };
  if (FILLERS.has(norm)) return { kind: 'filler', raw };
  return { kind: 'word', raw, norm };
}

const CONJ_WORDS = new Set(['و', 'ו', 'and', 'او', 'או', 'or']);

/**
 * Tokenise and classify, splitting a leading conjunction (و / ו) off a token
 * when what follows it is a number, unit or verb ("وعشر", "وشيل", "ושלושה").
 * A و that is part of a product word ("ورق", "وافل") is left alone.
 */
function lex(text: string, vocabulary?: Set<string>): Tok[] {
  const prepared = toAsciiDigits(text)
    .replace(/[،,;؛!?؟\n]+/g, ' | ')
    .replace(/(^|[^\d])\.(?!\d)/g, '$1 | ');
  const out: Tok[] = [];
  for (const piece of prepared.split(/\s+/)) {
    if (!piece) continue;
    if (piece === '|') {
      out.push({ kind: 'boundary', raw: piece });
      continue;
    }
    const norm = normalizeText(piece);
    if (!norm) continue;
    for (const part of norm.split(' ')) {
      const raw = norm.includes(' ') ? part : piece.replace(/[^\p{L}\p{N}%.]/gu, '');
      if (CONJ_WORDS.has(part)) {
        out.push({ kind: 'boundary', raw: part });
        continue;
      }
      const direct = classify(raw, part);
      if ((part.startsWith('و') || part.startsWith('ו')) && part.length >= 3) {
        const restNorm = part.slice(1);
        const rest = classify(raw.slice(1), restNorm);
        const splitWorthy =
          rest.kind === 'num' || rest.kind === 'dual' || rest.kind === 'unit' || rest.kind === 'verb' || rest.kind === 'neg' ||
          (direct.kind === 'word' && rest.kind === 'word' && !!vocabulary?.has(restNorm) && !vocabulary.has(part));
        if (direct.kind === 'word' && splitWorthy) {
          out.push({ kind: 'boundary', raw: 'و' }, rest);
          continue;
        }
      }
      out.push(direct);
    }
  }
  return mergeCompoundNumbers(out);
}

/** "خمسة وعشرين" -> 25, "مية وخمسين" -> 150, "עשרים וחמש" -> 25. */
function mergeCompoundNumbers(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const cur = toks[i];
    const conj = toks[i + 1];
    const next = toks[i + 2];
    if (cur.kind === 'num' && conj?.kind === 'boundary' && conj.raw !== '|' && next?.kind === 'num') {
      const a = cur.value;
      const b = next.value;
      const isTens = (v: number) => v >= 20 && v <= 90 && v % 10 === 0;
      if ((a < 10 && isTens(b)) || (isTens(a) && b < 10) || (a >= 100 && a % 100 === 0 && b < 100)) {
        out.push({ kind: 'num', value: a + b, raw: `${cur.raw} و${next.raw}` });
        i += 2;
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

function newClause(): Clause {
  return { toks: [], wordsBeforeQty: false, hasQty: false, hasWords: false };
}

function isSizeNumber(toks: Tok[], i: number): boolean {
  const t = toks[i];
  if (t.kind !== 'num' || !/\d/.test(t.raw)) return false;
  const next = toks[i + 1];
  return !!next && next.kind === 'word' && SIZE_UNITS.has(next.norm);
}

function segment(toks: Tok[], vocabulary?: Set<string>): Clause[] {
  const clauses: Clause[] = [];
  let cur = newClause();
  let skipping = false;
  const flush = () => {
    if (cur.toks.length) clauses.push(cur);
    cur = newClause();
  };
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (t.kind === 'boundary') {
      skipping = false;
      flush();
      continue;
    }
    if (t.kind === 'instead') {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (t.kind === 'verb') skipping = false;
      else continue;
    }
    if (isSizeNumber(toks, i)) t = { kind: 'word', raw: t.raw, norm: String((t as { value: number }).value) };
    if (t.kind === 'word' && cur.hasWords && t.norm.startsWith('و') && t.norm.length >= 4 && !vocabulary?.has(t.norm)) {
      // "حليب وزيت", "الحليب والزيت": a و-prefixed word after a product starts the next item
      flush();
      t = { kind: 'word', raw: t.raw.startsWith('و') ? t.raw.slice(1) : t.raw, norm: t.norm.slice(1) };
    }
    const content = cur.hasQty || cur.hasWords;
    if (t.kind === 'verb' && content) flush();
    if ((t.kind === 'num' || t.kind === 'dual') && cur.hasQty) flush();
    if ((t.kind === 'num' || t.kind === 'dual') && cur.hasWords && !cur.wordsBeforeQty) flush();
    if (t.kind === 'word' && cur.hasQty && cur.wordsBeforeQty) {
      // "حليب خمس كراتين زيت ..." -> the next product starts a new clause
      const unitFollowsQty = cur.toks.some((x) => x.kind === 'unit' || x.kind === 'dual');
      if (unitFollowsQty || cur.toks[cur.toks.length - 1].kind === 'num') flush();
    }
    if (t.kind === 'num' || t.kind === 'dual') cur.hasQty = true;
    if (t.kind === 'word') {
      if (!cur.hasQty) cur.wordsBeforeQty = true;
      cur.hasWords = true;
    }
    cur.toks.push(t);
  }
  flush();
  return clauses;
}

interface ClauseResult {
  intent: CommandIntent;
  item: ParsedItem | null;
  searchQuery: string | null;
  missingProduct: boolean;
}

function interpret(clause: Clause, inherited: CommandIntent | null, ctx: ParseContext): ClauseResult | null {
  const toks = clause.toks;
  const words = toks.filter((t): t is Extract<Tok, { kind: 'word' }> => t.kind === 'word').map((t) => t.raw);
  const has = (k: Tok['kind']) => toks.some((t) => t.kind === k);
  const productText = words.join(' ').trim();

  if (has('total') || (has('howmuch') && has('became')) || (has('howmuch') && !productText && !has('num'))) {
    return { intent: 'REQUEST_TOTAL', item: null, searchQuery: null, missingProduct: false };
  }
  if ((has('search') || has('price') || has('howmuch')) && productText) {
    return { intent: 'SEARCH_PRODUCT', item: null, searchQuery: productText, missingProduct: false };
  }

  let intent: CommandIntent | null = null;
  let pronoun = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'verb') {
      const negated = toks[i - 1]?.kind === 'neg';
      intent = negated && t.intent === 'ADD_ITEM' ? 'REMOVE_ITEM' : t.intent;
      pronoun = t.pronoun;
      break;
    }
  }
  if (!intent && toks[0]?.kind === 'neg' && productText) intent = 'REMOVE_ITEM';
  intent = intent ?? inherited ?? 'ADD_ITEM';

  let quantity: number | null = null;
  let unit: SalesUnit | null = null;
  let unitPrefixed = false;
  for (const t of toks) {
    if (t.kind === 'num' && quantity === null) quantity = t.value;
    if (t.kind === 'dual' && quantity === null) {
      quantity = t.value;
      unit = t.unit;
    }
    if (t.kind === 'unit' && unit === null) {
      unit = t.unit;
      unitPrefixed = t.prefixed;
    }
  }

  let spoken = productText;
  if (!spoken && (pronoun || intent !== 'ADD_ITEM') && ctx.lastProduct) spoken = ctx.lastProduct;
  if (!spoken) {
    if (quantity === null && unit === null) return null; // only fillers
    return { intent, item: null, searchQuery: null, missingProduct: true };
  }

  if (intent === 'SET_QUANTITY' && quantity === null && unit !== null) {
    return { intent: 'CHANGE_UNIT', item: { spoken_product: spoken, quantity: null, unit: null, new_unit: unit }, searchQuery: null, missingProduct: false };
  }
  if (intent === 'ADD_ITEM' && unitPrefixed && quantity === null && ctx.lastProduct && spoken === ctx.lastProduct) {
    return { intent: 'CHANGE_UNIT', item: { spoken_product: spoken, quantity: null, unit: null, new_unit: unit }, searchQuery: null, missingProduct: false };
  }
  if (intent === 'REMOVE_ITEM' && (quantity !== null || unit !== null)) {
    intent = 'DECREASE_QUANTITY'; // "شيل كرتونة حليب" removes one carton, not the whole line
    quantity = quantity ?? 1;
  }
  if (quantity === null && unit !== null && (intent === 'ADD_ITEM' || intent === 'SET_QUANTITY' || intent === 'INCREASE_QUANTITY' || intent === 'DECREASE_QUANTITY')) {
    quantity = 1; // "كرتونة زيت" = one carton
  }
  if (intent === 'REMOVE_ITEM') {
    quantity = null;
  }
  return { intent, item: { spoken_product: spoken, quantity, unit, new_unit: null }, searchQuery: null, missingProduct: false };
}

/**
 * Deterministic order parser for Palestinian Arabic / Hebrew. It needs no
 * network access, so it is used for tests, as the offline fallback and as
 * the default parser until an LLM parser has been evaluated.
 */
export class RuleBasedOrderParser implements OrderParser {
  readonly name = 'rules';

  async parse(text: string, ctx: ParseContext = {}): Promise<ParsedUtterance> {
    return this.parseSync(text, ctx);
  }

  parseSync(text: string, ctx: ParseContext = {}): ParsedUtterance {
    const clauses = segment(lex(text, ctx.vocabulary), ctx.vocabulary);
    const commands: ParsedCommand[] = [];
    let inherited: CommandIntent | null = null;
    let lastProduct = ctx.lastProduct ?? null;
    for (const clause of clauses) {
      const r = interpret(clause, inherited, { ...ctx, lastProduct });
      if (!r) continue;
      if (r.intent === 'REQUEST_TOTAL' || r.intent === 'SEARCH_PRODUCT') {
        commands.push({ intent: r.intent, items: [], search_query: r.searchQuery, requires_clarification: false, clarification_reason: null });
        continue;
      }
      inherited = r.intent;
      if (r.missingProduct || !r.item) {
        commands.push({ intent: 'REQUEST_CLARIFICATION', items: [], search_query: null, requires_clarification: true, clarification_reason: 'missing_product' });
        continue;
      }
      lastProduct = r.item.spoken_product;
      const needsQty = r.item.quantity === null && (r.intent === 'ADD_ITEM' || r.intent === 'SET_QUANTITY');
      const prev = commands[commands.length - 1];
      if (prev && prev.intent === r.intent && prev.items.length > 0) {
        prev.items.push(r.item);
        if (needsQty) {
          prev.requires_clarification = true;
          prev.clarification_reason = 'missing_quantity';
        }
      } else {
        commands.push({
          intent: r.intent,
          items: [r.item],
          search_query: null,
          requires_clarification: needsQty,
          clarification_reason: needsQty ? 'missing_quantity' : null,
        });
      }
    }
    return { commands };
  }
}
