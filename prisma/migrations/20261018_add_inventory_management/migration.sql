-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'RESTOCK', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('PIECE', 'KG', 'GRAM', 'LITRE', 'ML', 'METRE', 'CM', 'PACK', 'BOX');

-- AlterTable
ALTER TABLE "ReceiptItem" ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "costPrice" DECIMAL(18,2),
    "sellingPrice" DECIMAL(18,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unit" "ProductUnit" NOT NULL DEFAULT 'PIECE',

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchStock" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "referenceStock" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "lowStockPercent" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "receiptItemId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantityChange" DECIMAL(18,3) NOT NULL,
    "quantityAfter" DECIMAL(18,3) NOT NULL,
    "note" TEXT,
    "transferGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_businessId_name_idx" ON "Product"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "Product"("businessId", "sku");

-- CreateIndex
CREATE INDEX "BranchStock_branchId_idx" ON "BranchStock"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchStock_branchId_productId_key" ON "BranchStock"("branchId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_branchId_createdAt_idx" ON "StockMovement"("businessId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_receiptItemId_idx" ON "StockMovement"("receiptItemId");

-- CreateIndex
CREATE INDEX "StockMovement_transferGroupId_idx" ON "StockMovement"("transferGroupId");

-- CreateIndex
CREATE INDEX "ReceiptItem_productId_idx" ON "ReceiptItem"("productId");

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "ReceiptItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Inventory integrity constraints

ALTER TABLE "BranchStock"
ADD CONSTRAINT "BranchStock_quantity_nonnegative"
CHECK ("quantity" >= 0);

ALTER TABLE "BranchStock"
ADD CONSTRAINT "BranchStock_referenceStock_nonnegative"
CHECK ("referenceStock" >= 0);

ALTER TABLE "BranchStock"
ADD CONSTRAINT "BranchStock_lowStockPercent_range"
CHECK ("lowStockPercent" BETWEEN 0 AND 100);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_sellingPrice_nonnegative"
CHECK ("sellingPrice" >= 0);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_costPrice_nonnegative"
CHECK ("costPrice" IS NULL OR "costPrice" >= 0);

