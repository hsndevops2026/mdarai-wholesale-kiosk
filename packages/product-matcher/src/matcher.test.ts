import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../database/src/seed-data/catalog';
import { normalizeText, ProductMatcher, type MatchableProduct } from './index';

const products: MatchableProduct[] = CATALOG.map(([sku, nameAr, nameHe, brand, , variant, size, , , , aliases]) => ({
  id: sku,
  sku,
  nameAr,
  nameHe,
  brand,
  variant,
  size,
  aliases,
}));
const matcher = new ProductMatcher(products);

function ids(q: string) {
  return matcher.match(q).candidates.map((c) => c.product.sku);
}

describe('normalizeText', () => {
  it('unifies Arabic letter variants, diacritics and digits', () => {
    expect(normalizeText('طَحِينَة الأرز ٥٠٠ غرام')).toBe('طحينه الارز 500 غرام');
  });
  it('normalises Hebrew final letters and niqqud', () => {
    expect(normalizeText('חָלָב תְּנוּבָה 3 %')).toBe('חלב תנובה 3%');
    expect(normalizeText('שמן')).toBe('שמנ');
  });
  it('keeps decimal sizes', () => {
    expect(normalizeText('كولا 1.5 لتر')).toBe('كولا 1.5 لتر');
  });
});

describe('ProductMatcher.match', () => {
  it('matches an exact SKU', () => {
    const r = matcher.match('oil-003');
    expect(r.status).toBe('MATCHED');
    expect(r.product?.sku).toBe('OIL-003');
  });

  it('asks for clarification when several milk variants fit "حليب تنوفا"', () => {
    const r = matcher.match('حليب تنوفا');
    expect(r.status).toBe('AMBIGUOUS');
    expect(ids('حليب تنوفا')).toEqual(expect.arrayContaining(['DAI-001', 'DAI-002', 'DAI-003']));
    expect(ids('حليب تنوفا')).not.toContain('DAI-004');
  });

  it('matches Hebrew product words inside an Arabic request', () => {
    const r = matcher.match('חלב תנובה');
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.candidates[0].product.sku).toMatch(/^DAI-00[123]$/);
  });

  it('resolves a fully specified variant', () => {
    const r = matcher.match('حليب تنوفا 1% 1 لتر');
    expect(r.status).toBe('MATCHED');
    expect(r.product?.sku).toBe('DAI-002');
  });

  it('resolves a Hebrew full name', () => {
    expect(matcher.match('שמן קנולה').product?.sku).toBe('OIL-004');
  });

  it('does not confuse tahini (طحينة) with flour (طحين)', () => {
    const r = matcher.match('طحينة');
    expect(r.candidates.every((c) => c.product.sku.startsWith('TAH'))).toBe(true);
    const f = matcher.match('طحين');
    expect(f.candidates.every((c) => c.product.sku.startsWith('GRN'))).toBe(true);
  });

  it('does not confuse oil (زيت) with olives (زيتون)', () => {
    const r = matcher.match('زيت');
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.candidates.map((c) => c.product.sku)).not.toContain('CAN-008');
  });

  it('uses aliases (Palestinian nicknames)', () => {
    expect(matcher.match('رب بندورة').candidates[0].product.sku).toBe('CAN-006');
    expect(matcher.match('مي').status).not.toBe('NOT_FOUND');
    expect(matcher.match('ميرامية').product?.sku).toBe('DRK-015');
  });

  it('uses brand transliteration aliases (تنوبا → תנובה)', () => {
    expect(ids('لبنة تنوبا')[0]).toBe('DAI-005');
  });

  it('strips the definite article', () => {
    expect(matcher.match('الكمون').product?.sku).toBe('SPC-003');
  });

  it('never selects a fuzzy-only match automatically', () => {
    const r = matcher.match('كمونن');
    expect(r.status).not.toBe('MATCHED');
  });

  it('returns NOT_FOUND for products not in the catalog', () => {
    expect(matcher.match('سيارة').status).toBe('NOT_FOUND');
    expect(matcher.match('לחם שיפון').status).not.toBe('MATCHED');
  });

  it('only returns catalog products', () => {
    const all = new Set(products.map((p) => p.sku));
    for (const q of ['حليب', 'زيت', 'رز', 'شاي', 'بيض']) {
      for (const c of matcher.match(q).candidates) expect(all.has(c.product.sku)).toBe(true);
    }
  });
});

describe('ProductMatcher.search', () => {
  it('supports search-as-you-type prefixes', () => {
    expect(matcher.search('شوك').map((s) => s.product.sku)).toEqual(expect.arrayContaining(['SNK-005']));
  });
  it('is fast enough for a 5,000 product catalog', () => {
    const big: MatchableProduct[] = [];
    for (let i = 0; i < 45; i++) for (const p of products) big.push({ ...p, id: `${p.id}-${i}`, sku: `${p.sku}-${i}` });
    const m = new ProductMatcher(big);
    const t0 = performance.now();
    for (const q of ['حليب تنوفا', 'زيت عباد الشمس', 'طحينة', 'שמן קנולה', 'رز بسمتي']) m.match(q);
    const per = (performance.now() - t0) / 5;
    expect(big.length).toBeGreaterThan(5000);
    expect(per).toBeLessThan(250);
  });
});
