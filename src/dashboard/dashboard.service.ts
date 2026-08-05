import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { DashboardAnalyticsQueryDto } from './dto/dashboard-analytics-query.dto';
import { AnalyticsPeriod } from './enums/analytics-period.enum';

type AnalyticsDateRange = {
  dateFrom: Date;
  dateTo: Date;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

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
          plan: 'FREE',
        },
      };
    }

    const business = membership.business;
    const mainBranch = business.branches[0] ?? null;

    /*
     * 4. Determine the start of today and tomorrow.
     *
     * This currently uses the backend server's local date.
     * Later, we will store a timezone for each business and
     * calculate these boundaries using that timezone.
     */
    const startOfToday = new Date();

    startOfToday.setHours(0, 0, 0, 0);

    const startOfTomorrow = new Date(startOfToday);

    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    /*
     * 5. Only include branches assigned to this user.
     *
     * This is important for managers and cashiers who might
     * have access to only one branch.
     */
    const assignedBranchIds = membership.branchAssignments.map(
      (assignment) => assignment.branchId,
    );

    /*
     * An active membership without a branch assignment should
     * not expose receipt statistics.
     */
    const accessibleReceiptWhere = {
      businessId: business.id,
      branchId: {
        in: assignedBranchIds,
      },
    };

    /*
     * 6. Run independent dashboard queries together.
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
       * Voided receipts are excluded because they should no
       * longer count as actual sales.
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
       * Five most recent receipts for the dashboard.
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

    /*
     * Prisma returns null when no rows exist for a Decimal sum.
     */
    const todaySales = todaySalesAggregation._sum.grandTotal?.toString() ?? '0';

    /*
     * 7. Build the dashboard response.
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
        employees: business._count.memberships,
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

      subscription: {
        plan: 'FREE',
      },
    };
  }

  async getAnalytics(userId: string, query: DashboardAnalyticsQueryDto) {
    const dateRange = this.resolveAnalyticsDateRange(query);

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
      };
    }

    const baseReceiptWhere = {
      businessId: membership.businessId,

      branchId: {
        in: branchIds,
      },

      issuedAt: {
        gte: dateRange.dateFrom,
        lt: dateRange.dateTo,
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
    ] = await this.prisma.$transaction([
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
    ]);

    const totalSales = issuedAggregation._sum.grandTotal?.toString() ?? '0';

    const averageReceiptValue =
      issuedAggregation._avg.grandTotal?.toString() ?? '0';

    return {
      period: {
        type: query.period,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
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
    };
  }

  /**Start of day */
  private startOfDay(date: Date): Date {
    const result = new Date(date);

    result.setHours(0, 0, 0, 0);

    return result;
  }

  /**Add days to the date*/
  private addDays(date: Date, numberOfDays: number): Date {
    const result = new Date(date);

    result.setDate(result.getDate() + numberOfDays);

    return result;
  }

  /**Start of month */
  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  /** custom-date validation*/
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

  /** analytics date-range resolver*/
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
}
