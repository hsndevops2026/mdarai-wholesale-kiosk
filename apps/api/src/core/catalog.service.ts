import { Injectable, Logger } from '@nestjs/common';
import { normalizeText, ProductMatcher, type MatchableProduct } from '@mdarai/product-matcher';
import type { ProductView, SalesUnit } from '@mdarai/shared-types';
import { PrismaService } from './prisma.service';

export interface CatalogProduct extends MatchableProduct {
  category: string | null;
  imageUrl: string | null;
  piecesPerCarton: number;
  defaultPiecePrice: string | null;
  defaultCartonPrice: string | null;
  active: boolean;
}

const RELOAD_INTERVAL_MS = 5 * 60 * 1000;

/**
 * In-memory catalog + matcher. 1,000–5,000 products fit comfortably in
 * memory and matching then takes a few milliseconds without DB round trips.
 * The cache is rebuilt after imports and periodically.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger('Catalog');
  private products = new Map<string, CatalogProduct>();
  private matcher = new ProductMatcher<CatalogProduct>([]);
  private vocabulary = new Set<string>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensureLoaded(): Promise<void> {
    if (Date.now() - this.loadedAt < RELOAD_INTERVAL_MS) return;
    await this.reload();
  }

  async reload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [rows, groups] = await Promise.all([
        this.prisma.client.product.findMany({ include: { aliases: true } }),
        this.prisma.client.synonymGroup.findMany(),
      ]);
      const products = rows.map<CatalogProduct>((p) => ({
        id: p.id,
        sku: p.sku,
        nameAr: p.nameAr,
        nameHe: p.nameHe,
        brand: p.brand,
        variant: p.variant,
        size: p.size,
        aliases: p.aliases.map((a) => a.alias),
        category: p.category,
        imageUrl: p.imageUrl,
        piecesPerCarton: p.piecesPerCarton,
        defaultPiecePrice: p.defaultPiecePrice?.toFixed(2) ?? null,
        defaultCartonPrice: p.defaultCartonPrice?.toFixed(2) ?? null,
        active: p.active,
      }));
      this.products = new Map(products.map((p) => [p.id, p]));
      const active = products.filter((p) => p.active);
      this.matcher = new ProductMatcher(active, { synonyms: groups.map((g) => g.terms) });
      this.vocabulary = new Set(active.flatMap((p) => normalizeText([p.nameAr, p.nameHe, ...p.aliases].join(' ')).split(' ')));
      this.loadedAt = Date.now();
      this.logger.log(`catalog loaded: ${active.length} active products`);
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  get(productId: string): CatalogProduct | undefined {
    return this.products.get(productId);
  }

  getMatcher(): ProductMatcher<CatalogProduct> {
    return this.matcher;
  }

  getVocabulary(): Set<string> {
    return this.vocabulary;
  }

  activeProducts(): CatalogProduct[] {
    return [...this.products.values()].filter((p) => p.active);
  }

  categories(): string[] {
    return [...new Set(this.activeProducts().map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ar'));
  }

  static sellsUnit(p: Pick<CatalogProduct, 'defaultPiecePrice' | 'defaultCartonPrice'>, unit: SalesUnit): boolean {
    return unit === 'piece' ? p.defaultPiecePrice !== null : p.defaultCartonPrice !== null;
  }

  static sellableUnits(p: Pick<CatalogProduct, 'defaultPiecePrice' | 'defaultCartonPrice'>): SalesUnit[] {
    return (['carton', 'piece'] as const).filter((u) => CatalogService.sellsUnit(p, u));
  }

  static toView(p: CatalogProduct, prices: { piece: string | null; carton: string | null }): ProductView {
    return {
      id: p.id,
      sku: p.sku,
      nameAr: p.nameAr,
      nameHe: p.nameHe,
      brand: p.brand,
      variant: p.variant,
      size: p.size,
      category: p.category,
      imageUrl: p.imageUrl,
      piecesPerCarton: p.piecesPerCarton,
      sellsPiece: p.defaultPiecePrice !== null,
      sellsCarton: p.defaultCartonPrice !== null,
      piecePrice: prices.piece,
      cartonPrice: prices.carton,
    };
  }
}
