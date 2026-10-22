import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseImport, readWorkbook } from './import-parser';

const hash = (id: string) => `h:${id.length}`;

/** Columns exactly as in the store's "MdarAi_Wholesale_Products_Template.xlsx". */
const TEMPLATE_HEADERS = ['SKU', 'Barcode', 'Product_Name_AR', 'Product_Name_HE', 'Product_Name_EN', 'Category', 'Brand', 'Unit', 'Price_ILS', 'Stock_Qty', 'Aisle', 'Shelf', 'Description_AR', 'Description_HE', 'Search_Keywords', 'Image_URL', 'Active', 'Last_Updated'];

async function workbook(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function parse(sheets: Record<string, unknown[][]>) {
  return parseImport(await readWorkbook(await workbook(sheets), 'f.xlsx'), { hashNationalId: hash });
}

describe('Excel import parser', () => {
  it('reads the store template unchanged (piece unit + price, keywords, location)', async () => {
    const r = await parse({
      Products: [
        TEMPLATE_HEADERS,
        ['P0001', '7290000000011', 'حليب 3% لتر', 'חלב 3% ליטר', 'Milk 3% 1L', 'ألبان', 'Example Brand', 'قطعة', 7.9, 48, 'A1', 'S02', 'حليب طازج 3%', 'חלב טרי 3%', 'حليب,لبن,חלב,milk', null, 'Yes', '2026-10-22'],
        ['P0002', '0729000000028', 'أرز بسمتي 1 كغم', 'אורז בסמטי 1 ק״ג', 'Basmati Rice 1kg', 'مواد غذائية', 'Example Brand', 'كيس', 12.5, 22, 'B2', 'S04', null, null, 'رز,أرز,אורז,rice', null, 'No', null],
        [],
      ],
      Instructions: [['Field', 'Guidance']],
    });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.products).toHaveLength(2);
    expect(r.products[0]).toMatchObject({
      sku: 'P0001',
      barcode: '7290000000011',
      pieceLabel: null, // "قطعة" is the default
      piecePrice: '7.90',
      cartonPrice: null,
      piecesPerCarton: 1,
      stockQty: 48,
      aisle: 'A1',
      shelf: 'S02',
      keywords: ['حليب', 'لبن', 'חלב', 'milk'],
      active: true,
    });
    expect(r.products[1]).toMatchObject({ barcode: '0729000000028', pieceLabel: 'كيس', active: false });
  });

  it('supports the optional wholesale columns and refuses to guess pieces per carton', async () => {
    const r = await parse({
      Products: [
        [...TEMPLATE_HEADERS, 'Pieces_Per_Carton', 'Carton_Price_ILS'],
        ['A1', null, 'زيت', null, null, null, null, 'قطعة', '10.90', null, null, null, null, null, null, null, null, null, 12, '120'],
        ['A2', null, 'سكر', null, null, null, null, 'قطعة', '5', null, null, null, null, null, null, null, null, null, null, '50'],
        ['A3', null, 'طحين 25 كيلو', null, null, null, null, 'كرتونة', 95, null, null, null, null, null, null, null, null, null, 1, null],
      ],
    });
    expect(r.products.map((p) => [p.sku, p.piecePrice, p.cartonPrice, p.piecesPerCarton])).toEqual([
      ['A1', '10.90', '120.00', 12],
      ['A3', null, '95.00', 1],
    ]);
    expect(r.issues).toContainEqual(expect.objectContaining({ row: 3, column: 'pieces_per_carton', severity: 'error' }));
  });

  it('flags duplicates, bad prices and missing required fields with row numbers', async () => {
    const r = await parse({
      Products: [
        TEMPLATE_HEADERS,
        ['X1', '111111', 'أ', null, null, null, null, 'قطعة', 1, null, null, null, null, null, null, null, 'Yes'],
        ['x1', '111111', 'ب', null, null, null, null, 'قطعة', 2, null, null, null, null, null, null, null, 'Yes'],
        ['X2', null, null, null, null, null, null, 'قطعة', 'abc', null, null, null, null, null, null, null, 'maybe'],
        ['X3', null, 'ج', null, null, null, null, 'قطعة', 1.234, null, null, null, null, null, null, null, null],
      ],
    });
    const at = (row: number) => r.issues.filter((i) => i.row === row && i.severity === 'error').map((i) => i.column);
    expect(at(3)).toEqual(expect.arrayContaining(['sku', 'barcode']));
    expect(at(4)).toEqual(expect.arrayContaining(['product_name_ar', 'price_ils', 'active']));
    expect(at(5)).toEqual(['price_ils']);
    expect(r.products.map((p) => p.sku)).toEqual(['X1']);
  });

  it('warns when a barcode was stored as a number', async () => {
    const r = await parse({ Products: [TEMPLATE_HEADERS, ['B1', 7290000000011, 'منتج', null, null, null, null, 'قطعة', 3]] });
    expect(r.products[0].barcode).toBe('7290000000011');
    expect(r.issues).toContainEqual(expect.objectContaining({ column: 'barcode', severity: 'warning' }));
  });

  it('hashes national IDs and never echoes them', async () => {
    const r = await parse({
      Customers: [
        ['Customer_Code', 'Name', 'Business_Name', 'National_ID', 'Phone', 'Active'],
        ['c-9', 'زبون', 'محل', '000000018', '050', 'Yes'],
        ['C-10', 'زبون2', 'محل2', '123456789', null, null],
      ],
    });
    expect(r.customers).toEqual([expect.objectContaining({ code: 'C-9', nationalIdHash: 'h:9' })]);
    expect(JSON.stringify(r)).not.toContain('000000018');
    expect(JSON.stringify(r.issues)).not.toContain('123456789');
  });

  it('parses customer prices and rejects overlapping tiers', async () => {
    const r = await parse({
      Customer_Prices: [['Customer_Code', 'SKU', 'Piece_Price_ILS', 'Carton_Price_ILS'], ['C-1', 'A1', null, 70]],
      Price_Tiers: [
        ['Customer_Code', 'SKU', 'Unit', 'Min_Qty', 'Max_Qty', 'Type', 'Value'],
        [null, 'A1', 'carton', 10, 19, 'FIXED_PRICE', 72],
        [null, 'A1', 'كرتونة', 15, null, 'PERCENT_OFF', 5],
        ['C-1', 'A1', 'carton', 15, null, 'percent', 5],
      ],
    });
    expect(r.customerPrices).toEqual([expect.objectContaining({ customerCode: 'C-1', sku: 'A1', cartonPrice: '70.00', piecePrice: null })]);
    expect(r.tiers).toHaveLength(3);
    expect(r.issues).toContainEqual(expect.objectContaining({ sheet: 'Price_Tiers', row: 3, severity: 'error' }));
  });

  it('reads CSV with the same headers', async () => {
    const csv = '﻿SKU,Product_Name_AR,Unit,Price_ILS,Search_Keywords\nC1,ملح,قطعة,2.5,"ملح,מלח"\n';
    const r = parseImport(await readWorkbook(Buffer.from(csv), 'p.csv'), { hashNationalId: hash });
    expect(r.products[0]).toMatchObject({ sku: 'C1', piecePrice: '2.50', keywords: ['ملح', 'מלח'] });
  });
});
