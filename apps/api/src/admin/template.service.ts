import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../core/prisma.service';

/** Columns of the store's original template, in its order. */
const STORE_COLUMNS = [
  'SKU', 'Barcode', 'Product_Name_AR', 'Product_Name_HE', 'Product_Name_EN', 'Category', 'Brand', 'Unit', 'Price_ILS', 'Stock_Qty',
  'Aisle', 'Shelf', 'Description_AR', 'Description_HE', 'Search_Keywords', 'Image_URL', 'Active', 'Last_Updated',
];
/** Optional wholesale columns added by MdarAi (highlighted in the file). */
const WHOLESALE_COLUMNS = ['Pieces_Per_Carton', 'Carton_Price_ILS', 'Variant', 'Size'];

const INSTRUCTIONS: Array<[string, string, string]> = [
  ['SKU', 'إلزامي. رقم المنتج الثابت؛ لا تغيّره لمنتج موجود (التحديث يتم حسب SKU)', 'Required. Never change for existing products; updates match by SKU'],
  ['Barcode', 'نص (حتى لا تضيع الأصفار في البداية)', 'Text, to keep leading zeros'],
  ['Product_Name_AR / HE / EN', 'الاسم كما يراه الزبون. العربي إلزامي', 'Customer-facing names. Arabic is required'],
  ['Unit', 'كلمة القطعة الواحدة (قطعة، كيس، زجاجة). إذا كتبت "كرتونة" فإن Price_ILS هو سعر الكرتونة', 'Word for one piece. If "كرتونة", Price_ILS is a carton price'],
  ['Price_ILS', 'سعر القطعة الافتراضي (قبل الضريبة إلا إذا تم ضبط النظام غير ذلك)', 'Default piece price'],
  ['Pieces_Per_Carton *', 'جديد، اختياري. عدد القطع في الكرتونة. إلزامي إذا وُجد سعر كرتونة', 'New, optional. Required when a carton price is given'],
  ['Carton_Price_ILS *', 'جديد، اختياري. سعر الكرتونة. لا يُحسب تلقائياً من سعر القطعة', 'New, optional. Never derived from the piece price'],
  ['Variant / Size *', 'جديد، اختياري. النوع (3%، فراولة) والحجم (1 لتر). يساعد على التمييز بين الأصناف', 'New, optional. Helps tell variants apart'],
  ['Stock_Qty', 'للمعلومة فقط حالياً', 'Informational only for now'],
  ['Aisle / Shelf', 'مكان المنتج؛ يُطبع على ورقة التحضير', 'Location; printed on picking slips'],
  ['Search_Keywords', 'أسماء بديلة يقولها الزبائن (عربي/عبري/إنجليزي) مفصولة بفواصل. انتبه: كلمة عامة مثل "لبن" ستربط المنتج بكل من يقولها', 'Comma-separated synonyms. Generic words attach the product to anyone saying them'],
  ['Image_URL', 'اختياري، يبدأ بـ https://', 'Optional, https only'],
  ['Active', 'Yes / No', 'Yes / No'],
  ['Customers (ورقة)', 'Customer_Code, Name, Business_Name, National_ID, Phone, Active. رقم الهوية يُشفَّر عند الاستيراد ولا يُحفظ. احذف الملف بعد الاستيراد', 'National IDs are hashed on import and never stored; delete the file afterwards'],
  ['Customer_Prices (ورقة)', 'سعر خاص لزبون: Customer_Code, SKU, Piece_Price_ILS, Carton_Price_ILS', 'Customer-specific prices'],
  ['Price_Tiers (ورقة)', 'خصم كمية: Customer_Code (فارغ = كل الزبائن), SKU, Unit (piece/carton), Min_Qty, Max_Qty (فارغ = بلا حد), Type (FIXED_PRICE/PERCENT_OFF), Value. الشرائح في الملف تستبدل كل شرائح نفس الـ SKU', 'Tiers in the file replace all tiers of the same SKU; ranges must not overlap'],
];

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Blank template (with 3 fictional example rows), or the current catalog when `withData` is set. */
  async build(withData: boolean): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MdarAi';
    const products = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = [...STORE_COLUMNS, ...WHOLESALE_COLUMNS];
    products.columns = cols.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 4) }));
    products.getColumn('Barcode').numFmt = '@';
    products.getRow(1).font = { bold: true };
    for (const h of WHOLESALE_COLUMNS) {
      products.getRow(1).getCell(cols.indexOf(h) + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4D8FC' } };
    }
    if (withData) {
      const rows = await this.prisma.client.product.findMany({ include: { aliases: true }, orderBy: { sku: 'asc' } });
      for (const p of rows) {
        products.addRow({
          SKU: p.sku, Barcode: p.barcode, Product_Name_AR: p.nameAr, Product_Name_HE: p.nameHe, Product_Name_EN: p.nameEn, Category: p.category,
          Brand: p.brand, Unit: p.defaultPiecePrice !== null ? (p.pieceLabel ?? 'قطعة') : 'كرتونة',
          Price_ILS: p.defaultPiecePrice !== null ? Number(p.defaultPiecePrice) : null, Stock_Qty: p.stockQty, Aisle: p.aisle, Shelf: p.shelf,
          Description_AR: p.descriptionAr, Description_HE: p.descriptionHe, Search_Keywords: p.aliases.map((a) => a.alias).join(','),
          Image_URL: p.imageUrl, Active: p.active ? 'Yes' : 'No', Last_Updated: p.updatedAt.toISOString().slice(0, 10),
          Pieces_Per_Carton: p.piecesPerCarton, Carton_Price_ILS: p.defaultCartonPrice !== null ? Number(p.defaultCartonPrice) : null, Variant: p.variant, Size: p.size,
        });
      }
    } else {
      products.addRow({ SKU: 'P0001', Barcode: '7290000000011', Product_Name_AR: 'حليب 3% لتر', Product_Name_HE: 'חלב 3% ליטר', Product_Name_EN: 'Milk 3% 1L', Category: 'ألبان', Brand: 'Example Brand', Unit: 'قطعة', Price_ILS: 7.9, Stock_Qty: 48, Aisle: 'A1', Shelf: 'S02', Search_Keywords: 'حليب,חלב,milk', Active: 'Yes', Pieces_Per_Carton: 12, Carton_Price_ILS: 88, Variant: '3%', Size: '1 لتر' });
      products.addRow({ SKU: 'P0002', Barcode: '7290000000028', Product_Name_AR: 'أرز بسمتي 1 كغم', Product_Name_HE: 'אורז בסמטי 1 ק״ג', Product_Name_EN: 'Basmati Rice 1kg', Category: 'مواد غذائية', Brand: 'Example Brand', Unit: 'كيس', Price_ILS: 12.5, Aisle: 'B2', Shelf: 'S04', Search_Keywords: 'رز,أرز,אורז,rice', Active: 'Yes', Pieces_Per_Carton: 10, Carton_Price_ILS: 115, Size: '1 كغم' });
      products.addRow({ SKU: 'P0003', Barcode: '7290000000035', Product_Name_AR: 'مياه معدنية 1.5 لتر', Product_Name_HE: 'מים מינרליים 1.5 ליטר', Product_Name_EN: 'Mineral Water 1.5L', Category: 'مشروبات', Brand: 'Example Brand', Unit: 'زجاجة', Price_ILS: 4, Aisle: 'C1', Shelf: 'S01', Search_Keywords: 'مي,ماء,מים,water', Active: 'Yes', Pieces_Per_Carton: 6, Carton_Price_ILS: 21, Size: '1.5 لتر' });
    }
    (products as unknown as { dataValidations: { add: (r: string, v: object) => void } }).dataValidations.add('Q2:Q20000', { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] });

    this.sheet(wb, 'Customers', ['Customer_Code', 'Name', 'Business_Name', 'National_ID', 'Phone', 'Active'], withData ? [] : [['C-2001', 'اسم الزبون', 'اسم المحل', '', '050-0000000', 'Yes']]);
    const cp = withData ? await this.prisma.client.customerPrice.findMany({ include: { customer: true, product: true } }) : [];
    this.sheet(wb, 'Customer_Prices', ['Customer_Code', 'SKU', 'Piece_Price_ILS', 'Carton_Price_ILS'], withData ? cp.map((r) => [r.customer.code, r.product.sku, r.piecePrice ? Number(r.piecePrice) : null, r.cartonPrice ? Number(r.cartonPrice) : null]) : [['C-2001', 'P0001', 7.5, 84]]);
    const tiers = withData ? await this.prisma.client.priceTier.findMany({ include: { customer: true, product: true }, orderBy: [{ productId: 'asc' }, { minQty: 'asc' }] }) : [];
    this.sheet(wb, 'Price_Tiers', ['Customer_Code', 'SKU', 'Unit', 'Min_Qty', 'Max_Qty', 'Type', 'Value'], withData ? tiers.map((t) => [t.customer?.code ?? null, t.product.sku, t.unit, t.minQty, t.maxQty, t.kind, Number(t.value)]) : [[null, 'P0001', 'carton', 10, null, 'FIXED_PRICE', 85], ['C-2001', 'P0001', 'carton', 20, null, 'PERCENT_OFF', 5]]);

    const ins = wb.addWorksheet('Instructions');
    ins.columns = [{ header: 'Field', width: 26 }, { header: 'شرح', width: 90 }, { header: 'Guidance', width: 70 }];
    ins.getRow(1).font = { bold: true };
    INSTRUCTIONS.forEach((r) => ins.addRow(r));
    ins.addRow(['* = عمود جديد', 'الأعمدة المظللة بالبنفسجي اختيارية وغير موجودة في القالب الأصلي', 'Highlighted columns are optional additions']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private sheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: unknown[][]) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = headers.map((h) => ({ header: h, width: Math.max(14, h.length + 4) }));
    ws.getRow(1).font = { bold: true };
    if (headers.includes('National_ID')) ws.getColumn(headers.indexOf('National_ID') + 1).numFmt = '@';
    rows.forEach((r) => ws.addRow(r));
  }
}
