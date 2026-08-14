import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { DashboardAnalyticsQueryDto } from './dto/dashboard-analytics-query.dto';
import { AnalyticsPeriod } from './enums/analytics-period.enum';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

type AnalyticsDateRange = {
  dateFrom: Date;
  dateTo: Date;
};

type DailySalesAccumulator = {
  receiptCount: number;
  totalSales: number;
};

type AnalyticsComparison = {
  previousDateFrom: Date;
  previousDateTo: Date;
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getDashboard(userId: string) {
    /*
     * 1. Find the authenticated user.
     */
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new NotFoundException('User account was not found.');
    }

    /*
     * 2. Find the user's first active business membership.
     *
     * Later, when SwiftReceipt supports switching between
     * multiple businesses, the business ID will come from the
     * selected business context.
     */
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      include: {
        business: {
          include: {
            branches: {
              where: {
                isMainBranch: true,
              },

              orderBy: {
                createdAt: 'asc',
              },

              take: 1,
            },

            subscription: true,

            _count: {
              select: {
                memberships: {
                  where: {
                    status: 'ACTIVE',
                  },
                },
              },
            },
          },
        },

        branchAssignments: {
          where: {
            isActive: true,
          },

          include: {
            branch: true,
          },
        },
      },
    });

    /*
     * 3. Return onboarding information for a user who does not
     * yet have a business.
     */
    if (!membership) {
      return {
        user,

        hasBusiness: false,

        membership: null,

        business: null,

        branch: null,

        assignedBranches: [],

        stats: {
          todayReceipts: 0,
          todaySales: '0',
          totalReceipts: 0,
          employees: 0,
        },

        recentReceipts: [],

        subscription: {
          id: null,
          plan: 'FREE',
          status: 'ACTIVE',
          startsAt: null,
          endsAt: null,
        },
      };
    }

    const business = membership.business;

    const mainBranch = business.branches[0] ?? null;

    /*
     * 4. Determine the start of today and tomorrow.
     *
     * This currently uses the backend server's local date.
     * Later, we can store a timezone per business.
     */
    const startOfToday = new Date();

    startOfToday.setHours(0, 0, 0, 0);

    const startOfTomorrow = new Date(startOfToday);

    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    /*
     * Assigned branches are returned for UI/workspace context.
     *
     * Staff receipt visibility is deliberately still restricted
     * by createdByUserId, matching your current permission rule:
     *
     * OWNER -> all business receipts
     * STAFF -> only receipts issued by that staff member
     */
    const assignedBranchIds = membership.branchAssignments.map(
      (assignment) => assignment.branchId,
    );

    /*
     * Keep this variable available for future branch-specific
     * subscription/access rules.
     */
    void assignedBranchIds;

    const accessibleReceiptWhere: Prisma.ReceiptWhereInput =
      membership.role === 'OWNER'
        ? {
            businessId: business.id,
          }
        : {
            businessId: business.id,
            createdByUserId: userId,
          };

    /*
     * 5. Run independent dashboard queries together.
     */
    const [
      todayReceipts,
      todaySalesAggregation,
      totalReceipts,
      recentReceipts,
    ] = await this.prisma.$transaction([
      /*
       * Number of receipts issued today.
       */
      this.prisma.receipt.count({
        where: {
          ...accessibleReceiptWhere,

          issuedAt: {
            gte: startOfToday,
            lt: startOfTomorrow,
          },
        },
      }),

      /*
       * Sum of today's issued receipt totals.
       *
       * Voided receipts remain in history but do not count as
       * actual revenue.
       */
      this.prisma.receipt.aggregate({
        where: {
          ...accessibleReceiptWhere,

          status: 'ISSUED',

          issuedAt: {
            gte: startOfToday,
            lt: startOfTomorrow,
          },
        },

        _sum: {
          grandTotal: true,
        },
      }),

      /*
       * Total receipt count across all dates.
       */
      this.prisma.receipt.count({
        where: accessibleReceiptWhere,
      }),

      /*
       * Five most recent receipts.
       */
      this.prisma.receipt.findMany({
        where: accessibleReceiptWhere,

        orderBy: {
          issuedAt: 'desc',
        },

        take: 5,

        select: {
          id: true,
          receiptNumber: true,
          customerName: true,
          currency: true,
          grandTotal: true,
          paymentMethod: true,
          status: true,
          issuedAt: true,

          branch: {
            select: {
              id: true,
              branchName: true,
            },
          },
        },
      }),
    ]);

    const todaySales = todaySalesAggregation._sum.grandTotal?.toString() ?? '0';

    /*
     * 6. Build dashboard response.
     */
    return {
      user,

      hasBusiness: true,

      membership: {
        id: membership.id,
        role: membership.role,
        status: membership.status,
      },

      business: {
        id: business.id,
        businessName: business.businessName,
        businessType: business.businessType,
        defaultCurrency: business.defaultCurrency,
        logo: business.logo,
        taxEnabled: business.taxEnabled,
        taxRate: business.taxRate,
      },

      branch: mainBranch
        ? {
            id: mainBranch.id,
            branchName: mainBranch.branchName,
            country: mainBranch.country,
            receiptPrefix: mainBranch.receiptPrefix,
            nextReceiptNumber: mainBranch.nextReceiptNumber,
            isMainBranch: mainBranch.isMainBranch,
          }
        : null,

      assignedBranches: membership.branchAssignments.map((assignment) => ({
        id: assignment.branch.id,
        branchName: assignment.branch.branchName,
        country: assignment.branch.country,
        isMainBranch: assignment.branch.isMainBranch,
      })),

      stats: {
        todayReceipts,

        todaySales,

        totalReceipts,

        employees:
          membership.role === 'OWNER' ? business._count.memberships : 0,
      },

      recentReceipts: recentReceipts.map((receipt) => ({
        id: receipt.id,

        receiptNumber: receipt.receiptNumber,

        customerName: receipt.customerName,

        currency: receipt.currency,

        grandTotal: receipt.grandTotal.toString(),

        paymentMethod: receipt.paymentMethod,

        status: receipt.status,

        issuedAt: receipt.issuedAt,

        branch: receipt.branch,
      })),

      subscription: business.subscription
        ? {
            id: business.subscription.id,
            plan: business.subscription.plan,
            status: business.subscription.status,
            startsAt: business.subscription.startsAt,
            endsAt: business.subscription.endsAt,
          }
        : {
            id: null,
            plan: 'FREE',
            status: 'ACTIVE',
            startsAt: null,
            endsAt: null,
          },
    };
  }

  async getAnalytics(userId: string, query: DashboardAnalyticsQueryDto) {
    const dateRange = this.resolveAnalyticsDateRange(query);

    const previousPeriod = this.resolvePreviousPeriod(dateRange);

    /*
     * Find the user's active business and active branch
     * assignments.
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

        business: {
          select: {
            id: true,
            businessName: true,
            defaultCurrency: true,
          },
        },

        branchAssignments: {
          where: {
            isActive: true,
          },

          select: {
            branchId: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('No active business membership was found.');
    }

    /*
     * Analytics remain owner-only.
     */
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Analytics are available only to the business owner.',
      );
    }
    await this.subscriptionsService.assertAnalyticsAllowed(
      membership.businessId,
    );

    const branchIds = membership.branchAssignments.map(
      (assignment) => assignment.branchId,
    );

    /*
     * An active membership without a branch assignment must not
     * expose business receipt data.
     */
    if (branchIds.length === 0) {
      return {
        period: {
          type: query.period,
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
        },

        previousPeriod: {
          dateFrom: previousPeriod.previousDateFrom,

          dateTo: previousPeriod.previousDateTo,
        },

        business: membership.business,

        summary: {
          totalSales: '0',
          receiptCount: 0,
          averageReceiptValue: '0',
          uniqueCustomers: 0,
          issuedReceipts: 0,
          voidedReceipts: 0,
          correctedReceipts: 0,
        },

        comparison: {
          previousTotalSales: '0',
          previousReceiptCount: 0,
          salesGrowthPercentage: 0,
          receiptGrowthPercentage: 0,
        },

        paymentMethods: [],

        dailySales: this.generateDateKeys(
          dateRange.dateFrom,
          dateRange.dateTo,
        ).map((date) => ({
          date,
          receiptCount: 0,
          totalSales: '0',
        })),

        highestValueReceipt: null,

        bestSalesDay: null,

        recentReceipts: [],
      };
    }

    const baseReceiptWhere: Prisma.ReceiptWhereInput = {
      businessId: membership.businessId,

      branchId: {
        in: branchIds,
      },

      issuedAt: {
        gte: dateRange.dateFrom,
        lt: dateRange.dateTo,
      },
    };

    const previousReceiptWhere: Prisma.ReceiptWhereInput = {
      businessId: membership.businessId,

      branchId: {
        in: branchIds,
      },

      issuedAt: {
        gte: previousPeriod.previousDateFrom,

        lt: previousPeriod.previousDateTo,
      },
    };

    /*
     * Revenue calculations include only issued receipts.
     *
     * Voided receipts remain in the database for audit purposes,
     * but they are not counted as sales.
     */
    const [
      issuedAggregation,
      receiptCount,
      issuedReceipts,
      voidedReceipts,
      correctedReceipts,
      namedCustomers,
      previousIssuedAggregation,
      previousReceiptCount,
      dailyReceiptRows,
      highestValueReceipt,
      recentReceipts,
    ] = await this.prisma.$transaction([
      /*
       * Current-period sales sum and average.
       */
      this.prisma.receipt.aggregate({
        where: {
          ...baseReceiptWhere,
          status: 'ISSUED',
        },

        _sum: {
          grandTotal: true,
        },

        _avg: {
          grandTotal: true,
        },
      }),

      /*
       * All current-period receipt records.
       */
      this.prisma.receipt.count({
        where: baseReceiptWhere,
      }),

      this.prisma.receipt.count({
        where: {
          ...baseReceiptWhere,
          status: 'ISSUED',
        },
      }),

      this.prisma.receipt.count({
        where: {
          ...baseReceiptWhere,
          status: 'VOIDED',
        },
      }),

      this.prisma.receipt.count({
        where: {
          ...baseReceiptWhere,
          status: 'CORRECTED',
        },
      }),

      /*
       * Distinct named customers.
       */
      this.prisma.receipt.findMany({
        where: {
          ...baseReceiptWhere,

          status: 'ISSUED',

          customerName: {
            not: null,
          },
        },

        select: {
          customerName: true,
        },

        distinct: ['customerName'],
      }),

      /*
       * Previous-period issued-sales sum.
       */
      this.prisma.receipt.aggregate({
        where: {
          ...previousReceiptWhere,
          status: 'ISSUED',
        },

        _sum: {
          grandTotal: true,
        },
      }),

      /*
       * Previous-period total receipt count.
       */
      this.prisma.receipt.count({
        where: previousReceiptWhere,
      }),

      /*
       * Raw issued receipts used to build:
       *
       * - daily sales
       * - payment method breakdown
       */
      this.prisma.receipt.findMany({
        where: {
          ...baseReceiptWhere,
          status: 'ISSUED',
        },

        select: {
          grandTotal: true,
          issuedAt: true,
          paymentMethod: true,
        },

        orderBy: {
          issuedAt: 'asc',
        },
      }),

      /*
       * Largest issued receipt.
       */
      this.prisma.receipt.findFirst({
        where: {
          ...baseReceiptWhere,
          status: 'ISSUED',
        },

        orderBy: {
          grandTotal: 'desc',
        },

        select: {
          id: true,
          receiptNumber: true,
          customerName: true,
          currency: true,
          grandTotal: true,
          paymentMethod: true,
          issuedAt: true,

          branch: {
            select: {
              id: true,
              branchName: true,
            },
          },
        },
      }),

      /*
       * Ten latest receipt records.
       */
      this.prisma.receipt.findMany({
        where: baseReceiptWhere,

        orderBy: {
          issuedAt: 'desc',
        },

        take: 10,

        select: {
          id: true,
          receiptNumber: true,
          customerName: true,
          currency: true,
          grandTotal: true,
          paymentMethod: true,
          status: true,
          issuedAt: true,

          branch: {
            select: {
              id: true,
              branchName: true,
            },
          },

          createdByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    ]);

    const totalSales = issuedAggregation._sum.grandTotal?.toString() ?? '0';

    const averageReceiptValue =
      issuedAggregation._avg.grandTotal?.toString() ?? '0';

    /*
     * Payment method breakdown.
     */
    const paymentMethodAccumulator = new Map<
      string,
      {
        receiptCount: number;
        totalSales: number;
      }
    >();

    for (const receipt of dailyReceiptRows) {
      const current = paymentMethodAccumulator.get(receipt.paymentMethod) ?? {
        receiptCount: 0,
        totalSales: 0,
      };

      current.receiptCount += 1;

      current.totalSales += Number(receipt.grandTotal);

      paymentMethodAccumulator.set(receipt.paymentMethod, current);
    }

    const paymentMethods = Array.from(paymentMethodAccumulator.entries())
      .map(([paymentMethod, values]) => ({
        paymentMethod,

        receiptCount: values.receiptCount,

        totalSales: String(values.totalSales),
      }))
      .sort(
        (first, second) => Number(second.totalSales) - Number(first.totalSales),
      );

    /*
     * Daily sales.
     */
    const dailyAccumulator = new Map<string, DailySalesAccumulator>();

    for (const row of dailyReceiptRows) {
      const dateKey = this.formatDateKey(row.issuedAt);

      const existing = dailyAccumulator.get(dateKey) ?? {
        receiptCount: 0,
        totalSales: 0,
      };

      existing.receiptCount += 1;

      existing.totalSales += Number(row.grandTotal);

      dailyAccumulator.set(dateKey, existing);
    }

    const dailySales = this.generateDateKeys(
      dateRange.dateFrom,
      dateRange.dateTo,
    ).map((date) => {
      const day = dailyAccumulator.get(date);

      return {
        date,

        receiptCount: day?.receiptCount ?? 0,

        totalSales: String(day?.totalSales ?? 0),
      };
    });

    /*
     * Best sales day.
     */
    const bestSalesDay = dailySales.reduce<{
      date: string;
      receiptCount: number;
      totalSales: string;
    } | null>(
      (best, day) => {
        if (!best) {
          return day;
        }

        return Number(day.totalSales) > Number(best.totalSales) ? day : best;
      },

      null,
    );

    const meaningfulBestSalesDay =
      bestSalesDay && Number(bestSalesDay.totalSales) > 0 ? bestSalesDay : null;

    const previousTotalSales =
      previousIssuedAggregation._sum.grandTotal?.toString() ?? '0';

    const salesGrowthPercentage = this.calculateGrowthPercentage(
      Number(totalSales),
      Number(previousTotalSales),
    );

    const receiptGrowthPercentage = this.calculateGrowthPercentage(
      receiptCount,
      previousReceiptCount,
    );

    const formattedHighestValueReceipt = highestValueReceipt
      ? {
          id: highestValueReceipt.id,

          receiptNumber: highestValueReceipt.receiptNumber,

          customerName: highestValueReceipt.customerName,

          currency: highestValueReceipt.currency,

          grandTotal: highestValueReceipt.grandTotal.toString(),

          paymentMethod: highestValueReceipt.paymentMethod,

          issuedAt: highestValueReceipt.issuedAt,

          branch: highestValueReceipt.branch,
        }
      : null;

    const formattedRecentReceipts = recentReceipts.map((receipt) => ({
      id: receipt.id,

      receiptNumber: receipt.receiptNumber,

      customerName: receipt.customerName,

      currency: receipt.currency,

      grandTotal: receipt.grandTotal.toString(),

      paymentMethod: receipt.paymentMethod,

      status: receipt.status,

      issuedAt: receipt.issuedAt,

      branch: receipt.branch,

      createdByUser: receipt.createdByUser,
    }));

    return {
      period: {
        type: query.period,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      },

      previousPeriod: {
        dateFrom: previousPeriod.previousDateFrom,

        dateTo: previousPeriod.previousDateTo,
      },

      business: membership.business,

      summary: {
        totalSales,

        receiptCount,

        averageReceiptValue,

        uniqueCustomers: namedCustomers.length,

        issuedReceipts,

        voidedReceipts,

        correctedReceipts,
      },

      comparison: {
        previousTotalSales,

        previousReceiptCount,

        salesGrowthPercentage,

        receiptGrowthPercentage,
      },

      paymentMethods,

      dailySales,

      highestValueReceipt: formattedHighestValueReceipt,

      bestSalesDay: meaningfulBestSalesDay,

      recentReceipts: formattedRecentReceipts,
    };
  }

  /**
   * Start of day.
   */
  private startOfDay(date: Date): Date {
    const result = new Date(date);

    result.setHours(0, 0, 0, 0);

    return result;
  }

  /**
   * Add days to a date.
   */
  private addDays(date: Date, numberOfDays: number): Date {
    const result = new Date(date);

    result.setDate(result.getDate() + numberOfDays);

    return result;
  }

  /**
   * Start of month.
   */
  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  /**
   * Custom date validation.
   */
  private resolveCustomDateRange(
    dateFrom?: string,
    dateTo?: string,
  ): AnalyticsDateRange {
    if (!dateFrom || !dateTo) {
      throw new BadRequestException(
        'dateFrom and dateTo are required when period is CUSTOM.',
      );
    }

    const parsedDateFrom = this.startOfDay(new Date(dateFrom));

    const parsedDateTo = this.addDays(this.startOfDay(new Date(dateTo)), 1);

    if (
      Number.isNaN(parsedDateFrom.getTime()) ||
      Number.isNaN(parsedDateTo.getTime())
    ) {
      throw new BadRequestException('The custom analytics dates are invalid.');
    }

    if (parsedDateFrom >= parsedDateTo) {
      throw new BadRequestException(
        'dateFrom must be earlier than or equal to dateTo.',
      );
    }

    const maximumDateTo = this.addDays(this.startOfDay(new Date()), 1);

    if (parsedDateTo > maximumDateTo) {
      throw new BadRequestException('Analytics cannot include future dates.');
    }

    const rangeInMilliseconds =
      parsedDateTo.getTime() - parsedDateFrom.getTime();

    const maximumRangeInMilliseconds = 366 * 24 * 60 * 60 * 1000;

    if (rangeInMilliseconds > maximumRangeInMilliseconds) {
      throw new BadRequestException(
        'The custom analytics range cannot exceed 366 days.',
      );
    }

    return {
      dateFrom: parsedDateFrom,

      dateTo: parsedDateTo,
    };
  }

  /**
   * Analytics date-range resolver.
   */
  private resolveAnalyticsDateRange(
    query: DashboardAnalyticsQueryDto,
  ): AnalyticsDateRange {
    const now = new Date();

    const startOfToday = this.startOfDay(now);

    const startOfTomorrow = this.addDays(startOfToday, 1);

    switch (query.period) {
      case AnalyticsPeriod.TODAY:
        return {
          dateFrom: startOfToday,

          dateTo: startOfTomorrow,
        };

      case AnalyticsPeriod.YESTERDAY:
        return {
          dateFrom: this.addDays(startOfToday, -1),

          dateTo: startOfToday,
        };

      case AnalyticsPeriod.LAST_7_DAYS:
        return {
          dateFrom: this.addDays(startOfToday, -6),

          dateTo: startOfTomorrow,
        };

      case AnalyticsPeriod.LAST_30_DAYS:
        return {
          dateFrom: this.addDays(startOfToday, -29),

          dateTo: startOfTomorrow,
        };

      case AnalyticsPeriod.THIS_MONTH:
        return {
          dateFrom: this.startOfMonth(now),

          dateTo: startOfTomorrow,
        };

      case AnalyticsPeriod.LAST_MONTH: {
        const startOfCurrentMonth = this.startOfMonth(now);

        const startOfPreviousMonth = new Date(
          startOfCurrentMonth.getFullYear(),
          startOfCurrentMonth.getMonth() - 1,
          1,
        );

        return {
          dateFrom: startOfPreviousMonth,

          dateTo: startOfCurrentMonth,
        };
      }

      case AnalyticsPeriod.CUSTOM:
        return this.resolveCustomDateRange(query.dateFrom, query.dateTo);

      default:
        throw new BadRequestException(
          'The selected analytics period is invalid.',
        );
    }
  }

  /**
   * Resolve previous period.
   */
  private resolvePreviousPeriod(
    currentRange: AnalyticsDateRange,
  ): AnalyticsComparison {
    const periodLength =
      currentRange.dateTo.getTime() - currentRange.dateFrom.getTime();

    const previousDateTo = new Date(currentRange.dateFrom);

    const previousDateFrom = new Date(previousDateTo.getTime() - periodLength);

    return {
      previousDateFrom,

      previousDateTo,
    };
  }

  /**
   * Safe growth percentage helper.
   */
  private calculateGrowthPercentage(
    currentValue: number,
    previousValue: number,
  ): number | null {
    if (previousValue === 0) {
      return currentValue === 0 ? 0 : null;
    }

    const growth = ((currentValue - previousValue) / previousValue) * 100;

    return Number(growth.toFixed(2));
  }

  /**
   * Date-key helper.
   */
  private formatDateKey(date: Date): string {
    const year = date.getFullYear();

    const month = String(date.getMonth() + 1).padStart(2, '0');

    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * Analytics day generator.
   */
  private generateDateKeys(dateFrom: Date, dateTo: Date): string[] {
    const dates: string[] = [];

    let cursor = this.startOfDay(dateFrom);

    while (cursor < dateTo) {
      dates.push(this.formatDateKey(cursor));

      cursor = this.addDays(cursor, 1);
    }

    return dates;
  }
}
