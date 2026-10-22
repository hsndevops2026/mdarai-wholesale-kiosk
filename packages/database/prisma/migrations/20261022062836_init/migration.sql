-- CreateEnum
CREATE TYPE "SalesUnit" AS ENUM ('piece', 'carton');

-- CreateEnum
CREATE TYPE "TierKind" AS ENUM ('FIXED_PRICE', 'PERCENT_OFF');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrintStatus" AS ENUM ('PENDING', 'PRINTING', 'PRINTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrintJobKind" AS ENUM ('AUTO', 'REPRINT');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('WAREHOUSE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ClarificationStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameHe" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "variant" TEXT,
    "size" TEXT,
    "imageUrl" TEXT,
    "piecesPerCarton" INTEGER NOT NULL,
    "defaultPiecePrice" DECIMAL(12,2),
    "defaultCartonPrice" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasNorm" TEXT NOT NULL,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SynonymGroup" (
    "id" TEXT NOT NULL,
    "terms" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SynonymGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPrice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "piecePrice" DECIMAL(12,2),
    "cartonPrice" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT,
    "unit" "SalesUnit" NOT NULL,
    "minQty" INTEGER NOT NULL,
    "maxQty" INTEGER,
    "kind" "TierKind" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "lastSpokenProduct" TEXT,

    CONSTRAINT "KioskSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unit" "SalesUnit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clarification" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "spokenProduct" TEXT NOT NULL,
    "quantity" INTEGER,
    "unit" "SalesUnit",
    "newUnit" "SalesUnit",
    "productId" TEXT,
    "options" JSONB NOT NULL,
    "status" "ClarificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Clarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedUtterance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "utteranceId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "parser" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedUtterance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "deviceId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "printStatus" "PrintStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "pricesIncludeVat" BOOLEAN NOT NULL,
    "vatRate" DECIMAL(5,4) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL,
    "vat" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameHe" TEXT,
    "variant" TEXT,
    "size" TEXT,
    "unit" "SalesUnit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "piecesPerCarton" INTEGER NOT NULL,
    "listUnitPrice" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "pricingRule" TEXT NOT NULL,
    "tierId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus" NOT NULL,
    "toStatus" "OrderStatus" NOT NULL,
    "staffUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCounter" (
    "day" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "DailyCounter_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "PrintJobKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "PrintStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "lastError" TEXT,
    "printedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "summary" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_nationalIdHash_key" ON "Customer"("nationalIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "ProductAlias_aliasNorm_idx" ON "ProductAlias"("aliasNorm");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_productId_aliasNorm_key" ON "ProductAlias"("productId", "aliasNorm");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPrice_customerId_productId_key" ON "CustomerPrice"("customerId", "productId");

-- CreateIndex
CREATE INDEX "PriceTier_productId_idx" ON "PriceTier"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "KioskSession_tokenHash_key" ON "KioskSession"("tokenHash");

-- CreateIndex
CREATE INDEX "KioskSession_endedAt_expiresAt_idx" ON "KioskSession"("endedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_sessionId_productId_unit_key" ON "CartItem"("sessionId", "productId", "unit");

-- CreateIndex
CREATE INDEX "Clarification_sessionId_status_idx" ON "Clarification"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedUtterance_sessionId_utteranceId_key" ON "ProcessedUtterance"("sessionId", "utteranceId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_dedupeKey_key" ON "PrintJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "PrintJob_status_nextAttemptAt_idx" ON "PrintJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_username_key" ON "StaffUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSession" ADD CONSTRAINT "KioskSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSession" ADD CONSTRAINT "KioskSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KioskSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KioskSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedUtterance" ADD CONSTRAINT "ProcessedUtterance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KioskSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KioskSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions (not expressible in Prisma schema)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Trigram index for touch/typed catalog search.
CREATE INDEX "Product_searchText_trgm_idx" ON "Product" USING gin ("searchText" gin_trgm_ops);
CREATE INDEX "ProductAlias_aliasNorm_trgm_idx" ON "ProductAlias" USING gin ("aliasNorm" gin_trgm_ops);

-- Money and quantity sanity checks.
ALTER TABLE "Product" ADD CONSTRAINT "Product_piecesPerCarton_check" CHECK ("piecesPerCarton" >= 1);
ALTER TABLE "Product" ADD CONSTRAINT "Product_prices_check" CHECK (
  ("defaultPiecePrice" IS NULL OR "defaultPiecePrice" >= 0) AND
  ("defaultCartonPrice" IS NULL OR "defaultCartonPrice" >= 0) AND
  ("defaultPiecePrice" IS NOT NULL OR "defaultCartonPrice" IS NOT NULL)
);
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_prices_check" CHECK (
  ("piecePrice" IS NULL OR "piecePrice" >= 0) AND ("cartonPrice" IS NULL OR "cartonPrice" >= 0)
);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" >= 1);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" >= 1);
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_range_check" CHECK (
  "minQty" >= 1 AND ("maxQty" IS NULL OR "maxQty" >= "minQty") AND "value" > 0 AND
  ("kind" <> 'PERCENT_OFF' OR "value" < 100)
);

-- No two tiers for the same product/customer/unit may cover the same quantity.
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_no_overlap" EXCLUDE USING gist (
  "productId" WITH =,
  (COALESCE("customerId", '*')) WITH =,
  "unit" WITH =,
  int4range("minQty", "maxQty", '[]') WITH &&
);
