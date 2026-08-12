import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BusinessContextService } from '../business-context/business-context.service';
import { PrismaService } from '../prisma/prisma.service';

import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessContextService: BusinessContextService,
  ) {}

  private async getManagementContext(userId: string) {
    const business =
      await this.businessContextService.getCurrentBusiness(userId);

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        businessId: business.id,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('Active business membership required.');
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can perform this action.',
      );
    }

    return {
      business,
      membership,
    };
  }

  async findAll(userId: string) {
    const business =
      await this.businessContextService.getCurrentBusiness(userId);

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        businessId: business.id,
        status: 'ACTIVE',
      },

      select: {
        id: true,
        role: true,

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
      throw new ForbiddenException('Active business membership required.');
    }

    /*
     * OWNER sees every branch.
     *
     * Staff sees only branches to which
     * they have an active assignment.
     */
    const branchIds = membership.branchAssignments.map(
      (assignment) => assignment.branchId,
    );

    return this.prisma.branch.findMany({
      where: {
        businessId: business.id,

        ...(membership.role !== 'OWNER'
          ? {
              id: {
                in: branchIds,
              },

              isActive: true,
            }
          : {}),
      },

      orderBy: [
        {
          isMainBranch: 'desc',
        },
        {
          branchName: 'asc',
        },
      ],
    });
  }

  async findOne(userId: string, branchId: string) {
    const business =
      await this.businessContextService.getCurrentBusiness(userId);

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        businessId: business.id,
        status: 'ACTIVE',
      },

      select: {
        role: true,

        branchAssignments: {
          where: {
            branchId,
            isActive: true,
          },

          select: {
            id: true,
          },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Active business membership required.');
    }

    /*
     * Staff may only read an actively
     * assigned branch.
     */
    if (
      membership.role !== 'OWNER' &&
      membership.branchAssignments.length === 0
    ) {
      throw new NotFoundException('Branch not found.');
    }

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        businessId: business.id,

        ...(membership.role !== 'OWNER'
          ? {
              isActive: true,
            }
          : {}),
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }

    return branch;
  }

  async create(userId: string, dto: CreateBranchDto) {
    const { business, membership } = await this.getManagementContext(userId);

    return this.prisma.$transaction(async (transaction) => {
      if (dto.isMainBranch) {
        await transaction.branch.updateMany({
          where: {
            businessId: business.id,
            isMainBranch: true,
          },
          data: {
            isMainBranch: false,
          },
        });
      }

      const branch = await transaction.branch.create({
        data: {
          businessId: business.id,

          branchName: dto.branchName.trim(),

          address: dto.address?.trim() || null,

          city: dto.city?.trim() || null,

          stateOrProvince: dto.stateOrProvince?.trim() || null,

          country: dto.country.trim(),

          phone: dto.phone?.trim() || null,

          receiptPrefix: dto.receiptPrefix?.trim().toUpperCase() || 'RCPT',

          isMainBranch: dto.isMainBranch ?? false,
        },
      });

      await transaction.branchAssignment.create({
        data: {
          membershipId: membership.id,

          branchId: branch.id,

          isActive: true,
        },
      });

      return branch;
    });
  }

  async update(userId: string, branchId: string, dto: UpdateBranchDto) {
    const { business } = await this.getManagementContext(userId);

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        businessId: business.id,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }

    if (branch.isMainBranch && dto.isActive === false) {
      throw new BadRequestException(
        'Set another branch as the main branch before deactivating this branch.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      if (dto.isMainBranch === true) {
        await transaction.branch.updateMany({
          where: {
            businessId: business.id,

            isMainBranch: true,

            NOT: {
              id: branchId,
            },
          },
          data: {
            isMainBranch: false,
          },
        });
      }

      return transaction.branch.update({
        where: {
          id: branchId,
        },
        data: {
          ...(dto.branchName !== undefined
            ? {
                branchName: dto.branchName.trim(),
              }
            : {}),

          ...(dto.address !== undefined
            ? {
                address: dto.address.trim() || null,
              }
            : {}),

          ...(dto.city !== undefined
            ? {
                city: dto.city.trim() || null,
              }
            : {}),

          ...(dto.stateOrProvince !== undefined
            ? {
                stateOrProvince: dto.stateOrProvince.trim() || null,
              }
            : {}),

          ...(dto.country !== undefined
            ? {
                country: dto.country.trim(),
              }
            : {}),

          ...(dto.phone !== undefined
            ? {
                phone: dto.phone.trim() || null,
              }
            : {}),

          ...(dto.receiptPrefix !== undefined
            ? {
                receiptPrefix: dto.receiptPrefix.trim().toUpperCase(),
              }
            : {}),

          ...(dto.isMainBranch !== undefined
            ? {
                isMainBranch: dto.isMainBranch,
              }
            : {}),

          ...(dto.isActive !== undefined
            ? {
                isActive: dto.isActive,
              }
            : {}),
        },
      });
    });
  }
}
