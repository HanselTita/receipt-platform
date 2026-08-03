import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string) {
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

    if (!membership) {
      return {
        user,
        hasBusiness: false,
        business: null,
        branch: null,
        stats: {
          todayReceipts: 0,
          employees: 0,
        },
        subscription: {
          plan: 'FREE',
        },
      };
    }

    const mainBranch = membership.business.branches[0] ?? null;

    return {
      user,
      hasBusiness: true,
      membership: {
        id: membership.id,
        role: membership.role,
        status: membership.status,
      },
      business: {
        id: membership.business.id,
        businessName: membership.business.businessName,
        businessType: membership.business.businessType,
        defaultCurrency: membership.business.defaultCurrency,
        logo: membership.business.logo,
        taxEnabled: membership.business.taxEnabled,
        taxRate: membership.business.taxRate,
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
        todayReceipts: 0,
        employees: membership.business._count.memberships,
      },
      subscription: {
        plan: 'FREE',
      },
    };
  }
}
