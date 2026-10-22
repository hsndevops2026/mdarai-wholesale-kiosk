import { normalizeText, tokenVariants, tokenize, isHebrew, transliterateHebrewToArabic } from './normalize';
import { tokenSimilarity } from './similarity';
import { DEFAULT_SYNONYM_GROUPS, STOPWORDS } from './synonyms';

export * from './normalize';
export { tokenSimilarity, levenshtein } from './similarity';
export { DEFAULT_SYNONYM_GROUPS, STOPWORDS } from './synonyms';

export interface MatchableProduct {
  id: string;
  sku: string;
  nameAr: string;
  nameHe: string | null;
  brand: string | null;
  variant: string | null;
  size: string | null;
  aliases: string[];
}

export interface ScoredProduct<P extends MatchableProduct = MatchableProduct> {
  product: P;
  score: number;
}

export type MatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND';

export interface MatchResult<P extends MatchableProduct = MatchableProduct> {
  status: MatchStatus;
  query: string;
  /** Set only when status is MATCHED. */
  product: P | null;
  /** Ranked plausible candidates (for clarification UI). */
  candidates: ScoredProduct<P>[];
}

export interface MatcherOptions {
  synonyms?: string[][];
  /** Minimum score for a product to be considered at all. */
  minScore?: number;
  /** Minimum score to auto-select. */
  autoScore?: number;
  /** Required lead of the best candidate over the runner-up to auto-select. */
  margin?: number;
  maxCandidates?: number;
}

interface IndexedProduct<P> {
  product: P;
  sku: string;
  /** Token lists of each full name (Arabic, Hebrew, aliases). */
  names: string[][];
  /** Every surface form that describes the product, with its weight. */
  pool: Map<string, number>;
}

const EXACT = 1;
const TRANSLIT_WEIGHT = 0.9;
/** Fuzzy (edit-distance) hits are discounted so they can never auto-select on their own. */
const FUZZY_WEIGHT = 0.75;
const PREFIX_WEIGHT = 0.7;
const TOKEN_HIT = 0.5;

/**
 * Deterministic, catalog-grounded product matcher. It only ever returns
 * products that exist in the catalog it was built from, and it refuses to
 * auto-select when two candidates are close.
 */
export class ProductMatcher<P extends MatchableProduct = MatchableProduct> {
  private readonly index: IndexedProduct<P>[];
  private readonly synonyms = new Map<string, Set<string>>();
  private readonly minScore: number;
  private readonly autoScore: number;
  private readonly margin: number;
  private readonly maxCandidates: number;

  constructor(products: P[], opts: MatcherOptions = {}) {
    this.minScore = opts.minScore ?? 0.5;
    this.autoScore = opts.autoScore ?? 0.78;
    this.margin = opts.margin ?? 0.1;
    this.maxCandidates = opts.maxCandidates ?? 6;
    for (const group of [...DEFAULT_SYNONYM_GROUPS, ...(opts.synonyms ?? [])]) {
      const norm = group.map((w) => normalizeText(w)).filter(Boolean);
      for (const w of norm) {
        const set = this.synonyms.get(w) ?? new Set<string>();
        norm.forEach((x) => set.add(x));
        this.synonyms.set(w, set);
      }
    }
    this.index = products.map((p) => this.indexProduct(p));
  }

  get size(): number {
    return this.index.length;
  }

  private indexProduct(product: P): IndexedProduct<P> {
    const nameStrings = [product.nameAr, product.nameHe, ...product.aliases].filter(
      (s): s is string => !!s && s.trim().length > 0,
    );
    const names = nameStrings.map((s) => tokenize(s).filter((t) => !STOPWORDS.has(t)));
    const pool = new Map<string, number>();
    const add = (t: string, w: number) => {
      if ((pool.get(t) ?? 0) < w) pool.set(t, w);
    };
    const extra = [product.brand, product.variant, product.size].filter((s): s is string => !!s).flatMap(tokenize);
    for (const t of [...names.flat(), ...extra]) {
      // Catalog Hebrew is not transliterated into the pool: Hebrew words often collide with
      // unrelated Arabic ones (לבנה "white" -> لبنه). Only query tokens are transliterated.
      for (const v of tokenVariants(t)) add(v, EXACT);
    }
    return { product, sku: normalizeText(product.sku), names, pool };
  }

