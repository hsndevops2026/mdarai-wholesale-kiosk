import { describe, expect, it } from 'vitest';
import { computeTotals, priceLine, PricingError, validateTiers, type PriceTierInput } from './index';

const product = { defaultPiecePrice: '6.90', defaultCartonPrice: '75.00' };

const tier = (p: Partial<PriceTierInput>): PriceTierInput => ({
  id: 't',
  customerId: null,
  unit: 'carton',
  minQty: 10,
  maxQty: null,
  kind: 'FIXED_PRICE',
  value: '70.00',
  ...p,
});

describe('priceLine', () => {
  it('uses the default price when nothing else applies', () => {
    const r = priceLine({ product, customerId: 'c1', unit: 'carton', quantity: 3 });
    expect(r).toMatchObject({ unitPrice: '75.00', lineTotal: '225.00', discountTotal: '0.00', rule: 'DEFAULT_PRICE' });
  });

  it('never derives a carton price from the piece price', () => {
    const r = priceLine({ product, customerId: 'c1', unit: 'carton', quantity: 1 });
    expect(r.unitPrice).toBe('75.00'); // not 6.90 * pieces
    expect(() =>
      priceLine({ product: { defaultPiecePrice: '5', defaultCartonPrice: null }, customerId: 'c1', unit: 'carton', quantity: 1 }),
    ).toThrow(PricingError);
  });

  it('prefers the customer unit price over the default price and default tier', () => {
    const r = priceLine({
      product,
      customerId: 'c1',
      customerPrice: { piecePrice: null, cartonPrice: '72.50' },
      tiers: [tier({ id: 'd', value: '60.00' })],
      unit: 'carton',
      quantity: 20,
    });
    expect(r).toMatchObject({ unitPrice: '72.50', rule: 'CUSTOMER_PRICE', lineTotal: '1450.00', discountTotal: '50.00' });
  });

  it('applies a customer tier first, as a percentage of the customer price', () => {
    const r = priceLine({
      product,
      customerId: 'c1',
      customerPrice: { piecePrice: null, cartonPrice: '72.00' },
      tiers: [tier({ id: 'ct', customerId: 'c1', kind: 'PERCENT_OFF', value: '5', minQty: 5 })],
      unit: 'carton',
      quantity: 5,
    });
    expect(r).toMatchObject({ unitPrice: '68.40', rule: 'CUSTOMER_TIER', tierId: 'ct', lineTotal: '342.00' });
  });

  it('ignores tiers that belong to other customers or other quantity ranges', () => {
    const r = priceLine({
      product,
      customerId: 'c1',
      tiers: [tier({ customerId: 'c2', minQty: 1 }), tier({ minQty: 10, maxQty: 19 })],
      unit: 'carton',
      quantity: 9,
    });
    expect(r.rule).toBe('DEFAULT_PRICE');
  });

  it('applies a default tier inside its inclusive range', () => {
    const tiers = [tier({ id: 'a', minQty: 10, maxQty: 19, value: '72.00' }), tier({ id: 'b', minQty: 20, value: '70.00' })];
    expect(priceLine({ product, customerId: 'c', tiers, unit: 'carton', quantity: 19 }).tierId).toBe('a');
    expect(priceLine({ product, customerId: 'c', tiers, unit: 'carton', quantity: 20 }).tierId).toBe('b');
  });

  it('is decimal-safe', () => {
    const r = priceLine({ product: { defaultPiecePrice: '0.10', defaultCartonPrice: null }, customerId: 'c', unit: 'piece', quantity: 3 });
    expect(r.lineTotal).toBe('0.30');
  });

  it('rejects invalid quantities', () => {
    expect(() => priceLine({ product, customerId: 'c', unit: 'piece', quantity: 0 })).toThrow(PricingError);
    expect(() => priceLine({ product, customerId: 'c', unit: 'piece', quantity: 1.5 })).toThrow(PricingError);
  });
});

describe('computeTotals', () => {
  it('adds VAT on top when prices exclude VAT', () => {
    const t = computeTotals({ lines: [{ lineTotal: '100.00', discountTotal: '5.00' }, { lineTotal: '0.05', discountTotal: '0' }], vatRate: '0.18', pricesIncludeVat: false });
    expect(t).toEqual({ subtotal: '100.05', discountTotal: '5.00', vat: '18.01', total: '118.06' });
  });
  it('extracts VAT when prices include VAT', () => {
    const t = computeTotals({ lines: [{ lineTotal: '118.00', discountTotal: '0' }], vatRate: '0.18', pricesIncludeVat: true });
    expect(t).toEqual({ subtotal: '118.00', discountTotal: '0.00', vat: '18.00', total: '118.00' });
  });
});

describe('validateTiers', () => {
  it('accepts non-overlapping tiers', () => {
    expect(validateTiers([tier({ id: 'a', minQty: 1, maxQty: 9 }), tier({ id: 'b', minQty: 10 })])).toEqual([]);
  });
  it('detects overlaps within the same customer and unit only', () => {
    const errs = validateTiers([
      tier({ id: 'a', minQty: 1, maxQty: 10 }),
      tier({ id: 'b', minQty: 10 }),
      tier({ id: 'c', minQty: 5, unit: 'piece' }),
      tier({ id: 'd', minQty: 5, customerId: 'x' }),
    ]);
    expect(errs).toEqual([{ tierId: 'b', message: 'overlaps tier a' }]);
  });
  it('detects an unbounded tier followed by another', () => {
    expect(validateTiers([tier({ id: 'a', minQty: 1 }), tier({ id: 'b', minQty: 50 })])).toHaveLength(1);
  });
  it('rejects malformed values', () => {
    expect(validateTiers([tier({ id: 'p', kind: 'PERCENT_OFF', value: '100' })])).toHaveLength(1);
    expect(validateTiers([tier({ id: 'm', minQty: 5, maxQty: 2 })])).toHaveLength(1);
  });
});
