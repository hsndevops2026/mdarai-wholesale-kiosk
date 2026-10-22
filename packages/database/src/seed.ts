/* eslint-disable no-console */
import { CATALOG, CUSTOMERS, CUSTOMER_PRICES, PRICE_TIERS } from './seed-data/catalog';
import { normalizeText } from '@mdarai/product-matcher';
import { isValidIsraeliId } from '@mdarai/shared-types';
import { buildSearchText, createPrismaClient, hashNationalId, hashPassword, hashToken } from './index';

/**
 * Seeds FICTIONAL demo data. Safe to re-run: upserts by natural keys.
 * Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=true.
 */
async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true to override).');
  }
  const pepper = process.env.ID_HASH_PEPPER ?? 'dev-only-pepper-change-me-0000';
  const prisma = createPrismaClient();
  try {
    for (const c of CUSTOMERS) {
      if (!isValidIsraeliId(c.nationalId)) throw new Error(`Seed customer ${c.code} has an invalid ID`);
      const data = { name: c.name, businessName: c.businessName, phone: c.phone, nationalIdHash: hashNationalId(c.nationalId, pepper) };
      await prisma.customer.upsert({ where: { code: c.code }, create: { code: c.code, ...data }, update: data });
    }
    for (const [sku, nameAr, nameHe, brand, category, variant, size, ppc, piece, carton, aliases] of CATALOG) {
      const data = {
        nameAr,
        nameHe,
        brand,
        category,
        variant,
        size,
        piecesPerCarton: ppc,
        defaultPiecePrice: piece,
        defaultCartonPrice: carton,
        searchText: buildSearchText({ sku, nameAr, nameHe, brand, variant, size, aliases }),
      };
      const product = await prisma.product.upsert({ where: { sku }, create: { sku, ...data }, update: data });
      for (const alias of aliases) {
        const aliasNorm = normalizeText(alias);
        await prisma.productAlias.upsert({
          where: { productId_aliasNorm: { productId: product.id, aliasNorm } },
          create: { productId: product.id, alias, aliasNorm },
          update: { alias },
        });
      }
    }
    const customers = new Map((await prisma.customer.findMany()).map((c) => [c.code, c.id]));
    const products = new Map((await prisma.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku, p.id]));
    for (const [code, sku, piecePrice, cartonPrice] of CUSTOMER_PRICES) {
      const customerId = customers.get(code)!;
      const productId = products.get(sku)!;
      await prisma.customerPrice.upsert({
        where: { customerId_productId: { customerId, productId } },
        create: { customerId, productId, piecePrice, cartonPrice },
        update: { piecePrice, cartonPrice },
      });
    }
    await prisma.priceTier.deleteMany({});
    for (const [code, sku, unit, minQty, maxQty, kind, value] of PRICE_TIERS) {
      await prisma.priceTier.create({
        data: { customerId: code ? customers.get(code)! : null, productId: products.get(sku)!, unit, minQty, maxQty, kind, value },
      });
    }
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin-demo-1234';
    const warehousePassword = process.env.SEED_WAREHOUSE_PASSWORD ?? 'warehouse-demo-1234';
    for (const [username, displayName, role, pw] of [
      ['admin', 'مدير (تجريبي)', 'ADMIN', adminPassword],
      ['warehouse', 'المستودع (تجريبي)', 'WAREHOUSE', warehousePassword],
    ] as const) {
      const existing = await prisma.staffUser.findUnique({ where: { username } });
      if (!existing) {
        await prisma.staffUser.create({ data: { username, displayName, role, passwordHash: await hashPassword(pw) } });
      }
    }
    const kioskToken = process.env.SEED_KIOSK_DEVICE_TOKEN ?? 'dev-kiosk-device-token';
    const tokenHash = hashToken(kioskToken);
    if (!(await prisma.kioskDevice.findUnique({ where: { tokenHash } }))) {
      await prisma.kioskDevice.create({ data: { name: 'Demo tablet', tokenHash } });
    }
    console.log(`Seeded ${CATALOG.length} products, ${CUSTOMERS.length} customers, ${CUSTOMER_PRICES.length} customer prices, ${PRICE_TIERS.length} tiers.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
