import Decimal from 'decimal.js';
import type { PricingRule, SalesUnit } from '@mdarai/shared-types';

/**
 * Deterministic, decimal-safe pricing. The LLM never touches prices: every
 * number shown to the customer or stored on an order comes from here.
 */

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type MoneyValue = Decimal;

export type TierKind = 'FIXED_PRICE' | 'PERCENT_OFF';

export interface PriceTierInput {
  id: string;
  /** null = applies to every customer (default tier). */
  customerId: string | null;
  unit: SalesUnit;
  minQty: number;
  /** Inclusive upper bound, null = unbounded. */
  maxQty: number | null;
  kind: TierKind;
  /** FIXED_PRICE: price per unit. PERCENT_OFF: percentage (0-100, exclusive). */
  value: string;
}

export interface ProductPricesInput {
  defaultPiecePrice: string | null;
  defaultCartonPrice: string | null;
}

export interface CustomerPriceInput {
  piecePrice: string | null;
  cartonPrice: string | null;
}

export interface PriceLineInput {
  product: ProductPricesInput;
  customerId: string;
  customerPrice?: CustomerPriceInput | null;
  /** Tiers for this product. Tiers for other customers are ignored. */
  tiers?: PriceTierInput[];
  unit: SalesUnit;
  quantity: number;
}

export interface PricedLine {
  unit: SalesUnit;
  quantity: number;
  listUnitPrice: string;
  unitPrice: string;
  discountTotal: string;
  lineTotal: string;
  rule: PricingRule;
  tierId: string | null;
}

