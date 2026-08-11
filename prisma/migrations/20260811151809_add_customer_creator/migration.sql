-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Customer_createdByUserId_idx" ON "Customer"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
