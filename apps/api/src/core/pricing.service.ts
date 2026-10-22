import { Inject, Injectable } from '@nestjs/common';
import { computeTotals, priceLine, PricingError, type PricedLine, type PriceTierInput } from '@mdarai/pricing-engine';
import type { CartLineView, CartView, ProductView, SalesUnit } from '@mdarai/shared-types';
import { APP_CONFIG, type AppConfig } from './config';
import { CatalogService, type CatalogProduct } from './catalog.service';
import { PrismaService, type Tx } from './prisma.service';

export interface PricingContext {
  customerPrices: Map<string, { piecePrice: string | null; cartonPrice: string | null }>;
  tiers: Map<string, PriceTierInput[]>;
}

export interface CartLineInput {
  id: string;
  productId: string;
  unit: SalesUnit;
  quantity: number;
}

/** Thin DB-facing wrapper around the pure pricing engine. */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async loadContext(customerId: string, productIds: string[], tx?: Tx): Promise<PricingContext> {
    const db = tx ?? this.prisma.client;
    const ids = [...new Set(productIds)];
    const [prices, tiers] = await Promise.all([
      db.customerPrice.findMany({ where: { customerId, productId: { in: ids } } }),
      db.priceTier.findMany({ where: { productId: { in: ids }, OR: [{ customerId }, { customerId: null }] } }),
    ]);
    const ctx: PricingContext = { customerPrices: new Map(), tiers: new Map() };
    for (const p of prices) {
      ctx.customerPrices.set(p.productId, { piecePrice: p.piecePrice?.toFixed(2) ?? null, cartonPrice: p.cartonPrice?.toFixed(2) ?? null });
    }
    for (const t of tiers) {
      const list = ctx.tiers.get(t.productId) ?? [];
      list.push({ id: t.id, customerId: t.customerId, unit: t.unit, minQty: t.minQty, maxQty: t.maxQty, kind: t.kind, value: t.value.toFixed(2) });
      ctx.tiers.set(t.productId, list);
    }
    return ctx;
  }

  price(customerId: string, product: CatalogProduct, unit: SalesUnit, quantity: number, ctx: PricingContext): PricedLine {
    return priceLine({
      product: { defaultPiecePrice: product.defaultPiecePrice, defaultCartonPrice: product.defaultCartonPrice },
      customerId,
      customerPrice: ctx.customerPrices.get(product.id) ?? null,
      tiers: ctx.tiers.get(product.id) ?? [],
      unit,
      quantity,
    });
  }

  /** Base (quantity 1) customer price per unit, for catalog display. */
  unitPrices(customerId: string, product: CatalogProduct, ctx: PricingContext): { piece: string | null; carton: string | null } {
    const one = (unit: SalesUnit) => {
      if (!CatalogService.sellsUnit(product, unit)) return null;
      try {
        return this.price(customerId, product, unit, 1, ctx).unitPrice;
      } catch (err) {
        if (err instanceof PricingError) return null;
        throw err;
      }
    };
    return { piece: one('piece'), carton: one('carton') };
  }

  async productViews(customerId: string, products: CatalogProduct[]): Promise<ProductView[]> {
    const ctx = await this.loadContext(customerId, products.map((p) => p.id));
    return products.map((p) => CatalogService.toView(p, this.unitPrices(customerId, p, ctx)));
  }

  async cartView(customerId: string, lines: CartLineInput[], tx?: Tx): Promise<CartView> {
    const ctx = await this.loadContext(customerId, lines.map((l) => l.productId), tx);
    const views: CartLineView[] = [];
    for (const l of lines) {
      const p = this.catalog.get(l.productId);
      if (!p) continue;
      const priced = this.price(customerId, p, l.unit, l.quantity, ctx);
      views.push({
        id: l.id,
        productId: p.id,
        sku: p.sku,
        nameAr: p.nameAr,
        nameHe: p.nameHe,
        variant: p.variant,
        size: p.size,
        imageUrl: p.imageUrl,
        pieceLabel: p.pieceLabel,
        unit: l.unit,
        quantity: l.quantity,
        piecesPerCarton: p.piecesPerCarton,
        sellsPiece: p.defaultPiecePrice !== null,
        sellsCarton: p.defaultCartonPrice !== null,
        listUnitPrice: priced.listUnitPrice,
        unitPrice: priced.unitPrice,
        discountTotal: priced.discountTotal,
        lineTotal: priced.lineTotal,
        pricingRule: priced.rule,
        tierId: priced.tierId,
      });
    }
    const totals = computeTotals({ lines: views, vatRate: this.cfg.VAT_RATE, pricesIncludeVat: this.cfg.PRICES_INCLUDE_VAT });
    return { lines: views, currency: 'ILS', pricesIncludeVat: this.cfg.PRICES_INCLUDE_VAT, vatRate: this.cfg.VAT_RATE, ...totals };
  }
}
