-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "stateOrProvince" TEXT,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "receiptPrefix" TEXT NOT NULL DEFAULT 'RCP',
    "nextReceiptNumber" INTEGER NOT NULL DEFAULT 1,
    "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
