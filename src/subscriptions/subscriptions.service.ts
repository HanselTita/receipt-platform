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
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId,
      },
    });

    /*
     * Older businesses created before subscriptions were added
     * are treated safely as FREE.
     */
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
     * Extract our SwiftReceipt reference from PayUnit's
     * notification payload.
     */
    const reference = this.extractPayUnitReference(payload);

    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: {
        reference,
      },

      include: {
        subscription: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    /*
     * Idempotency.
     *
     * PayUnit may send notifications more than once.
     */
    if (payment.status === 'SUCCESSFUL') {
      return {
        message: 'Payment was already processed successfully.',

        payment: {
          id: payment.id,

          reference: payment.reference,

          status: payment.status,

          plan: payment.plan,
        },
      };
    }

    if (payment.provider !== 'PAYUNIT') {
      throw new ForbiddenException(
        'This payment does not belong to the PayUnit provider.',
      );
    }

    /*
     * Never trust the webhook status alone.
     *
     * Verify directly with PayUnit.
     */
    const adapter = this.paymentProviderRegistry.get('PAYUNIT');

    const verified = await adapter.verifyPayment({
      reference: payment.reference,

      providerReference: payment.providerReference,

      providerTransactionId: payment.providerTransactionId,
    });

    /*
     * If PayUnit does not confirm success, preserve the
     * appropriate local state but do not activate anything.
     */
    if (!verified.successful) {
      const status = this.mapPayUnitStatus(verified.rawStatus);

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
        },

        select: {
          id: true,
          reference: true,
          status: true,
          plan: true,
          billingPeriod: true,
        },
      });

      return {
        message: 'Payment has not been confirmed as successful.',

        payment: updatedPayment,
      };
    }

    /*
     * ========================================================
     * SECURITY: VERIFY AMOUNT
     * ========================================================
     */

    const expectedAmount = Number(payment.amount.toString());

    const receivedAmount = Number(verified.amount);

    if (!Number.isFinite(receivedAmount) || receivedAmount !== expectedAmount) {
      await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: 'FAILED',

          failureReason: `Verified amount mismatch. Expected ${payment.amount.toString()} ${payment.currency}, received ${verified.amount} ${verified.currency}.`,
        },
      });

      throw new ForbiddenException(
        'Verified payment amount does not match the expected subscription amount.',
      );
    }

    /*
     * ========================================================
     * SECURITY: VERIFY CURRENCY
     * ========================================================
     */

    if (payment.currency.toUpperCase() !== verified.currency.toUpperCase()) {
      await this.prisma.subscriptionPayment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: 'FAILED',

          failureReason: `Verified currency mismatch. Expected ${payment.currency}, received ${verified.currency}.`,
        },
      });

      throw new ForbiddenException(
        'Verified payment currency does not match the expected subscription currency.',
      );
    }

    /*
     * Calculate subscription period.
     */
    const startsAt = new Date();

    const endsAt = this.calculateSubscriptionEndDate(
      startsAt,
      payment.billingPeriod,
    );

    /*
     * ========================================================
     * ATOMIC PAYMENT + SUBSCRIPTION ACTIVATION
     * ========================================================
     *
     * Payment completion and subscription activation happen
     * in the same database transaction.
     */
    const result = await this.prisma.$transaction(async (transaction) => {
      /*
       * Re-read the payment inside the transaction in case
       * two PayUnit notifications arrive simultaneously.
       */
      const currentPayment = await transaction.subscriptionPayment.findUnique({
        where: {
          id: payment.id,
        },
      });

      if (!currentPayment) {
        throw new NotFoundException('Subscription payment could not be found.');
      }

      /*
       * Another request may already have completed it.
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
        };
      }

      /*
       * Mark payment successful.
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
       * Activate the selected subscription plan.
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
        },
      });

      return {
        payment: completedPayment,

        subscription: updatedSubscription,
      };
    });

    return {
      message: 'Subscription payment verified and plan activated successfully.',

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
   * PRIVATE HELPERS
   * ============================================================
   */

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

  private mapPayUnitStatus(
    status?: string | null,
  ): 'PROCESSING' | 'FAILED' | 'CANCELLED' {
    switch (status?.trim().toUpperCase()) {
      case 'FAILED':
        return 'FAILED';

      case 'CANCELLED':
        return 'CANCELLED';

      case 'PENDING':
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
