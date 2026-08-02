import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createBusinessDto: CreateBusinessDto) {
    const taxEnabled = createBusinessDto.taxEnabled ?? false;

    if (taxEnabled && createBusinessDto.taxRate === undefined) {
      throw new BadRequestException(
        'A tax rate is required when tax is enabled.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const business = await transaction.business.create({
        data: {
          businessName: createBusinessDto.businessName,
          businessType: createBusinessDto.businessType,
          defaultCurrency: createBusinessDto.defaultCurrency,
          taxEnabled,
          taxRate: taxEnabled ? createBusinessDto.taxRate : null,
        },
      });

      const mainBranch = await transaction.branch.create({
        data: {
          branchName: 'Main Branch',
          country: createBusinessDto.country,
          receiptPrefix: 'RCP',
          nextReceiptNumber: 1,
          isMainBranch: true,
          businessId: business.id,
        },
      });

      const ownerMembership = await transaction.businessMembership.create({
        data: {
          userId,
          businessId: business.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      await transaction.branchAssignment.create({
        data: {
          membershipId: ownerMembership.id,
          branchId: mainBranch.id,
          isActive: true,
        },
      });

      return {
        message: 'Business created successfully.',
        business,
        mainBranch,
        membership: {
          id: ownerMembership.id,
          role: ownerMembership.role,
          status: ownerMembership.status,
        },
      };
    });
  }

  async findAllForUser(userId: string) {
    const memberships = await this.prisma.businessMembership.findMany({
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
              orderBy: [
                {
                  isMainBranch: 'desc',
                },
                {
                  createdAt: 'asc',
                },
              ],
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

    return {
      businesses: memberships.map((membership) => ({
        membershipId: membership.id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
        business: membership.business,
        assignedBranches: membership.branchAssignments.map(
          (assignment) => assignment.branch,
        ),
      })),
    };
  }
}
