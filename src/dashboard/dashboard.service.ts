import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

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
}
