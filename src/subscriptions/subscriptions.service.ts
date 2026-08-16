import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import type {
  SubscriptionBillingPeriod,
  SubscriptionPlan,
} from '../../generated/prisma/client';

import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PrismaService } from '../prisma/prisma.service';

import { SUBSCRIPTION_PLAN_METADATA } from './subscription-plan-catalog';
import { SUBSCRIPTION_PLAN_LIMITS } from './subscription-plans';
import {
  getSubscriptionPricing,
  SUBSCRIPTION_PRICING,
  type SubscriptionPricingMarket,
} from './subscription-pricing';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
  ) {}

  /*
   * Return the subscription attached to a business.
   *
   * Older businesses may not yet have a Subscription row,
   * so we safely treat them as FREE.
   */
  async getBusinessSubscription(businessId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId,
      },
    });

    if (!subscription) {
      return {
        id: null,
        businessId,
        plan: 'FREE' as const,
        status: 'ACTIVE' as const,
        startsAt: null,
        endsAt: null,
        limits: SUBSCRIPTION_PLAN_LIMITS.FREE,
      };
    }

    return {
      ...subscription,
      limits: SUBSCRIPTION_PLAN_LIMITS[subscription.plan],
    };
  }

  /*
   * Get the current authenticated owner's subscription,
   * usage and plan limits.
   *
   * Used by:
   *
   * GET /subscriptions/me
   */
  async getMySubscription(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        id: true,
        role: true,
        businessId: true,

        business: {
          select: {
            id: true,
            businessName: true,
            defaultCurrency: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    /*
     * Subscription management belongs to the owner.
     */
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can view subscription information.',
      );
    }

    const subscription = await this.getBusinessSubscription(
      membership.businessId,
    );

    const now = new Date();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    /*
     * Calculate current subscription usage.
     */
    const [branches, staff, receiptsThisMonth] = await this.prisma.$transaction(
      [
        this.prisma.branch.count({
          where: {
            businessId: membership.businessId,

            isActive: true,
          },
        }),

        this.prisma.businessMembership.count({
          where: {
            businessId: membership.businessId,

            status: 'ACTIVE',

            role: {
              not: 'OWNER',
            },
          },
        }),

        this.prisma.receipt.count({
          where: {
            businessId: membership.businessId,

            issuedAt: {
              gte: monthStart,
              lt: nextMonthStart,
            },
          },
        }),
      ],
    );

    const limits = subscription.limits;

    /*
     * null means unlimited.
     */
    const remaining = {
      branches:
        limits.maxBranches === null
          ? null
          : Math.max(limits.maxBranches - branches, 0),

      staff:
        limits.maxStaff === null ? null : Math.max(limits.maxStaff - staff, 0),

      receiptsThisMonth:
        limits.monthlyReceipts === null
          ? null
          : Math.max(limits.monthlyReceipts - receiptsThisMonth, 0),
    };

    return {
      business: membership.business,

      subscription: {
        id: subscription.id,

        plan: subscription.plan,

        status: subscription.status,

        startsAt: subscription.startsAt,

        endsAt: subscription.endsAt,
      },

      limits,

      usage: {
        branches,
        staff,
        receiptsThisMonth,
      },

      remaining,

      billingPeriod: {
        monthStart,
        nextMonthStart,
      },
    };
  }

  /*
   * Analytics access.
   */
  async assertAnalyticsAllowed(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    if (!subscription.limits.analyticsEnabled) {
      throw new ForbiddenException(
        'Analytics are not available on your current subscription plan.',
      );
    }
  }

  /*
   * Branch creation limit.
   */
  async assertCanCreateBranch(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    const limit = subscription.limits.maxBranches;

    if (limit === null) {
      return;
    }

    const branchCount = await this.prisma.branch.count({
      where: {
        businessId,
        isActive: true,
      },
    });

    if (branchCount >= limit) {
      throw new ForbiddenException(
        `Your ${subscription.plan} plan allows up to ${limit} active branch${
          limit === 1 ? '' : 'es'
        }.`,
      );
    }
  }

  /*
   * Staff-member limit.
   */
  async assertCanAddStaff(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    const limit = subscription.limits.maxStaff;

    if (limit === null) {
      return;
    }

    const staffCount = await this.prisma.businessMembership.count({
      where: {
        businessId,

        status: 'ACTIVE',

        role: {
          not: 'OWNER',
        },
      },
    });

    if (staffCount >= limit) {
      throw new ForbiddenException(
        `Your ${subscription.plan} plan allows up to ${limit} staff member${
          limit === 1 ? '' : 's'
        }.`,
      );
    }
  }

  /*
   * Monthly receipt limit.
   */
  async assertCanIssueReceipt(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    const limit = subscription.limits.monthlyReceipts;

    if (limit === null) {
      return;
    }

    const now = new Date();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const receiptCount = await this.prisma.receipt.count({
      where: {
        businessId,

        issuedAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
    });

    if (receiptCount >= limit) {
      throw new ForbiddenException(
        `Your ${subscription.plan} plan allows up to ${limit} receipts per month.`,
      );
    }
  }

  /*
   * Business logo / receipt-footer branding.
   */
  async assertCustomBrandingAllowed(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    if (!subscription.limits.customBrandingEnabled) {
      throw new ForbiddenException(
        'Custom branding is not available on your current subscription plan.',
      );
    }
  }

  /*
   * Return available subscription plans.
   *
   * GLOBAL remains the default so this endpoint
   * remains backwards compatible.
   */
  async getPlans(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        business: {
          select: {
            branches: {
              where: {
                isMainBranch: true,
              },

              orderBy: {
                createdAt: 'asc',
              },

              take: 1,

              select: {
                country: true,
              },
            },
          },
        },
      },
    });

    const mainBranch = membership?.business.branches[0];

    const market = this.resolvePricingMarket(mainBranch?.country);

    const planCodes = ['FREE', 'STARTER', 'BUSINESS', 'PRO'] as const;

    return {
      market,

      plans: planCodes.map((code) => {
        const metadata = SUBSCRIPTION_PLAN_METADATA[code];

        const pricing = SUBSCRIPTION_PRICING[market][code];

        const limits = SUBSCRIPTION_PLAN_LIMITS[code];

        return {
          code,

          name: metadata.name,

          description: metadata.description,

          recommended: metadata.recommended,

          pricing: {
            currency: pricing.currency,

            monthly: pricing.monthly,

            annual: pricing.annual,
          },

          limits,
        };
      }),
    };
  }

  /*
   * Create and initialize a paid subscription checkout.
   *
   * The mobile application supplies:
   *
   * - desired plan
   * - billing period
   *
   * It does NOT supply:
   *
   * - price
   * - currency
   * - payment provider
   *
   * Those values are controlled by the backend.
   */
  async createCheckout(
    userId: string,
    plan: SubscriptionPlan,
    billingPeriod: SubscriptionBillingPeriod,
  ) {
    /*
     * 1. Find the owner's active business.
     *
     * We also load the main branch so the backend can
     * determine the appropriate regional pricing market.
     */
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        id: true,
        role: true,
        businessId: true,

        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },

        business: {
          select: {
            id: true,
            businessName: true,

            branches: {
              where: {
                isMainBranch: true,
              },

              orderBy: {
                createdAt: 'asc',
              },

              take: 1,

              select: {
                country: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    /*
     * 2. Only the business owner can manage billing.
     */
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can manage subscription billing.',
      );
    }

    /*
     * FREE never requires payment checkout.
     */
    if (plan === 'FREE') {
      throw new ForbiddenException('The FREE plan does not require checkout.');
    }

    /*
     * 3. Load the business subscription.
     */
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId: membership.businessId,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Business subscription could not be found.');
    }

    /*
     * Prevent unnecessary checkout when already
     * subscribed to the selected active plan.
     */
    if (subscription.plan === plan && subscription.status === 'ACTIVE') {
      throw new ForbiddenException(
        `Your business is already on the ${plan} plan.`,
      );
    }

    /*
     * 4. Determine the pricing market from the
     * business's main branch.
     */
    const mainBranch = membership.business.branches[0];

    const market = this.resolvePricingMarket(mainBranch?.country);

    /*
     * 5. Obtain the official backend-controlled price.
     */
    const pricing = getSubscriptionPricing(market, plan);

    const amount =
      billingPeriod === 'MONTHLY' ? pricing.monthly : pricing.annual;

    if (amount <= 0) {
      throw new ForbiddenException(
        'The selected plan does not require payment.',
      );
    }

    /*
     * For the first production payment provider,
     * only Cameroon checkout is available.
     *
     * Other markets will later resolve to:
     *
     * PAYSTACK
     * STRIPE
     * DLOCAL
     * etc.
     */
    if (market !== 'CM') {
      throw new ForbiddenException(
        'Online subscription payments are not yet available for this country.',
      );
    }

    const provider = 'PAYUNIT' as const;

    /*
     * PayUnit hosted checkout links are short-lived.
     */
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    /*
     * Generate our own internal SwiftReceipt
     * transaction reference.
     */
    const reference = this.generatePaymentReference();

    /*
     * 6. Create our internal payment record BEFORE
     * contacting the external payment provider.
     *
     * This gives SwiftReceipt an authoritative record
     * regardless of what happens at the provider.
     */
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        reference,

        plan,

        billingPeriod,

        amount: amount.toFixed(2),

        currency: pricing.currency,

        provider,

        status: 'PENDING',

        expiresAt,

        businessId: membership.businessId,

        subscriptionId: subscription.id,

        initiatedByUserId: userId,
      },

      select: {
        id: true,
        reference: true,
        plan: true,
        billingPeriod: true,
        amount: true,
        currency: true,
        provider: true,
        status: true,
        checkoutUrl: true,
        providerReference: true,
        providerTransactionId: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    try {
      /*
       * 7. Resolve the appropriate payment provider.
       */
      const adapter = this.paymentProviderRegistry.get(provider);

      /*
       * 8. Ask PayUnit to initialize hosted checkout.
       */
      const initialized = await adapter.initializePayment({
        reference: payment.reference,

        amount: payment.amount.toString(),

        currency: payment.currency,

        customer: {
          email: membership.user.email,

          name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),

          phone: membership.user.phone,
        },

        description: `SwiftReceipt ${plan} ${billingPeriod.toLowerCase()} subscription`,

        metadata: {
          businessId: membership.businessId,

          subscriptionId: subscription.id,

          userId,
        },
      });

      /*
       * 9. Save the provider checkout details.
       */
      const updatedPayment = await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          checkoutUrl: initialized.checkoutUrl,

          providerReference: initialized.providerReference ?? payment.reference,

          providerTransactionId: initialized.providerTransactionId ?? null,

          status: 'PROCESSING',
        },

        select: {
          id: true,
          reference: true,
          plan: true,
          billingPeriod: true,
          amount: true,
          currency: true,
          provider: true,
          status: true,
          checkoutUrl: true,
          providerReference: true,
          providerTransactionId: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      return {
        message: 'Subscription checkout initialized successfully.',

        /*
         * Don't expose the branches used internally to
         * determine regional pricing.
         */
        business: {
          id: membership.business.id,

          businessName: membership.business.businessName,
        },

        market,

        payment: {
          ...updatedPayment,

          amount: updatedPayment.amount.toString(),
        },
      };
    } catch (error) {
      /*
       * 10. Preserve failed payment attempts for
       * audit/debugging purposes.
       */
      await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: 'FAILED',

          failureReason:
            error instanceof Error
              ? error.message
              : 'Payment initialization failed.',
        },
      });

      throw error;
    }
  }

  /*
   * Convert the business country into the appropriate
   * SwiftReceipt pricing market.
   *
   * This intentionally stays separate from provider
   * selection so regional pricing and gateway selection
   * can evolve independently.
   */
  private resolvePricingMarket(
    country?: string | null,
  ): SubscriptionPricingMarket {
    if (!country) {
      return 'GLOBAL';
    }

    const normalizedCountry = country.trim().toLowerCase();

    if (normalizedCountry === 'cameroon' || normalizedCountry === 'cm') {
      return 'CM';
    }

    return 'GLOBAL';
  }

  /*
   * Generate an internal SwiftReceipt payment reference.
   *
   * Avoid punctuation so it is compatible with providers
   * that place restrictions on transaction references.
   */
  private generatePaymentReference(): string {
    const timestamp = Date.now();

    const randomPart = randomBytes(8).toString('hex').toUpperCase();

    return `SWR${timestamp}${randomPart}`;
  }
}
