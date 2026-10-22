-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "aisle" TEXT,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "shelf" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aisle" TEXT,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "descriptionAr" TEXT,
ADD COLUMN     "descriptionHe" TEXT,
ADD COLUMN     "nameEn" TEXT,
ADD COLUMN     "pieceLabel" TEXT,
ADD COLUMN     "shelf" TEXT,
ADD COLUMN     "stockQty" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");


ALTER TABLE "Product" ADD CONSTRAINT "Product_stockQty_check" CHECK ("stockQty" IS NULL OR "stockQty" >= 0);
