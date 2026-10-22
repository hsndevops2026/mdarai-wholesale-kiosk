import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin-demo-1234';
const DEVICE_TOKEN = process.env.SEED_KIOSK_DEVICE_TOKEN ?? 'dev-kiosk-device-token';

/** A file in the store's template format, plus the optional carton columns. */
async function storeTemplateFile(sku: string, name: string, keyword: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.addRow(['SKU', 'Barcode', 'Product_Name_AR', 'Product_Name_HE', 'Product_Name_EN', 'Category', 'Brand', 'Unit', 'Price_ILS', 'Stock_Qty', 'Aisle', 'Shelf', 'Description_AR', 'Description_HE', 'Search_Keywords', 'Image_URL', 'Active', 'Last_Updated', 'Pieces_Per_Carton', 'Carton_Price_ILS']);
  ws.addRow([sku, null, name, 'מוצר בדיקה', 'Test product', 'اختبار', 'Example Brand', 'علبة', 3.5, 10, 'Z9', 'S1', null, null, keyword, null, 'Yes', '2026-10-22', 24, 70]);
  wb.addWorksheet('Instructions').addRow(['Field', 'Guidance']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('admin imports the store template and the product can be ordered at once', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const sku = `E2E-${suffix}`.toUpperCase();
  const keyword = `قضامة${suffix.replace(/\d/g, '')}`;

  await page.goto('/admin');
  await page.getByLabel('اسم المستخدم').fill('admin');
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('ملف الإكسل').setInputFiles({ name: 'store.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await storeTemplateFile(sku, 'قضامة محمصة اختبار', keyword) });
  await page.getByRole('button', { name: 'معاينة' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('منتجات جديدة');
  await expect(preview).toContainText('1');
  await page.getByRole('button', { name: 'تأكيد الاستيراد' }).click();
  await expect(page.getByTestId('import-done')).toContainText('1 منتج جديد');

  // order it from the kiosk by its keyword
  await page.goto('/kiosk');
  await page.evaluate((t) => localStorage.setItem('mdarai.kiosk.deviceToken', t), DEVICE_TOKEN);
  await page.reload();
  for (const d of '000000034') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByTestId('order-text').fill(`بدي كرتونتين ${keyword}`);
  await page.getByRole('button', { name: 'أرسل' }).click();
  const line = page.getByTestId('cart-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('قضامة محمصة اختبار');
  await expect(line.getByTestId('cart-line-qty')).toHaveText('2');
  await expect(page.getByTestId('cart-total')).toContainText('165.20'); // 2 x 70.00 + 18% VAT
  await page.getByRole('button', { name: 'خروج' }).click();
});
