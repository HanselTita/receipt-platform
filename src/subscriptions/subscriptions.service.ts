import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { SUBSCRIPTION_PLAN_LIMITS } from './subscription-plans';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

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
     * For the MVP, subscription management belongs to the owner.
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
     * Calculate current plan usage.
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
}
