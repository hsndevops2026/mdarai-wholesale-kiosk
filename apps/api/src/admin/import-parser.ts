import { isValidIsraeliId, type SalesUnit } from '@mdarai/shared-types';
import { validateTiers, type TierKind } from '@mdarai/pricing-engine';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

/**
 * Excel / CSV catalog import — parsing and in-file validation (no database access).
 *
 * Accepts the store's template ("MdarAi_Wholesale_Products_Template.xlsx") as-is:
 *   Products: SKU, Barcode, Product_Name_AR, Product_Name_HE, Product_Name_EN, Category, Brand,
 *             Unit, Price_ILS, Stock_Qty, Aisle, Shelf, Description_AR, Description_HE,
 *             Search_Keywords, Image_URL, Active, Last_Updated
 * plus OPTIONAL wholesale columns/sheets that the template does not have yet:
 *   Products: Pieces_Per_Carton, Carton_Price_ILS, Variant, Size
 *   Customers: Customer_Code, Name, Business_Name, National_ID, Phone, Active
 *   Customer_Prices: Customer_Code, SKU, Piece_Price_ILS, Carton_Price_ILS
 *   Price_Tiers: Customer_Code (blank = all customers), SKU, Unit, Min_Qty, Max_Qty, Type, Value
 */

export const MAX_IMPORT_ROWS = 20_000;

export type Severity = 'error' | 'warning';

export interface ImportIssue {
  sheet: string;
  row: number;
  column?: string;
  severity: Severity;
  message: string;
}

export interface ProductRow {
  row: number;
  sku: string;
  barcode: string | null;
  nameAr: string;
  nameHe: string | null;
  nameEn: string | null;
  category: string | null;
  brand: string | null;
  variant: string | null;
  size: string | null;
  pieceLabel: string | null;
  piecePrice: string | null;
  cartonPrice: string | null;
  piecesPerCarton: number;
  stockQty: number | null;
  aisle: string | null;
  shelf: string | null;
  descriptionAr: string | null;
  descriptionHe: string | null;
  keywords: string[];
  imageUrl: string | null;
  active: boolean;
}

export interface CustomerRow {
  row: number;
  code: string;
  name: string;
  businessName: string;
  /** HMAC of the national ID. The raw number never leaves the parser. */
  nationalIdHash: string | null;
  phone: string | null;
  active: boolean;
}

export interface CustomerPriceRow {
  row: number;
  customerCode: string;
  sku: string;
  piecePrice: string | null;
  cartonPrice: string | null;
}

export interface TierRow {
  row: number;
  customerCode: string | null;
  sku: string;
  unit: SalesUnit;
  minQty: number;
  maxQty: number | null;
  kind: TierKind;
  value: string;
}

export interface ParsedImport {
  products: ProductRow[];
  customers: CustomerRow[];
  customerPrices: CustomerPriceRow[];
  tiers: TierRow[];
  issues: ImportIssue[];
}

export interface RawSheet {
  name: string;
  /** Keys are normalised headers (lower_snake). */
  rows: Array<{ row: number; cells: Record<string, CellValue> }>;
  headers: string[];
}

export type CellValue = string | number | boolean | Date | null;

// ---------------------------------------------------------------- reading files

export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function excelCell(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return excelCell((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

export async function readWorkbook(buffer: Buffer, fileName: string): Promise<RawSheet[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    const records = parseCsv(buffer, { bom: true, skip_empty_lines: false, relax_column_count: true }) as string[][];
    const [header = [], ...data] = records;
    const headers = header.map((h) => normalizeHeader(String(h)));
    return [
      {
        name: 'Products',
        headers,
        rows: data.map((r, i) => ({ row: i + 2, cells: Object.fromEntries(headers.map((h, j) => [h, r[j] === undefined || r[j] === '' ? null : r[j]])) })),
      },
    ];
  }
  if (!lower.endsWith('.xlsx')) throw new Error('UNSUPPORTED_FILE');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = normalizeHeader(String(excelCell(cell.value) ?? ''));
    });
    const rows: RawSheet['rows'] = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const cells: Record<string, CellValue> = {};
      headers.forEach((h, i) => {
        if (h) cells[h] = excelCell(r.getCell(i + 1).value);
      });
      rows.push({ row: n, cells });
    });
    sheets.push({ name: ws.name, headers: headers.filter(Boolean), rows });
  });
  return sheets;
}

