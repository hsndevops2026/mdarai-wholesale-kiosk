import { expect, test, type Page } from '@playwright/test';

const DEVICE_TOKEN = process.env.SEED_KIOSK_DEVICE_TOKEN ?? 'dev-kiosk-device-token';

async function registerDevice(page: Page) {
  await page.goto('/kiosk');
  await page.getByLabel('رمز الجهاز').fill(DEVICE_TOKEN);
  await page.getByRole('button', { name: 'حفظ' }).click();
}

async function login(page: Page, id: string) {
  for (const d of id) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByTestId('customer-name')).toContainText('أبو أحمد');
}

async function say(page: Page, text: string) {
  await page.getByTestId('order-text').fill(text);
  await page.getByRole('button', { name: 'أرسل' }).click();
}

test('mixed Arabic/Hebrew order, clarification, quantity replacement, confirmation', async ({ page }) => {
  await registerDevice(page);
  await login(page, '000000018');

  await say(page, 'بدي خمس كراتين חלב תנובה وثلاث كراتين زيت');
  const clar = page.getByTestId('clarification');
  await expect(clar).toHaveCount(2);
  await clar.first().getByRole('button', { name: /حليب تنوفا 3% 1 لتر/ }).click();
  await expect(clar).toHaveCount(1);
  await clar.first().getByRole('button', { name: /زيت عباد الشمس 1 لتر/ }).click();
  await expect(clar).toHaveCount(0);

  const lines = page.getByTestId('cart-line');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText('حليب تنوفا 3% 1 لتر');
  await expect(lines.nth(0).getByTestId('cart-line-qty')).toHaveText('5');
  await expect(lines.nth(1).getByTestId('cart-line-qty')).toHaveText('3');

  await say(page, 'خلي الحليب سبع كراتين بدل خمس');
  await expect(lines.nth(0).getByTestId('cart-line-qty')).toHaveText('7');
  await expect(lines).toHaveCount(2);

  // touch edit: + on the oil line
  await lines.nth(1).getByRole('button', { name: 'زيد' }).click();
  await expect(lines.nth(1).getByTestId('cart-line-qty')).toHaveText('4');

  // customer-specific prices: 7 x 74.00 + 4 x 112.00 = 966.00, +18% VAT = 1139.88
  await expect(page.getByTestId('cart-total')).toContainText('1,139.88');

  await page.getByRole('button', { name: 'مراجعة الطلبية' }).click();
  await expect(page.getByTestId('review-total')).toContainText('1,139.88');
  await page.getByRole('button', { name: 'تأكيد الطلبية' }).click();
  await expect(page.getByTestId('order-number')).toHaveText(/^W-\d{8}-\d{4}$/);

  await page.getByRole('button', { name: 'إنهاء' }).click();
  await expect(page.getByText('أدخل رقم الهوية')).toBeVisible();
});

test('rejects an unknown ID without revealing anything', async ({ page }) => {
  await registerDevice(page);
  for (const d of '000000042') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByText('لم نجد حساباً بهذا الرقم')).toBeVisible();
});
