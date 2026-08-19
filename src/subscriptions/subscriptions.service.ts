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

import { SubscriptionAuditService } from './subscription-audit.service';
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

    private readonly subscriptionAuditService: SubscriptionAuditService,
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

    await this.applyScheduledPlanIfDue(membership.businessId);

    const subscription = await this.getBusinessSubscription(
      membership.businessId,
    );

    const now = new Date();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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
   * PLAN ENFORCEMENT
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
   * AVAILABLE PLANS
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
   * CREATE CHECKOUT
   * ============================================================
   */

  async createCheckout(
    userId: string,
    plan: SubscriptionPlan,
    billingPeriod: SubscriptionBillingPeriod,
  ) {
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

    const mainBranch = membership.business.branches[0];

    const market = this.resolvePricingMarket(mainBranch?.country);

    const pricing = getSubscriptionPricing(market, plan);

    const amount =
      billingPeriod === 'MONTHLY' ? pricing.monthly : pricing.annual;

    if (amount <= 0) {
      throw new ForbiddenException(
        'The selected plan does not require payment.',
      );
    }

    if (market !== 'CM') {
      throw new ForbiddenException(
        'Online subscription payments are not yet available for this country.',
      );
    }

    const provider = 'PAYUNIT' as const;

    const reference = this.generatePaymentReference();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

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

      await this.subscriptionAuditService.record({
        eventType: 'CHECKOUT_CREATED',

        businessId: membership.businessId,

        subscriptionId: subscription.id,

        paymentId: updatedPayment.id,

        actorUserId: userId,

        message: `Subscription checkout created for ${plan} (${billingPeriod}).`,

        metadata: {
          plan,

          billingPeriod,

          reference: updatedPayment.reference,

          amount: updatedPayment.amount.toString(),

          currency: updatedPayment.currency,

          provider: updatedPayment.provider,
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
   * PAYUNIT WEBHOOK
   * ============================================================
   */

  async processPayUnitNotification(payload: unknown) {
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

    return this.verifyAndActivatePayment(payment.id);
  }

  /*
   * ============================================================
   * SCHEDULE PLAN CHANGE
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

    if (
      subscription.scheduledPlan === targetPlan &&
      subscription.scheduledPlanAt
    ) {
      throw new ForbiddenException(
        `A change to the ${targetPlan} plan is already scheduled.`,
      );
    }

    const currentRank = this.getPlanRank(subscription.plan);

    const targetRank = this.getPlanRank(targetPlan);

    if (targetRank > currentRank) {
      throw new ForbiddenException(
        'Upgrades must be completed through subscription checkout.',
      );
    }

    if (subscription.plan === 'FREE') {
      throw new ForbiddenException('The FREE plan cannot be downgraded.');
    }

    if (!subscription.endsAt) {
      throw new ForbiddenException(
        'The current subscription does not have a valid billing period end date.',
      );
    }

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

    await this.subscriptionAuditService.record({
      eventType: 'SCHEDULED_CHANGE_CREATED',

      businessId: membership.businessId,

      subscriptionId: subscription.id,

      actorUserId: userId,

      message:
        targetPlan === 'FREE'
          ? `${subscription.plan} subscription scheduled to end at the close of the current billing period.`
          : `Subscription change scheduled from ${subscription.plan} to ${targetPlan}.`,

      metadata: {
        previousPlan: subscription.plan,

        targetPlan,

        effectiveAt: subscription.endsAt.toISOString(),
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
   * CANCEL SCHEDULED CHANGE
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

    const previousScheduledAt = subscription.scheduledPlanAt;

    const updatedSubscription = await this.prisma.subscription.update({
      where: {
        id: subscription.id,
      },

      data: {
        scheduledPlan: null,

        scheduledPlanAt: null,
      },
    });

    await this.subscriptionAuditService.record({
      eventType: 'SCHEDULED_CHANGE_CANCELLED',

      businessId: membership.businessId,

      subscriptionId: subscription.id,

      actorUserId: userId,

      message: `Scheduled subscription change to ${previousScheduledPlan} was cancelled.`,

      metadata: {
        currentPlan: subscription.plan,

        cancelledTargetPlan: previousScheduledPlan,

        previousEffectiveAt: previousScheduledAt.toISOString(),
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
   * APPLY EXPIRED / SCHEDULED PLAN
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
     * FREE never expires.
     */
    if (subscription.plan === 'FREE') {
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
     * Paid plan is still active.
     */
    if (subscription.endsAt && subscription.endsAt.getTime() > now.getTime()) {
      return subscription;
    }

    /*
     * Paid subscription has expired.
     */
    const previousPlan = subscription.plan;

    const previousEndsAt = subscription.endsAt;

    const intendedNextPlan =
      subscription.scheduledPlan && subscription.scheduledPlan !== 'FREE'
        ? subscription.scheduledPlan
        : null;

    /*
     * Conditional transition protects against duplicate
     * expiry processing.
     */
    const transition = await this.prisma.subscription.updateMany({
      where: {
        id: subscription.id,

        plan: previousPlan,
      },

      data: {
        plan: 'FREE',

        status: 'ACTIVE',

        startsAt: now,

        endsAt: null,

        scheduledPlan: intendedNextPlan,

        scheduledPlanAt: null,
      },
    });

    const updatedSubscription = await this.prisma.subscription.findUnique({
      where: {
        id: subscription.id,
      },
    });

    if (!updatedSubscription) {
      throw new NotFoundException('Business subscription could not be found.');
    }

    if (transition.count > 0) {
      await this.subscriptionAuditService.record({
        eventType: 'SUBSCRIPTION_EXPIRED',

        businessId,

        subscriptionId: subscription.id,

        message: `${previousPlan} subscription period ended and the business returned to the FREE plan.`,

        metadata: {
          previousPlan,

          newPlan: 'FREE',

          previousEndsAt: previousEndsAt?.toISOString() ?? null,

          fallbackAt: now.toISOString(),

          intendedNextPlan,
        },
      });
    }

    return updatedSubscription;
  }

  /*
   * ============================================================
   * PAYMENT HISTORY
   * ============================================================
   */

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
        providerReference: true,
        providerTransactionId: true,
        paidAt: true,
        expiresAt: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      payments: payments.map((payment) => ({
        ...payment,

        amount: payment.amount.toString(),
      })),
    };
  }

  /*
   * ============================================================
   * PAYMENT DETAILS
   * ============================================================
   */

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
   * MANUAL PAYMENT VERIFICATION
   * ============================================================
   */

  async verifySubscriptionPayment(userId: string, paymentId: string) {
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
        'Only the business owner can verify subscription payments.',
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
        status: true,
        failureReason: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    if (payment.status === 'CANCELLED') {
      throw new ForbiddenException(
        payment.failureReason?.toLowerCase().includes('expired')
          ? 'This payment checkout has expired. Please start a new checkout.'
          : 'This payment checkout was cancelled. Please start a new checkout.',
      );
    }

    if (payment.status === 'FAILED') {
      throw new ForbiddenException(
        'This payment has failed. Please start a new checkout.',
      );
    }

    return this.verifyAndActivatePayment(payment.id);
  }

  /*
   * ============================================================
   * EXPIRE PAYMENTS
   * ============================================================
   */

  async expirePendingPayments(businessId: string) {
    const now = new Date();

    const payments = await this.prisma.subscriptionPayment.findMany({
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

      select: {
        id: true,
        reference: true,
        businessId: true,
        subscriptionId: true,
        plan: true,
        billingPeriod: true,
        amount: true,
        currency: true,
        provider: true,
        expiresAt: true,
      },
    });

    let expiredPayments = 0;

    for (const payment of payments) {
      const transition = await this.prisma.subscriptionPayment.updateMany({
        where: {
          id: payment.id,

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

      if (transition.count === 0) {
        continue;
      }

      expiredPayments += 1;

      await this.subscriptionAuditService.record({
        eventType: 'PAYMENT_EXPIRED',

        businessId: payment.businessId,

        subscriptionId: payment.subscriptionId,

        paymentId: payment.id,

        message: `Subscription payment ${payment.reference} expired before payment was confirmed.`,

        metadata: {
          reference: payment.reference,

          plan: payment.plan,

          billingPeriod: payment.billingPeriod,

          amount: payment.amount.toString(),

          currency: payment.currency,

          provider: payment.provider,

          expiresAt: payment.expiresAt?.toISOString() ?? null,
        },
      });
    }

    return {
      expiredPayments,
    };
  }

  /*
   * ============================================================
   * RETRY PAYMENT
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

    if (payment.status === 'SUCCESSFUL') {
      throw new ForbiddenException('A successful payment cannot be retried.');
    }

    if (payment.status === 'PENDING' || payment.status === 'PROCESSING') {
      throw new ForbiddenException(
        'This checkout is still active. Check the payment status before starting another payment.',
      );
    }

    const checkout = await this.createCheckout(
      userId,
      payment.plan,
      payment.billingPeriod,
    );

    await this.subscriptionAuditService.record({
      eventType: 'CHECKOUT_RETRIED',

      businessId: membership.businessId,

      paymentId: checkout.payment.id,

      actorUserId: userId,

      message: `Subscription checkout retried from previous payment ${payment.id}.`,

      metadata: {
        previousPaymentId: payment.id,

        newPaymentId: checkout.payment.id,

        newReference: checkout.payment.reference,

        plan: payment.plan,

        billingPeriod: payment.billingPeriod,
      },
    });

    return checkout;
  }

  /*
   * ============================================================
   * FOREGROUND RECONCILIATION
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

    await this.expirePendingPayments(membership.businessId);

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
        errors += 1;

        console.warn(
          `Unable to reconcile subscription payment ${payment.id}:`,
          error instanceof Error ? error.message : 'Unknown error',
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
   * INTERNAL SCHEDULER ENTRY POINT
   * ============================================================
   */

  async reconcilePaymentById(paymentId: string) {
    return this.verifyAndActivatePayment(paymentId);
  }

  /*
   * ============================================================
   * PRIVATE PAYMENT VERIFICATION
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
     * ========================================================
     * IDEMPOTENCY
     * ========================================================
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

    const adapter = this.paymentProviderRegistry.get(payment.provider);

    const verified = await adapter.verifyPayment({
      reference: payment.reference,

      providerReference: payment.providerReference,

      providerTransactionId: payment.providerTransactionId,
    });

    /*
     * ========================================================
     * NOT SUCCESSFUL
     * ========================================================
     */

    if (!verified.successful) {
      const status = this.mapProviderPaymentStatus(verified.rawStatus);

      const failureReason =
        status === 'FAILED'
          ? 'The payment provider reported that the transaction failed.'
          : status === 'CANCELLED'
            ? 'The payment provider reported that the transaction was cancelled.'
            : null;

      let transitionCount = 0;

      if (status === 'FAILED' || status === 'CANCELLED') {
        const transition = await this.prisma.subscriptionPayment.updateMany({
          where: {
            id: payment.id,

            status: {
              in: ['PENDING', 'PROCESSING'],
            },
          },

          data: {
            status,

            providerTransactionId:
              verified.providerTransactionId ?? payment.providerTransactionId,

            providerReference:
              verified.providerReference ?? payment.providerReference,

            failureReason,
          },
        });

        transitionCount = transition.count;
      } else {
        await this.prisma.subscriptionPayment.updateMany({
          where: {
            id: payment.id,

            status: {
              in: ['PENDING', 'PROCESSING'],
            },
          },

          data: {
            status: 'PROCESSING',

            providerTransactionId:
              verified.providerTransactionId ?? payment.providerTransactionId,

            providerReference:
              verified.providerReference ?? payment.providerReference,

            failureReason: null,
          },
        });
      }

      const updatedPayment = await this.prisma.subscriptionPayment.findUnique({
        where: {
          id: payment.id,
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

      if (!updatedPayment) {
        throw new NotFoundException('Subscription payment could not be found.');
      }

      if (status === 'FAILED' && transitionCount > 0) {
        await this.subscriptionAuditService.record({
          eventType: 'PAYMENT_FAILED',

          businessId: payment.businessId,

          subscriptionId: payment.subscriptionId,

          paymentId: payment.id,

          message: `Subscription payment ${payment.reference} failed.`,

          metadata: {
            reference: payment.reference,

            plan: payment.plan,

            billingPeriod: payment.billingPeriod,

            amount: payment.amount.toString(),

            currency: payment.currency,

            provider: payment.provider,

            providerStatus: verified.rawStatus ?? 'UNKNOWN',

            reason: failureReason ?? 'Payment failed.',
          },
        });
      }

      if (status === 'CANCELLED' && transitionCount > 0) {
        await this.subscriptionAuditService.record({
          eventType: 'PAYMENT_CANCELLED',

          businessId: payment.businessId,

          subscriptionId: payment.subscriptionId,

          paymentId: payment.id,

          message: `Subscription payment ${payment.reference} was cancelled.`,

          metadata: {
            reference: payment.reference,

            plan: payment.plan,

            billingPeriod: payment.billingPeriod,

            amount: payment.amount.toString(),

            currency: payment.currency,

            provider: payment.provider,

            providerStatus: verified.rawStatus ?? 'UNKNOWN',
          },
        });
      }

      return {
        message:
          updatedPayment.status === 'FAILED'
            ? 'Payment verification confirmed that the transaction failed.'
            : updatedPayment.status === 'CANCELLED'
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
     * ========================================================
     * VERIFY AMOUNT
     * ========================================================
     */

    const expectedAmount = Number(payment.amount.toString());

    const receivedAmount = Number(verified.amount);

    if (
      !Number.isFinite(receivedAmount) ||
      Math.abs(receivedAmount - expectedAmount) > 0.000001
    ) {
      const failureReason =
        `Verified amount mismatch. Expected ` +
        `${payment.amount.toString()} ${payment.currency}, ` +
        `received ${verified.amount} ${verified.currency}.`;

      const transition = await this.prisma.subscriptionPayment.updateMany({
        where: {
          id: payment.id,

          status: {
            in: ['PENDING', 'PROCESSING'],
          },
        },

        data: {
          status: 'FAILED',

          failureReason,
        },
      });

      if (transition.count > 0) {
        await this.subscriptionAuditService.record({
          eventType: 'PAYMENT_FAILED',

          businessId: payment.businessId,

          subscriptionId: payment.subscriptionId,

          paymentId: payment.id,

          message: `Subscription payment ${payment.reference} failed amount verification.`,

          metadata: {
            reference: payment.reference,

            plan: payment.plan,

            billingPeriod: payment.billingPeriod,

            expectedAmount: payment.amount.toString(),

            receivedAmount: verified.amount,

            expectedCurrency: payment.currency,

            receivedCurrency: verified.currency,

            provider: payment.provider,

            reason: 'AMOUNT_MISMATCH',
          },
        });
      }

      throw new ForbiddenException(
        'Verified payment amount does not match the expected subscription amount.',
      );
    }

    /*
     * ========================================================
     * VERIFY CURRENCY
     * ========================================================
     */

    if (payment.currency.toUpperCase() !== verified.currency.toUpperCase()) {
      const failureReason =
        `Verified currency mismatch. Expected ` +
        `${payment.currency}, received ${verified.currency}.`;

      const transition = await this.prisma.subscriptionPayment.updateMany({
        where: {
          id: payment.id,

          status: {
            in: ['PENDING', 'PROCESSING'],
          },
        },

        data: {
          status: 'FAILED',

          failureReason,
        },
      });

      if (transition.count > 0) {
        await this.subscriptionAuditService.record({
          eventType: 'PAYMENT_FAILED',

          businessId: payment.businessId,

          subscriptionId: payment.subscriptionId,

          paymentId: payment.id,

          message: `Subscription payment ${payment.reference} failed currency verification.`,

          metadata: {
            reference: payment.reference,

            plan: payment.plan,

            billingPeriod: payment.billingPeriod,

            amount: payment.amount.toString(),

            expectedCurrency: payment.currency,

            receivedCurrency: verified.currency,

            provider: payment.provider,

            reason: 'CURRENCY_MISMATCH',
          },
        });
      }

      throw new ForbiddenException(
        'Verified payment currency does not match the expected subscription currency.',
      );
    }

    /*
     * ========================================================
     * SUBSCRIPTION PERIOD
     * ========================================================
     */

    const startsAt = new Date();

    const endsAt = this.calculateSubscriptionEndDate(
      startsAt,
      payment.billingPeriod,
    );

    /*
     * ========================================================
     * ATOMIC ACTIVATION
     * ========================================================
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

      if (currentPayment.status === 'SUCCESSFUL') {
        const currentSubscription = await transaction.subscription.findUnique({
          where: {
            id: currentPayment.subscriptionId,
          },
        });

        return {
          payment: currentPayment,

          subscription: currentSubscription,

          previousSubscription: currentSubscription,

          alreadyProcessed: true,
        };
      }

      /*
       * Preserve previous subscription state so we can tell
       * activation from renewal.
       */
      const previousSubscription = await transaction.subscription.findUnique({
        where: {
          id: currentPayment.subscriptionId,
        },
      });

      if (!previousSubscription) {
        throw new NotFoundException(
          'Business subscription could not be found.',
        );
      }

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

      const updatedSubscription = await transaction.subscription.update({
        where: {
          id: currentPayment.subscriptionId,
        },

        data: {
          plan: currentPayment.plan,

          status: 'ACTIVE',

          startsAt,

          endsAt,

          scheduledPlan: null,

          scheduledPlanAt: null,
        },
      });

      return {
        payment: completedPayment,

        subscription: updatedSubscription,

        previousSubscription,

        alreadyProcessed: false,
      };
    });

    /*
     * ========================================================
     * PAYMENT SUCCESS AUDIT
     * ========================================================
     */

    if (!result.alreadyProcessed) {
      await this.subscriptionAuditService.record({
        eventType: 'PAYMENT_SUCCESSFUL',

        businessId: result.payment.businessId,

        subscriptionId: result.payment.subscriptionId,

        paymentId: result.payment.id,

        message: `Subscription payment ${result.payment.reference} was verified successfully.`,

        metadata: {
          reference: result.payment.reference,

          plan: result.payment.plan,

          billingPeriod: result.payment.billingPeriod,

          amount: result.payment.amount.toString(),

          currency: result.payment.currency,

          provider: result.payment.provider,
        },
      });
    }

    /*
     * ========================================================
     * SUBSCRIPTION ACTIVATED / RENEWED AUDIT
     * ========================================================
     */

    if (!result.alreadyProcessed && result.subscription) {
      const previousSubscription = result.previousSubscription;

      const isRenewal =
        previousSubscription !== null &&
        previousSubscription.plan === result.subscription.plan &&
        previousSubscription.plan !== 'FREE';

      await this.subscriptionAuditService.record({
        eventType: isRenewal
          ? 'SUBSCRIPTION_RENEWED'
          : 'SUBSCRIPTION_ACTIVATED',

        businessId: result.payment.businessId,

        subscriptionId: result.subscription.id,

        paymentId: result.payment.id,

        message: isRenewal
          ? `${result.subscription.plan} subscription renewed successfully.`
          : `${result.subscription.plan} subscription activated successfully.`,

        metadata: {
          previousPlan: previousSubscription?.plan ?? null,

          newPlan: result.subscription.plan,

          billingPeriod: result.payment.billingPeriod,

          startsAt: result.subscription.startsAt.toISOString(),

          endsAt: result.subscription.endsAt?.toISOString() ?? null,

          paymentReference: result.payment.reference,
        },
      });
    }

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

  /*
   * ============================================================
   * HELPERS
   * ============================================================
   */

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
      case 'INITIATE':
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

  private generatePaymentReference(): string {
    const timestampPart = Date.now().toString(36).toUpperCase();

    const randomPart = randomBytes(4).toString('hex').toUpperCase();

    return `SWR${timestampPart}${randomPart}`;
  }
}
