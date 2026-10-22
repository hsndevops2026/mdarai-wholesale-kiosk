import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { buildSearchText, hashNationalId, type Prisma } from '@mdarai/database';
import { normalizeText } from '@mdarai/product-matcher';
import { AuditService } from '../core/audit.service';
import { CatalogService } from '../core/catalog.service';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { PrismaService, type Tx } from '../core/prisma.service';
import { parseImport, readWorkbook, type ImportIssue, type ParsedImport, type ProductRow } from './import-parser';

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const MAX_ISSUES_RETURNED = 500;

type Payload = Omit<ParsedImport, 'issues'>;

export interface ImportSummary {
  fileName: string;
  products: { create: number; update: number; unchanged: number };
  customers: { create: number; update: number };
  customerPrices: number;
  tiers: number;
  /** SKUs whose tiers will be replaced by the file's tiers. */
  tierSkus: number;
  errors: number;
  warnings: number;
}

/** Fields compared to decide whether an existing product changes. */
const COMPARED: Array<keyof ProductRow> = [
  'barcode', 'nameAr', 'nameHe', 'nameEn', 'category', 'brand', 'variant', 'size', 'pieceLabel', 'piecePrice', 'cartonPrice',
  'piecesPerCarton', 'stockQty', 'aisle', 'shelf', 'descriptionAr', 'descriptionHe', 'imageUrl', 'active',
];

