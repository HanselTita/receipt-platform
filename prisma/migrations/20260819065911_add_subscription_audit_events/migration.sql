-- CreateEnum
CREATE TYPE "SubscriptionAuditEventType" AS ENUM ('CHECKOUT_CREATED', 'CHECKOUT_RETRIED', 'PAYMENT_PROCESSING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_CHANGED', 'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_DOWNGRADED', 'SCHEDULED_CHANGE_CREATED', 'SCHEDULED_CHANGE_CANCELLED');

-- CreateTable
CREATE TABLE "SubscriptionAuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" "SubscriptionAuditEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "paymentId" TEXT,
    "actorUserId" TEXT,

    CONSTRAINT "SubscriptionAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionAuditEvent_businessId_idx" ON "SubscriptionAuditEvent"("businessId");

-- CreateIndex
CREATE INDEX "SubscriptionAuditEvent_subscriptionId_idx" ON "SubscriptionAuditEvent"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionAuditEvent_paymentId_idx" ON "SubscriptionAuditEvent"("paymentId");

-- CreateIndex
CREATE INDEX "SubscriptionAuditEvent_actorUserId_idx" ON "SubscriptionAuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "SubscriptionAuditEvent_eventType_idx" ON "SubscriptionAuditEvent"("eventType");

-- CreateIndex
CREATE INDEX "SubscriptionAuditEvent_createdAt_idx" ON "SubscriptionAuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionAuditEvent" ADD CONSTRAINT "SubscriptionAuditEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionAuditEvent" ADD CONSTRAINT "SubscriptionAuditEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionAuditEvent" ADD CONSTRAINT "SubscriptionAuditEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SubscriptionPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionAuditEvent" ADD CONSTRAINT "SubscriptionAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