  /** Alternatives for a query token: prefix-stripped forms, synonyms, transliteration. */
  private queryAlternatives(token: string): Map<string, number> {
    const alts = new Map<string, number>();
    const add = (t: string, w: number) => {
      if ((alts.get(t) ?? 0) < w) alts.set(t, w);
    };
    for (const v of tokenVariants(token)) {
      add(v, EXACT);
      for (const s of this.synonyms.get(v) ?? []) add(s, EXACT);
      if (isHebrew(v)) add(transliterateHebrewToArabic(v), TRANSLIT_WEIGHT);
    }
    return alts;
  }

  private tokenScore(alts: Map<string, number>, pool: Map<string, number>, allowPrefix: boolean): number {
    let best = 0;
    for (const [alt, aw] of alts) {
      const exact = pool.get(alt);
      if (exact !== undefined) {
        best = Math.max(best, aw * exact);
        if (best >= 1) return 1;
        continue;
      }
      for (const [p, pw] of pool) {
        const sim = tokenSimilarity(alt, p);
        if (sim > 0) best = Math.max(best, sim * aw * pw * FUZZY_WEIGHT);
        if (allowPrefix && alt.length >= 2 && p.startsWith(alt)) best = Math.max(best, PREFIX_WEIGHT * aw * pw);
      }
    }
    return best;
  }

  private scoreProduct(entry: IndexedProduct<P>, queryNorm: string, queryAlts: Map<string, number>[], allowPrefix: boolean): number {
    if (queryNorm === entry.sku) return 1;
    if (queryAlts.length === 0) return 0;
    const perToken = queryAlts.map((alts) => this.tokenScore(alts, entry.pool, allowPrefix));
    const coverage = perToken.reduce((a, s) => a + (s >= TOKEN_HIT ? s : 0), 0) / perToken.length;
    if (coverage === 0) return 0;
    // precision: how much of the closest full name the query accounts for
    let precision = 0;
    for (const name of entry.names) {
      if (name.length === 0) continue;
      let hit = 0;
      for (const nt of name) {
        const ntPool = new Map(tokenVariants(nt).map((v) => [v, EXACT] as const));
        let s = 0;
        for (const alts of queryAlts) s = Math.max(s, this.tokenScore(alts, ntPool, allowPrefix));
        if (s >= TOKEN_HIT) hit += s;
      }
      precision = Math.max(precision, hit / name.length);
    }
    return Math.round((0.75 * coverage + 0.25 * precision) * 1000) / 1000;
  }

  private rank(query: string, allowPrefix: boolean): ScoredProduct<P>[] {
    const queryNorm = normalizeText(query);
    const tokens = queryNorm.split(' ').filter((t) => t && !STOPWORDS.has(t));
    const queryAlts = tokens.map((t) => this.queryAlternatives(t));
    const scored: ScoredProduct<P>[] = [];
    for (const entry of this.index) {
      const score = this.scoreProduct(entry, queryNorm, queryAlts, allowPrefix);
      if (score > 0) scored.push({ product: entry.product, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.product.nameAr.localeCompare(b.product.nameAr));
  }

  /** Resolve a spoken/typed product phrase to a single catalog product, or explain why not. */
  match(query: string): MatchResult<P> {
    const ranked = this.rank(query, false).filter((s) => s.score >= this.minScore);
    if (ranked.length === 0) return { status: 'NOT_FOUND', query, product: null, candidates: [] };
    const [top, second] = ranked;
    const confident = top.score >= this.autoScore && (!second || top.score - second.score >= this.margin);
    const candidates = ranked.filter((s) => s.score >= top.score - 0.25).slice(0, this.maxCandidates);
    if (confident) return { status: 'MATCHED', query, product: top.product, candidates };
    return { status: 'AMBIGUOUS', query, product: null, candidates };
  }

  /** Ranked search for the touch catalog (allows prefixes, for search-as-you-type). */
  search(query: string, limit = 20): ScoredProduct<P>[] {
    return this.rank(query, true)
      .filter((s) => s.score >= 0.35)
      .slice(0, limit);
  }
}
