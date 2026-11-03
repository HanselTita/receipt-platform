import type { SubscriptionPlan } from '../../generated/prisma/client';

export type SubscriptionPlanMetadata = {
  name: string;
  description: string;
  recommended: boolean;
};

export const SUBSCRIPTION_PLAN_METADATA: Record<SubscriptionPlan, SubscriptionPlanMetadata> = {
  FREE: {
    name: 'Free',
    description: 'For individuals and very small businesses getting started with digital receipts.',
    recommended: false,
  },

  STARTER: {
    name: 'Starter',
    description:
      'For small businesses that need more receipts, staff, branches, and inventory management.',
    recommended: true,
  },

  BUSINESS: {
    name: 'Business',
    description:
      'For growing businesses managing multiple locations, larger teams, and branch-specific inventory.',
    recommended: false,
  },

  PRO: {
    name: 'Pro',
    description:
      'For high-volume businesses that need unlimited receipts, staff, branches, and inventory management.',
    recommended: false,
  },
};