// ---------------------------------------------------------------- value helpers

const YES = new Set(['yes', 'y', 'true', '1', 'نعم', 'اه', 'כן', 'active', 'פעיל', 'فعال']);
const NO = new Set(['no', 'n', 'false', '0', 'لا', 'לא', 'inactive', 'לא פעיל', 'غير فعال']);
const DEFAULT_PIECE_WORDS = new Set(['قطعة', 'قطعه', 'piece', 'pcs', 'יחידה']);
const CARTON_WORDS = new Set(['كرتونة', 'كرتونه', 'كرتون', 'كراتين', 'carton', 'box', 'קרטון', 'ארגז', 'صندوق']);

function text(v: CellValue, max = 500): string | null {
  if (v === null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
  return s ? s.slice(0, max) : null;
}

class RowContext {
  constructor(
    readonly sheet: string,
    readonly row: number,
    readonly cells: Record<string, CellValue>,
    private readonly issues: ImportIssue[],
  ) {}

  issue(column: string | undefined, message: string, severity: Severity = 'error') {
    this.issues.push({ sheet: this.sheet, row: this.row, column, severity, message });
  }

  str(col: string, opts: { required?: boolean; max?: number } = {}): string | null {
    const v = text(this.cells[col] ?? null, opts.max);
    if (!v && opts.required) this.issue(col, 'مطلوب');
    if (v && opts.max && String(this.cells[col]).trim().length > opts.max) this.issue(col, `أطول من ${opts.max} حرف`, 'warning');
    return v;
  }

  /** Decimal money string with at most 2 decimals, or null. */
  money(col: string): string | null {
    const raw = this.cells[col] ?? null;
    if (raw === null || raw === '') return null;
    let s = typeof raw === 'number' ? String(raw) : String(raw).trim().replace(/[₪\s]/g, '');
    if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) {
      this.issue(col, `سعر غير صالح: "${raw}"`);
      return null;
    }
    const [i, d = ''] = s.split('.');
    if (d.length > 2 && !/^0+$/.test(d.slice(2))) {
      this.issue(col, `السعر فيه أكثر من خانتين عشريتين: ${s}`);
      return null;
    }
    const out = `${Number(i)}.${d.slice(0, 2).padEnd(2, '0')}`;
    if (Number(out) === 0) this.issue(col, 'السعر صفر', 'warning');
    return out;
  }

  int(col: string, opts: { min?: number; required?: boolean } = {}): number | null {
    const raw = this.cells[col] ?? null;
    if (raw === null || raw === '') {
      if (opts.required) this.issue(col, 'مطلوب');
      return null;
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < (opts.min ?? 0)) {
      this.issue(col, `رقم صحيح غير صالح: "${raw}"`);
      return null;
    }
    return n;
  }

  bool(col: string, fallback = true): boolean {
    const v = text(this.cells[col] ?? null)?.toLowerCase();
    if (!v) return fallback;
    if (YES.has(v)) return true;
    if (NO.has(v)) return false;
    this.issue(col, `قيمة غير مفهومة "${v}" (Yes/No)`);
    return fallback;
  }
}

function findSheet(sheets: RawSheet[], ...names: string[]): RawSheet | undefined {
  const wanted = names.map(normalizeHeader);
  return sheets.find((s) => wanted.includes(normalizeHeader(s.name)));
}

function isBlank(cells: Record<string, CellValue>): boolean {
  return Object.values(cells).every((v) => v === null || (typeof v === 'string' && v.trim() === ''));
}

const PRODUCT_COLUMNS = [
  'sku', 'barcode', 'product_name_ar', 'product_name_he', 'product_name_en', 'category', 'brand', 'unit', 'price_ils',
  'stock_qty', 'aisle', 'shelf', 'description_ar', 'description_he', 'search_keywords', 'image_url', 'active', 'last_updated',
  'pieces_per_carton', 'carton_price_ils', 'variant', 'size',
];