export class PricingError extends Error {
  constructor(
    public readonly code: 'UNIT_NOT_SOLD' | 'INVALID_QUANTITY' | 'INVALID_PRICE',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

function money(v: string | number): MoneyValue {
  const d = new Money(v);
  if (!d.isFinite() || d.isNegative()) {
    throw new PricingError('INVALID_PRICE', `Invalid price value: ${v}`);
  }
  return d;
}

function round2(d: MoneyValue): MoneyValue {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function fmt(d: MoneyValue): string {
  return round2(d).toFixed(2);
}

function unitPriceOf(src: { piece: string | null; carton: string | null }, unit: SalesUnit): string | null {
  return unit === 'piece' ? src.piece : src.carton;
}

function tierMatches(t: PriceTierInput, unit: SalesUnit, qty: number): boolean {
  return t.unit === unit && qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty);
}

function applyTier(t: PriceTierInput, base: MoneyValue): MoneyValue {
  if (t.kind === 'FIXED_PRICE') return round2(money(t.value));
  const pct = money(t.value);
  return round2(base.mul(new Money(100).minus(pct)).div(100));
}

/**
 * Price one cart line.
 *
 * Precedence (first match wins):
 *   1. customer-specific quantity tier
 *   2. customer-specific unit price
 *   3. default (all-customer) quantity tier
 *   4. default unit price
 *
 * Carton prices are never derived from piece prices: a unit with no default
 * price is simply not sold.
 */
export function priceLine(input: PriceLineInput): PricedLine {
  const { unit, quantity } = input;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new PricingError('INVALID_QUANTITY', `Quantity must be a positive integer, got ${quantity}`);
  }
  const defaultRaw = unitPriceOf(
    { piece: input.product.defaultPiecePrice, carton: input.product.defaultCartonPrice },
    unit,
  );
  if (defaultRaw === null || defaultRaw === undefined) {
    throw new PricingError('UNIT_NOT_SOLD', `Product is not sold by ${unit}`);
  }
  const listPrice = round2(money(defaultRaw));
  const customerRaw = input.customerPrice
    ? unitPriceOf({ piece: input.customerPrice.piecePrice, carton: input.customerPrice.cartonPrice }, unit)
    : null;
  const customerPrice = customerRaw !== null && customerRaw !== undefined ? round2(money(customerRaw)) : null;

  const tiers = input.tiers ?? [];
  const customerTier = tiers.find((t) => t.customerId === input.customerId && tierMatches(t, unit, quantity));
  const defaultTier = tiers.find((t) => t.customerId === null && tierMatches(t, unit, quantity));

  let unitPrice: MoneyValue;
  let rule: PricingRule;
  let tierId: string | null = null;
  if (customerTier) {
    unitPrice = applyTier(customerTier, customerPrice ?? listPrice);
    rule = 'CUSTOMER_TIER';
    tierId = customerTier.id;
  } else if (customerPrice) {
    unitPrice = customerPrice;
    rule = 'CUSTOMER_PRICE';
  } else if (defaultTier) {
    unitPrice = applyTier(defaultTier, listPrice);
    rule = 'DEFAULT_TIER';
    tierId = defaultTier.id;
  } else {
    unitPrice = listPrice;
    rule = 'DEFAULT_PRICE';
  }

  const lineTotal = unitPrice.mul(quantity);
  const listTotal = listPrice.mul(quantity);
  // A customer price above list is possible (e.g. special packaging); never show a negative discount.
  const discount = Decimal.max(listTotal.minus(lineTotal), 0);
  return {
    unit,
    quantity,
    listUnitPrice: fmt(listPrice),
    unitPrice: fmt(unitPrice),
    discountTotal: fmt(discount),
    lineTotal: fmt(lineTotal),
    rule,
    tierId,
  };
}

export interface TotalsInput {
  lines: Array<Pick<PricedLine, 'lineTotal' | 'discountTotal'>>;
  vatRate: string;
  pricesIncludeVat: boolean;
}

export interface Totals {
  subtotal: string;
  discountTotal: string;
  vat: string;
  total: string;
}

export function computeTotals({ lines, vatRate, pricesIncludeVat }: TotalsInput): Totals {
  const rate = new Money(vatRate);
  const subtotal = lines.reduce((acc, l) => acc.plus(l.lineTotal), new Money(0));
  const discount = lines.reduce((acc, l) => acc.plus(l.discountTotal), new Money(0));
  let vat: MoneyValue;
  let total: MoneyValue;
  if (pricesIncludeVat) {
    total = subtotal;
    vat = round2(subtotal.minus(subtotal.div(rate.plus(1))));
  } else {
    vat = round2(subtotal.mul(rate));
    total = subtotal.plus(vat);
  }
  return { subtotal: fmt(subtotal), discountTotal: fmt(discount), vat: fmt(vat), total: fmt(total) };
}

export interface TierValidationError {
  tierId: string;
  message: string;
}

/**
 * Reject overlapping or malformed tiers. Two tiers overlap when they share
 * (customerId, unit) and their quantity ranges intersect, which would make
 * the applied price depend on row order.
 */
export function validateTiers(tiers: PriceTierInput[]): TierValidationError[] {
  const errors: TierValidationError[] = [];
  for (const t of tiers) {
    if (!Number.isInteger(t.minQty) || t.minQty < 1) {
      errors.push({ tierId: t.id, message: 'minQty must be an integer >= 1' });
    }
    if (t.maxQty !== null && (!Number.isInteger(t.maxQty) || t.maxQty < t.minQty)) {
      errors.push({ tierId: t.id, message: 'maxQty must be an integer >= minQty' });
    }
    let value: Decimal | null = null;
    try {
      value = new Money(t.value);
    } catch {
      errors.push({ tierId: t.id, message: 'value is not a number' });
    }
    if (value) {
      if (!value.isFinite() || value.lte(0)) errors.push({ tierId: t.id, message: 'value must be > 0' });
      if (t.kind === 'PERCENT_OFF' && value.gte(100)) {
        errors.push({ tierId: t.id, message: 'PERCENT_OFF must be < 100' });
      }
    }
  }
  const groups = new Map<string, PriceTierInput[]>();
  for (const t of tiers) {
    const key = `${t.customerId ?? '*'}|${t.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.minQty - b.minQty);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.maxQty === null || cur.minQty <= prev.maxQty) {
        errors.push({ tierId: cur.id, message: `overlaps tier ${prev.id}` });
      }
    }
  }
  return errors;
}
