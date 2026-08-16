import type { SubscriptionPlan } from '../../generated/prisma/client';

export type SubscriptionBillingPeriod = 'MONTHLY' | 'ANNUAL';

export type SubscriptionPlanPrice = {
  monthly: number;
  annual: number;
  currency: string;
};

export const SUBSCRIPTION_PLAN_PRICING: Record<
  SubscriptionPlan,
  SubscriptionPlanPrice
> = {
  FREE: {
    monthly: 0,
    annual: 0,
    currency: 'USD',
  },

  STARTER: {
    monthly: 4.99,
    annual: 49.99,
    currency: 'USD',
  },

  BUSINESS: {
    monthly: 12.99,
    annual: 129.99,
    currency: 'USD',
  },

  PRO: {
    monthly: 24.99,
    annual: 249.99,
    currency: 'USD',
  },
};
