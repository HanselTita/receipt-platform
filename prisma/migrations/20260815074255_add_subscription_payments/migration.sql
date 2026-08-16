-- CreateEnum
CREATE TYPE "SubscriptionBillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('FLUTTERWAVE', 'STRIPE');

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "billingPeriod" "SubscriptionBillingPeriod" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerTransactionId" TEXT,
    "providerReference" TEXT,
    "checkoutUrl" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "initiatedByUserId" TEXT,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_reference_key" ON "SubscriptionPayment"("reference");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_businessId_idx" ON "SubscriptionPayment"("businessId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_subscriptionId_idx" ON "SubscriptionPayment"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_initiatedByUserId_idx" ON "SubscriptionPayment"("initiatedByUserId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_status_idx" ON "SubscriptionPayment"("status");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_provider_idx" ON "SubscriptionPayment"("provider");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_createdAt_idx" ON "SubscriptionPayment"("createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_providerTransactionId_idx" ON "SubscriptionPayment"("providerTransactionId");

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
