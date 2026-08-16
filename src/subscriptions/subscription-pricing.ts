import type { SubscriptionPlan } from '../../generated/prisma/client';

export type SubscriptionBillingPeriod = 'MONTHLY' | 'ANNUAL';

export type SubscriptionPlanPrice = {
  monthly: number;
  annual: number;
  currency: string;
};

export type SubscriptionPricingMarket = 'CM' | 'GLOBAL';

export type SubscriptionPricingCatalogue = Record<
  SubscriptionPlan,
  SubscriptionPlanPrice
>;

export const SUBSCRIPTION_PRICING: Record<
  SubscriptionPricingMarket,
  SubscriptionPricingCatalogue
> = {
  /*
   * Cameroon pricing.
   *
   * PayUnit local Mobile Money checkout uses XAF.
   */
  CM: {
    FREE: {
      monthly: 0,
      annual: 0,
      currency: 'XAF',
    },

    STARTER: {
      monthly: 3000,
      annual: 30000,
      currency: 'XAF',
    },

    BUSINESS: {
      monthly: 7500,
      annual: 75000,
      currency: 'XAF',
    },

    PRO: {
      monthly: 15000,
      annual: 150000,
      currency: 'XAF',
    },
  },

  /*
   * Default international catalogue.
   *
   * Later Stripe, Paystack, dLocal, etc. can have
   * additional country-specific price books.
   */
  GLOBAL: {
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
  },
};

export function getSubscriptionPricing(
  market: SubscriptionPricingMarket,
  plan: SubscriptionPlan,
): SubscriptionPlanPrice {
  return SUBSCRIPTION_PRICING[market][plan];
}
