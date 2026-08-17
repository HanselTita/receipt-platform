-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "scheduledPlan" "SubscriptionPlan",
ADD COLUMN     "scheduledPlanAt" TIMESTAMP(3);