function warnUnknownColumns(sheet: RawSheet, known: string[], issues: ImportIssue[]) {
  for (const h of sheet.headers) {
    if (!known.includes(h)) issues.push({ sheet: sheet.name, row: 1, column: h, severity: 'warning', message: 'عمود غير معروف، سيتم تجاهله' });
  }
}

// ---------------------------------------------------------------- main parser

export function parseImport(sheets: RawSheet[], opts: { hashNationalId: (id: string) => string }): ParsedImport {
  const issues: ImportIssue[] = [];
  const result: ParsedImport = { products: [], customers: [], customerPrices: [], tiers: [], issues };

  const productsSheet = findSheet(sheets, 'Products', 'Product', 'מוצרים', 'المنتجات');
  const total = sheets.reduce((n, s) => n + s.rows.length, 0);
  if (total > MAX_IMPORT_ROWS) {
    issues.push({ sheet: '-', row: 0, severity: 'error', message: `الملف كبير جداً (${total} صف، الحد ${MAX_IMPORT_ROWS})` });
    return result;
  }

  if (productsSheet) {
    warnUnknownColumns(productsSheet, PRODUCT_COLUMNS, issues);
    for (const h of ['sku', 'product_name_ar']) {
      if (!productsSheet.headers.includes(h)) issues.push({ sheet: productsSheet.name, row: 1, column: h, severity: 'error', message: 'عمود مطلوب غير موجود' });
    }
    const seenSku = new Map<string, number>();
    const seenBarcode = new Map<string, number>();
    for (const { row, cells } of productsSheet.rows) {
      if (isBlank(cells)) continue;
      const c = new RowContext(productsSheet.name, row, cells, issues);
      const before = issues.filter((i) => i.severity === 'error').length;
      const sku = c.str('sku', { required: true, max: 64 })?.toUpperCase() ?? null;
      const nameAr = c.str('product_name_ar', { required: true, max: 200 });
      let barcode = c.str('barcode', { max: 32 });
      if (typeof cells.barcode === 'number') {
        barcode = BigInt(Math.round(cells.barcode)).toString();
        c.issue('barcode', 'الباركود محفوظ كرقم وليس نص؛ قد تكون الأصفار في البداية ضاعت', 'warning');
      }
      if (barcode && !/^\d{4,20}$/.test(barcode)) c.issue('barcode', `باركود غير صالح: ${barcode}`);

      const unitWord = c.str('unit', { max: 30 });
      let piecePrice = c.money('price_ils');
      let cartonPrice = c.money('carton_price_ils');
      let pieceLabel = unitWord;
      if (unitWord && CARTON_WORDS.has(unitWord.toLowerCase())) {
        // The row's only price is a carton price.
        if (cartonPrice && piecePrice) c.issue('carton_price_ils', 'الوحدة كرتونة وفي سعرين؛ حدد سعر الكرتونة فقط');
        cartonPrice = cartonPrice ?? piecePrice;
        piecePrice = null;
        pieceLabel = null;
      }
      const ppc = c.int('pieces_per_carton', { min: 1 });
      if (cartonPrice && ppc === null) c.issue('pieces_per_carton', 'مطلوب عدد القطع بالكرتونة عند وجود سعر كرتونة (لا نفترضه)');
      const hasPriceCell = [cells.price_ils, cells.carton_price_ils].some((v) => v !== null && v !== undefined && v !== '');
      if (!piecePrice && !cartonPrice && !hasPriceCell) c.issue('price_ils', 'لازم سعر قطعة أو سعر كرتونة');

      const imageUrl = c.str('image_url', { max: 1000 });
      if (imageUrl && !/^https:\/\/[^\s]+$/i.test(imageUrl)) c.issue('image_url', 'رابط الصورة لازم يبدأ بـ https://', 'warning');

      const keywords = [...new Set((c.str('search_keywords', { max: 2000 }) ?? '').split(/[,،;|\n]/).map((k) => k.trim()).filter((k) => k && k.length <= 60))];

      if (sku) {
        if (seenSku.has(sku)) c.issue('sku', `SKU مكرر (أيضاً في الصف ${seenSku.get(sku)})`);
        else seenSku.set(sku, row);
      }
      if (barcode) {
        if (seenBarcode.has(barcode)) c.issue('barcode', `باركود مكرر (أيضاً في الصف ${seenBarcode.get(barcode)})`);
        else seenBarcode.set(barcode, row);
      }
      const stockQty = c.int('stock_qty', { min: 0 });
      const active = c.bool('active');
      const hasErrors = issues.filter((i) => i.severity === 'error').length > before;
      if (hasErrors || !sku || !nameAr) continue;
      result.products.push({
        row,
        sku,
        barcode: barcode || null,
        nameAr,
        nameHe: c.str('product_name_he', { max: 200 }),
        nameEn: c.str('product_name_en', { max: 200 }),
        category: c.str('category', { max: 100 }),
        brand: c.str('brand', { max: 100 }),
        variant: c.str('variant', { max: 100 }),
        size: c.str('size', { max: 100 }),
        // "قطعة" is the default word, stored as null so exports re-import unchanged.
        pieceLabel: piecePrice && pieceLabel && !DEFAULT_PIECE_WORDS.has(pieceLabel.toLowerCase()) ? pieceLabel : null,
        piecePrice,
        cartonPrice: cartonPrice ?? null,
        piecesPerCarton: ppc ?? 1,
        stockQty,
        aisle: c.str('aisle', { max: 30 }),
        shelf: c.str('shelf', { max: 30 }),
        descriptionAr: c.str('description_ar', { max: 1000 }),
        descriptionHe: c.str('description_he', { max: 1000 }),
        keywords,
        imageUrl: imageUrl && /^https:\/\//i.test(imageUrl) ? imageUrl : null,
        active,
      });
    }
  }

  const customersSheet = findSheet(sheets, 'Customers', 'العملاء', 'الزبائن', 'לקוחות');
  if (customersSheet) {
    warnUnknownColumns(customersSheet, ['customer_code', 'name', 'business_name', 'national_id', 'phone', 'active'], issues);
    const seen = new Set<string>();
    const seenId = new Set<string>();
    for (const { row, cells } of customersSheet.rows) {
      if (isBlank(cells)) continue;
      const c = new RowContext(customersSheet.name, row, cells, issues);
      const before = issues.filter((i) => i.severity === 'error').length;
      const code = c.str('customer_code', { required: true, max: 32 })?.toUpperCase() ?? null;
      const name = c.str('name', { required: true, max: 100 });
      const businessName = c.str('business_name', { max: 150 }) ?? name;
      const rawId = cells.national_id === null || cells.national_id === undefined ? null : String(cells.national_id).trim();
      let nationalIdHash: string | null = null;
      if (rawId) {
        const digits = rawId.padStart(9, '0');
        // Never echo the ID number back in messages.
        if (!isValidIsraeliId(digits)) c.issue('national_id', 'رقم هوية غير صالح (فحص خانة التحقق)');
        else {
          nationalIdHash = opts.hashNationalId(digits);
          if (seenId.has(nationalIdHash)) c.issue('national_id', 'نفس رقم الهوية لأكثر من زبون');
          seenId.add(nationalIdHash);
        }
      }
      if (code && seen.has(code)) c.issue('customer_code', 'كود زبون مكرر');
      if (code) seen.add(code);
      const active = c.bool('active');
      if (issues.filter((i) => i.severity === 'error').length > before || !code || !name) continue;
      result.customers.push({ row, code, name, businessName: businessName ?? name, nationalIdHash, phone: c.str('phone', { max: 30 }), active });
    }
  }

  const pricesSheet = findSheet(sheets, 'Customer_Prices', 'CustomerPrices', 'اسعار الزبائن');
  if (pricesSheet) {
    warnUnknownColumns(pricesSheet, ['customer_code', 'sku', 'piece_price_ils', 'carton_price_ils'], issues);
    const seen = new Set<string>();
    for (const { row, cells } of pricesSheet.rows) {
      if (isBlank(cells)) continue;
      const c = new RowContext(pricesSheet.name, row, cells, issues);
      const before = issues.filter((i) => i.severity === 'error').length;
      const customerCode = c.str('customer_code', { required: true })?.toUpperCase() ?? null;
      const sku = c.str('sku', { required: true })?.toUpperCase() ?? null;
      const piecePrice = c.money('piece_price_ils');
      const cartonPrice = c.money('carton_price_ils');
      if (!piecePrice && !cartonPrice) c.issue('piece_price_ils', 'لازم سعر قطعة أو كرتونة');
      const key = `${customerCode}|${sku}`;
      if (seen.has(key)) c.issue('sku', 'نفس الزبون ونفس المنتج مكرر');
      seen.add(key);
      if (issues.filter((i) => i.severity === 'error').length > before || !customerCode || !sku) continue;
      result.customerPrices.push({ row, customerCode, sku, piecePrice, cartonPrice });
    }
  }

  const tiersSheet = findSheet(sheets, 'Price_Tiers', 'PriceTiers', 'Quantity_Discounts', 'خصومات الكمية');
  if (tiersSheet) {
    warnUnknownColumns(tiersSheet, ['customer_code', 'sku', 'unit', 'min_qty', 'max_qty', 'type', 'value'], issues);
    for (const { row, cells } of tiersSheet.rows) {
      if (isBlank(cells)) continue;
      const c = new RowContext(tiersSheet.name, row, cells, issues);
      const before = issues.filter((i) => i.severity === 'error').length;
      const customerCode = c.str('customer_code')?.toUpperCase() ?? null;
      const sku = c.str('sku', { required: true })?.toUpperCase() ?? null;
      const unitRaw = c.str('unit', { required: true })?.toLowerCase() ?? '';
      const unit: SalesUnit | null = CARTON_WORDS.has(unitRaw) ? 'carton' : ['piece', 'قطعة', 'قطعه', 'حبة', 'יחידה'].includes(unitRaw) ? 'piece' : null;
      if (unitRaw && !unit) c.issue('unit', 'الوحدة لازم piece أو carton');
      const minQty = c.int('min_qty', { min: 1, required: true });
      const maxQty = c.int('max_qty', { min: 1 });
      const typeRaw = c.str('type', { required: true })?.toLowerCase() ?? '';
      const kind: TierKind | null = ['fixed_price', 'fixed', 'price', 'سعر'].includes(typeRaw) ? 'FIXED_PRICE' : ['percent_off', 'percent', '%', 'خصم', 'نسبة'].includes(typeRaw) ? 'PERCENT_OFF' : null;
      if (typeRaw && !kind) c.issue('type', 'النوع لازم FIXED_PRICE أو PERCENT_OFF');
      const value = c.money('value');
      if (!value) c.issue('value', 'مطلوب');
      if (issues.filter((i) => i.severity === 'error').length > before || !sku || !unit || minQty === null || !kind || !value) continue;
      result.tiers.push({ row, customerCode, sku, unit, minQty, maxQty, kind, value });
    }
    // Overlaps are checked per SKU across the whole sheet (tiers in the file replace that SKU's tiers).
    const bySku = new Map<string, TierRow[]>();
    for (const t of result.tiers) bySku.set(t.sku, [...(bySku.get(t.sku) ?? []), t]);
    for (const [, list] of bySku) {
      const errs = validateTiers(list.map((t) => ({ id: String(t.row), customerId: t.customerCode, unit: t.unit, minQty: t.minQty, maxQty: t.maxQty, kind: t.kind, value: t.value })));
      for (const e of errs) issues.push({ sheet: tiersSheet.name, row: Number(e.tierId), severity: 'error', message: e.message.replace(/overlaps tier (\d+)/, 'يتداخل مع الصف $1') });
    }
  }

  if (!productsSheet && !customersSheet && !pricesSheet && !tiersSheet) {
    issues.push({ sheet: '-', row: 0, severity: 'error', message: 'ما في ورقة باسم Products (أو Customers / Customer_Prices / Price_Tiers)' });
  }
  return result;
}
