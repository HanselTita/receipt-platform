import type { SubscriptionPlan } from '../../generated/prisma/client';

export type SubscriptionPlanLimits = {
  maxBranches: number | null;
  maxStaff: number | null;
  monthlyReceipts: number | null;
  analyticsEnabled: boolean;
  customBrandingEnabled: boolean;
};

export const SUBSCRIPTION_PLAN_LIMITS: Record<
  SubscriptionPlan,
  SubscriptionPlanLimits
> = {
  FREE: {
    maxBranches: 1,
    maxStaff: 1,
    monthlyReceipts: 50,
    analyticsEnabled: false,
    customBrandingEnabled: false,
  },

  STARTER: {
    maxBranches: 3,
    maxStaff: 5,
    monthlyReceipts: 500,
    analyticsEnabled: true,
    customBrandingEnabled: true,
  },

  BUSINESS: {
    maxBranches: 10,
    maxStaff: 25,
    monthlyReceipts: 5000,
    analyticsEnabled: true,
    customBrandingEnabled: true,
  },

  PRO: {
    maxBranches: null,
    maxStaff: null,
    monthlyReceipts: null,
    analyticsEnabled: true,
    customBrandingEnabled: true,
  },
};