/** Matching aliases of an imported product: its search keywords plus the English name. */
function aliasTerms(p: ProductRow): string[] {
  return [...p.keywords, ...(p.nameEn ? [p.nameEn] : [])];
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Parse + validate + diff. Nothing is written except the preview batch itself. */
  async preview(buffer: Buffer, fileName: string, staffUserId: string) {
    let sheets;
    try {
      sheets = await readWorkbook(buffer, fileName);
    } catch (err) {
      const unsupported = (err as Error).message === 'UNSUPPORTED_FILE';
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_FILE', unsupported ? 'الملف لازم يكون xlsx أو csv' : 'ما قدرنا نقرأ الملف');
    }
    // National IDs are hashed inside the parser; the raw number is never stored in the batch.
    const parsed = parseImport(sheets, { hashNationalId: (id) => hashNationalId(id, this.cfg.ID_HASH_PEPPER) });
    const { issues, ...payload } = parsed;
    const { summary, changes } = await this.plan(this.prisma.client, payload, issues, fileName);
    const batch = await this.prisma.client.importBatch.create({
      data: {
        staffUserId,
        fileName: fileName.slice(0, 200),
        status: 'PREVIEW',
        summary: { ...summary, issues: issues.slice(0, MAX_ISSUES_RETURNED) } as unknown as Prisma.InputJsonValue,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({ actorType: 'STAFF', actorId: staffUserId, action: 'import.preview', entityType: 'ImportBatch', entityId: batch.id, metadata: { ...summary } });
    return { id: batch.id, summary, issues: issues.slice(0, MAX_ISSUES_RETURNED), changes: changes.slice(0, 200), canCommit: summary.errors === 0 };
  }

  async commit(batchId: string, staffUserId: string) {
    const result = await this.prisma.client.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
        if (!batch) throw new AppError(HttpStatus.NOT_FOUND, 'IMPORT_NOT_FOUND', 'المعاينة غير موجودة');
        if (batch.status !== 'PREVIEW') throw new AppError(HttpStatus.CONFLICT, 'IMPORT_ALREADY_DONE', 'هذا الملف تم استيراده مسبقاً');
        if (Date.now() - batch.createdAt.getTime() > PREVIEW_TTL_MS) throw new AppError(HttpStatus.CONFLICT, 'IMPORT_EXPIRED', 'انتهت صلاحية المعاينة، ارفع الملف من جديد');
        // Claim the batch first so a double click cannot apply it twice.
        const claimed = await tx.importBatch.updateMany({ where: { id: batchId, status: 'PREVIEW' }, data: { status: 'COMMITTED', committedAt: new Date() } });
        if (claimed.count !== 1) throw new AppError(HttpStatus.CONFLICT, 'IMPORT_ALREADY_DONE', 'هذا الملف تم استيراده مسبقاً');

        const payload = batch.payload as unknown as Payload;
        // Re-validate against the database as it is now (it may have changed since the preview).
        const { summary } = await this.plan(tx, payload, [], batch.fileName);
        if (summary.errors > 0) throw new AppError(HttpStatus.CONFLICT, 'IMPORT_INVALID', 'الملف لم يعد صالحاً مقابل البيانات الحالية، ارفعه من جديد');
        await this.apply(tx, payload);
        await this.audit.log({ actorType: 'STAFF', actorId: staffUserId, action: 'import.commit', entityType: 'ImportBatch', entityId: batchId, metadata: { ...summary } }, tx);
        return summary;
      },
      { timeout: 180_000, maxWait: 10_000 },
    );
    await this.catalog.reload();
    return result;
  }

  /** Cross-check the file against the database and compute what would change. */
  private async plan(db: Tx | PrismaService['client'], payload: Payload, issues: ImportIssue[], fileName: string) {
    const skus = new Set([...payload.products.map((p) => p.sku), ...payload.customerPrices.map((p) => p.sku), ...payload.tiers.map((t) => t.sku)]);
    const existing = await db.product.findMany({ where: { sku: { in: [...skus] } }, include: { aliases: true } });
    const bySku = new Map(existing.map((p) => [p.sku, p]));
    const fileSkus = new Set(payload.products.map((p) => p.sku));

    // A barcode may only move between products in two steps (clear it first), so a partial import can never collide.
    const barcodes = payload.products.map((p) => p.barcode).filter((b): b is string => !!b);
    const owners = await db.product.findMany({ where: { barcode: { in: barcodes } }, select: { sku: true, barcode: true } });
    for (const o of owners) {
      const row = payload.products.find((p) => p.barcode === o.barcode && p.sku !== o.sku);
      if (row) issues.push({ sheet: 'Products', row: row.row, column: 'barcode', severity: 'error', message: `الباركود مستخدم للمنتج ${o.sku}` });
    }

    const codes = new Set([...payload.customers.map((c) => c.code), ...payload.customerPrices.map((p) => p.customerCode), ...payload.tiers.map((t) => t.customerCode).filter((c): c is string => !!c)]);
    const customers = await db.customer.findMany({ where: { code: { in: [...codes] } }, select: { code: true, nationalIdHash: true } });
    const customerCodes = new Set([...customers.map((c) => c.code), ...payload.customers.map((c) => c.code)]);
    const hashes = payload.customers.map((c) => c.nationalIdHash).filter((h): h is string => !!h);
    const hashOwners = await db.customer.findMany({ where: { nationalIdHash: { in: hashes } }, select: { code: true, nationalIdHash: true } });
    for (const c of payload.customers) {
      const owner = hashOwners.find((h) => h.nationalIdHash === c.nationalIdHash && h.code !== c.code);
      if (owner) issues.push({ sheet: 'Customers', row: c.row, column: 'national_id', severity: 'error', message: `رقم الهوية مسجّل لزبون آخر (${owner.code})` });
      if (!c.nationalIdHash && !customers.some((e) => e.code === c.code)) {
        issues.push({ sheet: 'Customers', row: c.row, column: 'national_id', severity: 'error', message: 'رقم الهوية مطلوب لزبون جديد' });
      }
    }

    const knownSku = (sku: string) => fileSkus.has(sku) || bySku.has(sku);
    for (const p of payload.customerPrices) {
      if (!customerCodes.has(p.customerCode)) issues.push({ sheet: 'Customer_Prices', row: p.row, column: 'customer_code', severity: 'error', message: `زبون غير موجود: ${p.customerCode}` });
      if (!knownSku(p.sku)) issues.push({ sheet: 'Customer_Prices', row: p.row, column: 'sku', severity: 'error', message: `منتج غير موجود: ${p.sku}` });
    }
    for (const t of payload.tiers) {
      if (t.customerCode && !customerCodes.has(t.customerCode)) issues.push({ sheet: 'Price_Tiers', row: t.row, column: 'customer_code', severity: 'error', message: `زبون غير موجود: ${t.customerCode}` });
      if (!knownSku(t.sku)) issues.push({ sheet: 'Price_Tiers', row: t.row, column: 'sku', severity: 'error', message: `منتج غير موجود: ${t.sku}` });
    }

    const changes: Array<{ sku: string; action: 'create' | 'update'; fields: string[] }> = [];
    let unchanged = 0;
    for (const p of payload.products) {
      const e = bySku.get(p.sku);
      if (!e) {
        changes.push({ sku: p.sku, action: 'create', fields: [] });
        continue;
      }
      const current: Record<string, unknown> = {
        ...e,
        piecePrice: e.defaultPiecePrice?.toFixed(2) ?? null,
        cartonPrice: e.defaultCartonPrice?.toFixed(2) ?? null,
      };
      const fields = COMPARED.filter((f) => (current[f] ?? null) !== (p[f] ?? null));
      const aliasesNow = e.aliases.map((a) => a.aliasNorm).sort().join('|');
      const aliasesNew = [...new Set(aliasTerms(p).map((k) => normalizeText(k)).filter(Boolean))].sort().join('|');
      if (aliasesNow !== aliasesNew) fields.push('keywords');
      if (fields.length) changes.push({ sku: p.sku, action: 'update', fields });
      else unchanged++;
    }

    const summary: ImportSummary = {
      fileName,
      products: { create: changes.filter((c) => c.action === 'create').length, update: changes.filter((c) => c.action === 'update').length, unchanged },
      customers: { create: payload.customers.filter((c) => !customers.some((e) => e.code === c.code)).length, update: payload.customers.filter((c) => customers.some((e) => e.code === c.code)).length },
      customerPrices: payload.customerPrices.length,
      tiers: payload.tiers.length,
      tierSkus: new Set(payload.tiers.map((t) => t.sku)).size,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    };
    issues.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row);
    return { summary, changes };
  }

  private async apply(tx: Tx, payload: Payload) {
    for (const p of payload.products) {
      const data = {
        barcode: p.barcode,
        nameAr: p.nameAr,
        nameHe: p.nameHe,
        nameEn: p.nameEn,
        category: p.category,
        brand: p.brand,
        variant: p.variant,
        size: p.size,
        pieceLabel: p.pieceLabel,
        defaultPiecePrice: p.piecePrice,
        defaultCartonPrice: p.cartonPrice,
        piecesPerCarton: p.piecesPerCarton,
        stockQty: p.stockQty,
        aisle: p.aisle,
        shelf: p.shelf,
        descriptionAr: p.descriptionAr,
        descriptionHe: p.descriptionHe,
        imageUrl: p.imageUrl,
        active: p.active,
        searchText: buildSearchText({ sku: p.sku, nameAr: p.nameAr, nameHe: p.nameHe, brand: p.brand, variant: p.variant, size: p.size, aliases: [...p.keywords, p.nameEn ?? ''] }),
      };
      const product = await tx.product.upsert({ where: { sku: p.sku }, create: { sku: p.sku, ...data }, update: data });
      // Search_Keywords is the source of truth for aliases of imported products.
      await tx.productAlias.deleteMany({ where: { productId: product.id } });
      const aliases = new Map<string, string>();
      for (const k of aliasTerms(p)) {
        const norm = normalizeText(k);
        if (norm && !aliases.has(norm)) aliases.set(norm, k);
      }
      if (aliases.size) await tx.productAlias.createMany({ data: [...aliases].map(([aliasNorm, alias]) => ({ productId: product.id, alias, aliasNorm })) });
    }
    for (const c of payload.customers) {
      const data = { name: c.name, businessName: c.businessName, phone: c.phone, active: c.active, ...(c.nationalIdHash ? { nationalIdHash: c.nationalIdHash } : {}) };
      await tx.customer.upsert({ where: { code: c.code }, create: { code: c.code, ...data, nationalIdHash: c.nationalIdHash! }, update: data });
    }
    const customerIds = new Map((await tx.customer.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]));
    const skus = [...new Set([...payload.customerPrices.map((p) => p.sku), ...payload.tiers.map((t) => t.sku)])];
    const productIds = new Map((await tx.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } })).map((p) => [p.sku, p.id]));
    for (const cp of payload.customerPrices) {
      const customerId = customerIds.get(cp.customerCode)!;
      const productId = productIds.get(cp.sku)!;
      await tx.customerPrice.upsert({
        where: { customerId_productId: { customerId, productId } },
        create: { customerId, productId, piecePrice: cp.piecePrice, cartonPrice: cp.cartonPrice },
        update: { piecePrice: cp.piecePrice, cartonPrice: cp.cartonPrice },
      });
    }
    // Tiers in the file replace all tiers of the SKUs they mention.
    const tierSkus = [...new Set(payload.tiers.map((t) => t.sku))];
    await tx.priceTier.deleteMany({ where: { productId: { in: tierSkus.map((s) => productIds.get(s)!) } } });
    if (payload.tiers.length) {
      await tx.priceTier.createMany({
        data: payload.tiers.map((t) => ({
          productId: productIds.get(t.sku)!,
          customerId: t.customerCode ? customerIds.get(t.customerCode)! : null,
          unit: t.unit,
          minQty: t.minQty,
          maxQty: t.maxQty,
          kind: t.kind,
          value: t.value,
        })),
      });
    }
  }
}
