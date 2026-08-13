-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "correctedAt" TIMESTAMP(3),
ADD COLUMN     "correctedByUserId" TEXT,
ADD COLUMN     "correctionReason" TEXT,
ADD COLUMN     "originalReceiptId" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_correctedByUserId_idx" ON "Receipt"("correctedByUserId");

-- CreateIndex
CREATE INDEX "Receipt_originalReceiptId_idx" ON "Receipt"("originalReceiptId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_originalReceiptId_fkey" FOREIGN KEY ("originalReceiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
