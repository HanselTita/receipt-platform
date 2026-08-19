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
   * ============================================================
   * BUSINESS SUBSCRIPTION
   * ============================================================
   */

  async getBusinessSubscription(businessId: string) {
    await this.applyScheduledPlanIfDue(businessId);

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
        scheduledPlan: null,
        scheduledPlanAt: null,
        limits: SUBSCRIPTION_PLAN_LIMITS.FREE,
      };
    }

    return {
      ...subscription,

      limits: SUBSCRIPTION_PLAN_LIMITS[subscription.plan],
    };
  }

  /*
   * ============================================================
   * GET CURRENT OWNER SUBSCRIPTION
   * GET /subscriptions/me
   * ============================================================
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

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can view subscription information.',
      );
    }

    /*
     * Apply any scheduled cancellation/downgrade that
     * has reached its effective date before returning
     * subscription data to the mobile app.
     */
    await this.applyScheduledPlanIfDue(membership.businessId);

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
        scheduledPlan: subscription.scheduledPlan ?? null,
        scheduledPlanAt: subscription.scheduledPlanAt ?? null,
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
   * ============================================================
   * SUBSCRIPTION PLAN ENFORCEMENT
   * ============================================================
   */

  async assertAnalyticsAllowed(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    if (!subscription.limits.analyticsEnabled) {
      throw new ForbiddenException(
        'Analytics are not available on your current subscription plan.',
      );
    }
  }

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

  async assertCustomBrandingAllowed(businessId: string) {
    const subscription = await this.getBusinessSubscription(businessId);

    if (!subscription.limits.customBrandingEnabled) {
      throw new ForbiddenException(
        'Custom branding is not available on your current subscription plan.',
      );
    }
  }

  /*
   * ============================================================
   * SUBSCRIPTION PLAN CATALOGUE
   * GET /subscriptions/plans
   * ============================================================
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
   * ============================================================
   * CREATE SUBSCRIPTION CHECKOUT
   * POST /subscriptions/checkout
   * ============================================================
   */

  async createCheckout(
    userId: string,
    plan: SubscriptionPlan,
    billingPeriod: SubscriptionBillingPeriod,
  ) {
    /*
     * Load owner, business and main branch.
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

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can manage subscription billing.',
      );
    }

    if (plan === 'FREE') {
      throw new ForbiddenException('The FREE plan does not require checkout.');
    }

    const subscription = await this.prisma.subscription.upsert({
      where: {
        businessId: membership.businessId,
      },

      update: {},

      create: {
        businessId: membership.businessId,

        plan: 'FREE',

        status: 'ACTIVE',
      },
    });

    if (subscription.plan === plan && subscription.status === 'ACTIVE') {
      throw new ForbiddenException(
        `Your business is already on the ${plan} plan.`,
      );
    }

    /*
     * Determine pricing market.
     */
    const mainBranch = membership.business.branches[0];

    const market = this.resolvePricingMarket(mainBranch?.country);

    /*
     * Obtain backend-controlled pricing.
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
     * PayUnit is currently our first implemented
     * payment provider and is enabled for Cameroon.
     */
    if (market !== 'CM') {
      throw new ForbiddenException(
        'Online subscription payments are not yet available for this country.',
      );
    }

    const provider = 'PAYUNIT' as const;

    const reference = this.generatePaymentReference();

    /*
     * PayUnit hosted checkout is short-lived.
     */
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    /*
     * Create internal SwiftReceipt payment before
     * contacting PayUnit.
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
       * Resolve PayUnit through our provider registry.
       */
      const adapter = this.paymentProviderRegistry.get(provider);

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
       * Save provider checkout information.
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
       * Preserve failed initialization for audit/debugging.
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
   * ============================================================
   * PAYUNIT NOTIFICATION / VERIFICATION
   * ============================================================
   */

  async processPayUnitNotification(payload: unknown) {
    /*
     * Extract SwiftReceipt's internal payment reference from
     * the PayUnit notification.
     */
    const reference = this.extractPayUnitReference(payload);

    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: {
        reference,
      },

      select: {
        id: true,
        provider: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    if (payment.provider !== 'PAYUNIT') {
      throw new ForbiddenException(
        'This payment does not belong to the PayUnit provider.',
      );
    }

    /*
     * Webhook and manual reconciliation deliberately use the
     * exact same verification/activation pipeline.
     */
    return this.verifyAndActivatePayment(payment.id);
  }

  /*
   * ============================================================
   * SCHEDULE SUBSCRIPTION PLAN CHANGE
   * ============================================================
   */

  async schedulePlanChange(userId: string, targetPlan: SubscriptionPlan) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        role: true,
        businessId: true,

        business: {
          select: {
            id: true,
            businessName: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can manage subscription changes.',
      );
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId: membership.businessId,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Business subscription could not be found.');
    }

    if (subscription.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Only an active subscription can be changed.',
      );
    }

    if (subscription.plan === targetPlan) {
      throw new ForbiddenException(
        `Your business is already on the ${targetPlan} plan.`,
      );
    }

    const currentRank = this.getPlanRank(subscription.plan);

    const targetRank = this.getPlanRank(targetPlan);

    /*
     * Upgrades must go through checkout.
     */
    if (targetRank > currentRank) {
      throw new ForbiddenException(
        'Upgrades must be completed through subscription checkout.',
      );
    }

    /*
     * FREE subscriptions have no paid period to finish.
     */
    if (subscription.plan === 'FREE') {
      throw new ForbiddenException('The FREE plan cannot be downgraded.');
    }

    if (!subscription.endsAt) {
      throw new ForbiddenException(
        'The current subscription does not have a valid billing period end date.',
      );
    }

    /*
     * Do not schedule against an already expired period.
     */
    if (subscription.endsAt.getTime() <= Date.now()) {
      throw new ForbiddenException(
        'The current subscription period has already ended.',
      );
    }

    const updatedSubscription = await this.prisma.subscription.update({
      where: {
        id: subscription.id,
      },

      data: {
        scheduledPlan: targetPlan,
        scheduledPlanAt: subscription.endsAt,
      },
    });

    return {
      message:
        targetPlan === 'FREE'
          ? `Your ${subscription.plan} subscription will end at the close of the current billing period.`
          : `Your subscription will change from ${subscription.plan} to ${targetPlan} at the end of the current billing period.`,

      business: membership.business,

      subscription: {
        id: updatedSubscription.id,
        plan: updatedSubscription.plan,
        status: updatedSubscription.status,
        startsAt: updatedSubscription.startsAt,
        endsAt: updatedSubscription.endsAt,

        scheduledPlan: updatedSubscription.scheduledPlan,

        scheduledPlanAt: updatedSubscription.scheduledPlanAt,
      },
    };
  }

  /*
   * ============================================================
   * CANCEL SCHEDULED PLAN CHANGE
   * ============================================================
   */

  async cancelScheduledPlanChange(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        role: true,
        businessId: true,

        business: {
          select: {
            id: true,
            businessName: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can manage subscription changes.',
      );
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId: membership.businessId,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Business subscription could not be found.');
    }

    if (!subscription.scheduledPlan || !subscription.scheduledPlanAt) {
      throw new ForbiddenException(
        'There is no scheduled subscription change to cancel.',
      );
    }

    const previousScheduledPlan = subscription.scheduledPlan;

    const updatedSubscription = await this.prisma.subscription.update({
      where: {
        id: subscription.id,
      },

      data: {
        scheduledPlan: null,
        scheduledPlanAt: null,
      },
    });

    return {
      message: 'The scheduled subscription change has been cancelled.',

      cancelledChange: {
        plan: previousScheduledPlan,
      },

      business: membership.business,

      subscription: {
        id: updatedSubscription.id,
        plan: updatedSubscription.plan,
        status: updatedSubscription.status,
        startsAt: updatedSubscription.startsAt,
        endsAt: updatedSubscription.endsAt,
        scheduledPlan: null,
        scheduledPlanAt: null,
      },
    };
  }

  /*
   * ============================================================
   * APPLY SCHEDULED PLAN IF DUE
   * ============================================================
   */
  async applyScheduledPlanIfDue(businessId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId,
      },
    });

    if (!subscription) {
      return null;
    }

    const now = new Date();

    /*
     * ============================================================
     * FREE PLAN
     * ============================================================
     *
     * FREE does not expire.
     */
    if (subscription.plan === 'FREE') {
      /*
       * Clean up any obsolete scheduled cancellation data.
       */
      if (
        subscription.scheduledPlan === 'FREE' ||
        (subscription.scheduledPlanAt &&
          subscription.scheduledPlanAt.getTime() <= now.getTime())
      ) {
        return this.prisma.subscription.update({
          where: {
            id: subscription.id,
          },

          data: {
            status: 'ACTIVE',
            endsAt: null,
            scheduledPlan: null,
            scheduledPlanAt: null,
          },
        });
      }

      return subscription;
    }

    /*
     * ============================================================
     * ACTIVE PAID PERIOD
     * ============================================================
     *
     * STARTER / BUSINESS / PRO remain active while endsAt
     * is still in the future.
     */
    if (subscription.endsAt && subscription.endsAt.getTime() > now.getTime()) {
      return subscription;
    }

    /*
     * ============================================================
     * EXPIRED PAID PLAN
     * ============================================================
     *
     * At this point:
     *
     * - plan is STARTER / BUSINESS / PRO
     * - endsAt is missing OR has passed
     *
     * The business must no longer receive paid-plan access.
     *
     * We never automatically grant another paid period without
     * confirmed payment.
     */

    const intendedNextPlan =
      subscription.scheduledPlan && subscription.scheduledPlan !== 'FREE'
        ? subscription.scheduledPlan
        : null;

    return this.prisma.subscription.update({
      where: {
        id: subscription.id,
      },

      data: {
        /*
         * Expired paid subscriptions fall back to FREE.
         */
        plan: 'FREE',

        /*
         * FREE itself is an active SwiftReceipt tier.
         */
        status: 'ACTIVE',

        startsAt: now,
        endsAt: null,

        /*
         * Cancellation to FREE has now completed, so clear it.
         *
         * If the customer previously requested another paid plan,
         * preserve that intention. It can later be activated only
         * after successful payment.
         */
        scheduledPlan: intendedNextPlan,

        /*
         * The previous effective date has already passed.
         */
        scheduledPlanAt: null,
      },
    });
  }

  async getPaymentHistory(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        role: true,
        businessId: true,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can view subscription payment history.',
      );
    }
    await this.expirePendingPayments(membership.businessId);
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: {
        businessId: membership.businessId,
      },

      orderBy: {
        createdAt: 'desc',
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

        providerTransactionId: true,
        providerReference: true,

        failureReason: true,

        createdAt: true,
        paidAt: true,
        expiresAt: true,
      },
    });

    return {
      payments: payments.map((payment) => ({
        ...payment,

        /*
         * Prisma Decimal should not be exposed directly
         * to the mobile application.
         */
        amount: payment.amount.toString(),
      })),
    };
  }

  async getPaymentDetails(userId: string, paymentId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
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

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can view subscription payment details.',
      );
    }
    await this.expirePendingPayments(membership.businessId);
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: {
        id: paymentId,
        businessId: membership.businessId,
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

        paidAt: true,
        expiresAt: true,

        failureReason: true,

        createdAt: true,
        updatedAt: true,

        subscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    return {
      business: membership.business,

      payment: {
        ...payment,

        amount: payment.amount.toString(),
      },

      receiptAvailable: payment.status === 'SUCCESSFUL',
    };
  }

  /*
   * ============================================================
   * MANUAL PAYMENT VERIFICATION / RECONCILIATION
   * POST /subscriptions/payments/:id/verify
   * ============================================================
   */

  async verifySubscriptionPayment(userId: string, paymentId: string) {
    /*
     * Only the authenticated business owner can manually
     * reconcile subscription payments.
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
        role: true,
        businessId: true,
      },
    });

    /*
     * Always verify that membership exists BEFORE accessing
     * membership.businessId.
     */
    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can verify subscription payments.',
      );
    }

    /*
     * Before contacting the payment provider, expire any
     * abandoned checkout whose local checkout lifetime has passed.
     */
    await this.expirePendingPayments(membership.businessId);

    /*
     * Security:
     *
     * Payment ID alone must never allow access to another
     * business's transaction.
     */
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: {
        id: paymentId,

        businessId: membership.businessId,
      },

      select: {
        id: true,
        status: true,
        failureReason: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    /*
     * A locally expired/cancelled checkout should not continue
     * contacting the payment provider.
     */
    if (payment.status === 'CANCELLED') {
      throw new ForbiddenException(
        payment.failureReason?.includes('expired')
          ? 'This payment checkout has expired. Please start a new checkout.'
          : 'This payment checkout was cancelled. Please start a new checkout.',
      );
    }

    /*
     * Failed payments can be retried through the retry-payment
     * endpoint instead of repeatedly reconciling them.
     */
    if (payment.status === 'FAILED') {
      throw new ForbiddenException(
        'This payment has failed. Please start a new checkout.',
      );
    }

    /*
     * SUCCESSFUL payments are safe to pass through because
     * verifyAndActivatePayment() has an idempotency fast path.
     */
    return this.verifyAndActivatePayment(payment.id);
  }

  /*
   * ============================================================
   * EXPIRE ABANDONED PAYMENT ATTEMPTS
   * ============================================================
   */

  async expirePendingPayments(businessId: string) {
    const now = new Date();

    const result = await this.prisma.subscriptionPayment.updateMany({
      where: {
        businessId,

        status: {
          in: ['PENDING', 'PROCESSING'],
        },

        expiresAt: {
          not: null,
          lte: now,
        },
      },

      data: {
        status: 'CANCELLED',

        failureReason: 'Checkout expired before payment was confirmed.',
      },
    });

    return {
      expiredPayments: result.count,
    };
  }

  /*
   * ============================================================
   * RETRY SUBSCRIPTION PAYMENT
   * POST /subscriptions/payments/:id/retry
   * ============================================================
   */

  async retrySubscriptionPayment(userId: string, paymentId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        role: true,
        businessId: true,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can retry subscription payments.',
      );
    }

    /*
     * Clean up stale attempts first.
     */
    await this.expirePendingPayments(membership.businessId);

    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: {
        id: paymentId,
        businessId: membership.businessId,
      },

      select: {
        id: true,

        plan: true,

        billingPeriod: true,

        status: true,

        expiresAt: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    /*
     * Never retry a payment that already succeeded.
     */
    if (payment.status === 'SUCCESSFUL') {
      throw new ForbiddenException('A successful payment cannot be retried.');
    }

    /*
     * A payment that is still genuinely active should be
     * reconciled rather than duplicated.
     */
    if (payment.status === 'PENDING' || payment.status === 'PROCESSING') {
      throw new ForbiddenException(
        'This checkout is still active. Check the payment status before starting another payment.',
      );
    }

    /*
     * Reuse our existing secure checkout pipeline.
     *
     * This creates a NEW SubscriptionPayment record with
     * a NEW SwiftReceipt reference.
     */
    return this.createCheckout(userId, payment.plan, payment.billingPeriod);
  }

  /*
   * ============================================================
   * FOREGROUND PAYMENT RECONCILIATION
   * POST /subscriptions/payments/reconcile
   * ============================================================
   */

  async reconcileRecentSubscriptionPayments(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        role: true,
        businessId: true,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can reconcile subscription payments.',
      );
    }

    /*
     * First clean up stale local checkout attempts.
     */
    await this.expirePendingPayments(membership.businessId);

    /*
     * Only reconcile recent unresolved payments.
     *
     * This prevents repeatedly hitting the provider for old
     * transactions that are no longer relevant.
     */
    const reconciliationWindowStart = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    );

    const payments = await this.prisma.subscriptionPayment.findMany({
      where: {
        businessId: membership.businessId,

        status: {
          in: ['PENDING', 'PROCESSING'],
        },

        createdAt: {
          gte: reconciliationWindowStart,
        },
      },

      orderBy: {
        createdAt: 'desc',
      },

      /*
       * Keep the foreground reconciliation lightweight.
       */
      take: 5,

      select: {
        id: true,
        status: true,
      },
    });

    let successful = 0;
    let processing = 0;
    let failed = 0;
    let cancelled = 0;
    let errors = 0;

    for (const payment of payments) {
      try {
        const result = await this.verifyAndActivatePayment(payment.id);

        switch (result.payment.status) {
          case 'SUCCESSFUL':
            successful += 1;
            break;

          case 'FAILED':
            failed += 1;
            break;

          case 'CANCELLED':
            cancelled += 1;
            break;

          case 'PENDING':
          case 'PROCESSING':
          default:
            processing += 1;
            break;
        }
      } catch (error) {
        /*
         * One provider failure should not prevent the remaining
         * transactions from being reconciled.
         */
        errors += 1;

        console.warn(
          `Unable to reconcile subscription payment ${payment.id}:`,
          error,
        );
      }
    }

    return {
      message:
        payments.length === 0
          ? 'No unresolved subscription payments required reconciliation.'
          : 'Recent subscription payments were reconciled.',

      checked: payments.length,

      results: {
        successful,
        processing,
        failed,
        cancelled,
        errors,
      },
    };
  }

  /*
   * ============================================================
   * INTERNAL PAYMENT RECONCILIATION ENTRY POINT
   * ============================================================
   *
   * Used by trusted backend services such as the scheduler.
   *
   * This deliberately reuses the same idempotent provider
   * verification + subscription activation pipeline.
   */

  async reconcilePaymentById(paymentId: string) {
    return this.verifyAndActivatePayment(paymentId);
  }

  /*
   * ============================================================
   * PRIVATE HELPERS
   * ============================================================
   */

  private async verifyAndActivatePayment(paymentId: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: {
        id: paymentId,
      },

      include: {
        subscription: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    /*
     * ============================================================
     * IDEMPOTENCY — FAST PATH
     * ============================================================
     *
     * If this transaction was already completed, never contact
     * the provider or activate the subscription again.
     */
    if (payment.status === 'SUCCESSFUL') {
      return {
        message: 'Payment was already processed successfully.',

        payment: {
          id: payment.id,
          reference: payment.reference,
          plan: payment.plan,
          billingPeriod: payment.billingPeriod,
          status: payment.status,
          amount: payment.amount.toString(),
          currency: payment.currency,
          paidAt: payment.paidAt,
        },

        subscription: {
          id: payment.subscription.id,

          plan: payment.subscription.plan,

          status: payment.subscription.status,

          startsAt: payment.subscription.startsAt,

          endsAt: payment.subscription.endsAt,
        },
      };
    }

    /*
     * Resolve the actual payment-provider adapter.
     *
     * Today this is PAYUNIT, but using the registry here means
     * this reconciliation pipeline can later support Paystack,
     * Stripe, dLocal, etc.
     */
    const adapter = this.paymentProviderRegistry.get(payment.provider);

    /*
     * Never trust the local status alone.
     *
     * Ask the payment provider for the authoritative status.
     */
    const verified = await adapter.verifyPayment({
      reference: payment.reference,

      providerReference: payment.providerReference,

      providerTransactionId: payment.providerTransactionId,
    });

    /*
     * ============================================================
     * NOT SUCCESSFUL YET
     * ============================================================
     */

    if (!verified.successful) {
      const status = this.mapProviderPaymentStatus(verified.rawStatus);

      const updatedPayment = await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          status,

          providerTransactionId:
            verified.providerTransactionId ?? payment.providerTransactionId,

          providerReference:
            verified.providerReference ?? payment.providerReference,

          /*
           * Preserve a useful local explanation for terminal
           * provider states.
           */
          failureReason:
            status === 'FAILED'
              ? 'The payment provider reported that the transaction failed.'
              : status === 'CANCELLED'
                ? 'The payment provider reported that the transaction was cancelled.'
                : null,
        },

        select: {
          id: true,
          reference: true,
          status: true,
          plan: true,
          billingPeriod: true,
          amount: true,
          currency: true,
          provider: true,
          providerReference: true,
          providerTransactionId: true,
          paidAt: true,
        },
      });

      return {
        message:
          status === 'FAILED'
            ? 'Payment verification confirmed that the transaction failed.'
            : status === 'CANCELLED'
              ? 'Payment verification confirmed that the transaction was cancelled.'
              : 'Payment has not yet been confirmed as successful.',

        payment: {
          ...updatedPayment,

          amount: updatedPayment.amount.toString(),
        },

        subscription: null,
      };
    }

    /*
     * ============================================================
     * SECURITY — VERIFY AMOUNT
     * ============================================================
     */

    const expectedAmount = Number(payment.amount.toString());

    const receivedAmount = Number(verified.amount);

    if (
      !Number.isFinite(receivedAmount) ||
      Math.abs(receivedAmount - expectedAmount) > 0.000001
    ) {
      await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: 'FAILED',

          failureReason:
            `Verified amount mismatch. Expected ` +
            `${payment.amount.toString()} ${payment.currency}, ` +
            `received ${verified.amount} ${verified.currency}.`,
        },
      });

      throw new ForbiddenException(
        'Verified payment amount does not match the expected subscription amount.',
      );
    }

    /*
     * ============================================================
     * SECURITY — VERIFY CURRENCY
     * ============================================================
     */

    if (payment.currency.toUpperCase() !== verified.currency.toUpperCase()) {
      await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: 'FAILED',

          failureReason:
            `Verified currency mismatch. Expected ` +
            `${payment.currency}, received ${verified.currency}.`,
        },
      });

      throw new ForbiddenException(
        'Verified payment currency does not match the expected subscription currency.',
      );
    }

    /*
     * ============================================================
     * SUBSCRIPTION PERIOD
     * ============================================================
     */

    const startsAt = new Date();

    const endsAt = this.calculateSubscriptionEndDate(
      startsAt,
      payment.billingPeriod,
    );

    /*
     * ============================================================
     * ATOMIC ACTIVATION
     * ============================================================
     *
     * We re-read the payment inside the transaction.
     *
     * This protects against:
     *
     * - webhook + manual verify arriving simultaneously
     * - two webhook deliveries
     * - repeated user taps
     * - mobile retries
     */

    const result = await this.prisma.$transaction(async (transaction) => {
      const currentPayment = await transaction.subscriptionPayment.findUnique({
        where: {
          id: payment.id,
        },
      });

      if (!currentPayment) {
        throw new NotFoundException('Subscription payment could not be found.');
      }

      /*
       * Another request may have completed this payment
       * while provider verification was happening.
       */
      if (currentPayment.status === 'SUCCESSFUL') {
        const currentSubscription = await transaction.subscription.findUnique({
          where: {
            id: currentPayment.subscriptionId,
          },
        });

        return {
          payment: currentPayment,

          subscription: currentSubscription,

          alreadyProcessed: true,
        };
      }

      /*
       * Mark transaction successful.
       */
      const completedPayment = await transaction.subscriptionPayment.update({
        where: {
          id: currentPayment.id,
        },

        data: {
          status: 'SUCCESSFUL',

          paidAt: startsAt,

          failureReason: null,

          providerTransactionId:
            verified.providerTransactionId ??
            currentPayment.providerTransactionId,

          providerReference:
            verified.providerReference ?? currentPayment.providerReference,
        },
      });

      /*
       * Activate exactly the plan associated with this
       * particular payment.
       */
      const updatedSubscription = await transaction.subscription.update({
        where: {
          id: currentPayment.subscriptionId,
        },

        data: {
          plan: currentPayment.plan,

          status: 'ACTIVE',

          startsAt,

          endsAt,

          /*
           * A newly paid subscription supersedes any
           * scheduled cancellation/downgrade.
           */
          scheduledPlan: null,

          scheduledPlanAt: null,
        },
      });

      return {
        payment: completedPayment,

        subscription: updatedSubscription,

        alreadyProcessed: false,
      };
    });

    return {
      message: result.alreadyProcessed
        ? 'Payment was already processed successfully.'
        : 'Subscription payment verified and plan activated successfully.',

      payment: {
        id: result.payment.id,

        reference: result.payment.reference,

        plan: result.payment.plan,

        billingPeriod: result.payment.billingPeriod,

        status: result.payment.status,

        amount: result.payment.amount.toString(),

        currency: result.payment.currency,

        paidAt: result.payment.paidAt,
      },

      subscription: result.subscription
        ? {
            id: result.subscription.id,

            plan: result.subscription.plan,

            status: result.subscription.status,

            startsAt: result.subscription.startsAt,

            endsAt: result.subscription.endsAt,
          }
        : null,
    };
  }

  private getPlanRank(plan: SubscriptionPlan): number {
    const ranks: Record<SubscriptionPlan, number> = {
      FREE: 0,
      STARTER: 1,
      BUSINESS: 2,
      PRO: 3,
    };

    return ranks[plan];
  }
  private extractPayUnitReference(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
      throw new ForbiddenException('Invalid PayUnit notification payload.');
    }

    const body = payload as {
      data?: {
        transaction_id?: unknown;
      };

      transaction_id?: unknown;
    };

    const reference = body.data?.transaction_id ?? body.transaction_id;

    if (typeof reference !== 'string' || !reference.trim()) {
      throw new ForbiddenException(
        'PayUnit notification does not contain a valid transaction reference.',
      );
    }

    return reference.trim();
  }

  private mapProviderPaymentStatus(
    status?: string | null,
  ): 'PROCESSING' | 'FAILED' | 'CANCELLED' {
    switch (status?.trim().toUpperCase()) {
      case 'FAILED':
      case 'FAILURE':
      case 'DECLINED':
      case 'REJECTED':
        return 'FAILED';

      case 'CANCELLED':
      case 'CANCELED':
        return 'CANCELLED';

      case 'PENDING':
      case 'PROCESSING':
      case 'INITIATED':
      default:
        return 'PROCESSING';
    }
  }

  private calculateSubscriptionEndDate(
    startsAt: Date,
    billingPeriod: SubscriptionBillingPeriod,
  ): Date {
    const endsAt = new Date(startsAt);

    if (billingPeriod === 'ANNUAL') {
      endsAt.setFullYear(endsAt.getFullYear() + 1);

      return endsAt;
    }

    endsAt.setMonth(endsAt.getMonth() + 1);

    return endsAt;
  }

  /*
   * Resolve regional pricing from the business's
   * main-branch country.
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
   * Internal SwiftReceipt transaction reference.
   *
   * We deliberately avoid hyphens and other punctuation
   * for compatibility with payment providers.
   */
  private generatePaymentReference(): string {
    const timestampPart = Date.now().toString(36).toUpperCase();

    const randomPart = randomBytes(4).toString('hex').toUpperCase();

    return `SWR${timestampPart}${randomPart}`;
  }
}
