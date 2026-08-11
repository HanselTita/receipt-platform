import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BusinessContextService } from '../business-context/business-context.service';
import { PrismaService } from '../prisma/prisma.service';

import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

@Injectable()
export class TeamService {
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

    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Only owners and administrators can manage team members.',
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

    return this.prisma.businessMembership.findMany({
      where: {
        businessId: business.id,
        status: {
          not: 'REMOVED',
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        role: true,
        status: true,
        joinedAt: true,

        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },

        branchAssignments: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
            branchId: true,
            isActive: true,

            branch: {
              select: {
                id: true,
                branchName: true,
                isMainBranch: true,
              },
            },
          },
        },
      },
    });
  }

  async addMember(userId: string, dto: AddTeamMemberDto) {
    const { business } = await this.getManagementContext(userId);

    if (dto.role === 'OWNER') {
      throw new BadRequestException(
        'Another owner cannot be added through this action.',
      );
    }

    const normalizedEmail = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        'No SwiftReceipt user was found with this email address.',
      );
    }

    if (!user.isActive) {
      throw new BadRequestException('This user account is inactive.');
    }

    const existingMembership = await this.prisma.businessMembership.findUnique({
      where: {
        userId_businessId: {
          userId: user.id,
          businessId: business.id,
        },
      },
    });

    if (existingMembership) {
      if (existingMembership.status !== 'REMOVED') {
        throw new BadRequestException(
          'This user is already a member of the business.',
        );
      }

      return this.prisma.businessMembership.update({
        where: {
          id: existingMembership.id,
        },
        data: {
          role: dto.role,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    }

    return this.prisma.businessMembership.create({
      data: {
        userId: user.id,
        businessId: business.id,
        role: dto.role,
        status: 'ACTIVE',
      },
    });
  }

  async updateMember(
    userId: string,
    membershipId: string,
    dto: UpdateTeamMemberDto,
  ) {
    const { business } = await this.getManagementContext(userId);

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        id: membershipId,
        businessId: business.id,
      },
    });

    if (!membership) {
      throw new NotFoundException('Team member was not found.');
    }

    if (membership.role === 'OWNER') {
      throw new BadRequestException(
        'The business owner cannot be modified through this action.',
      );
    }

    if (dto.role === 'OWNER') {
      throw new BadRequestException(
        'Ownership cannot be assigned through this action.',
      );
    }

    return this.prisma.businessMembership.update({
      where: {
        id: membership.id,
      },
      data: {
        ...(dto.role !== undefined
          ? {
              role: dto.role,
            }
          : {}),

        ...(dto.status !== undefined
          ? {
              status: dto.status,
            }
          : {}),
      },
    });
  }

  async findOne(userId: string, membershipId: string) {
    const { business } = await this.getManagementContext(userId);

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        id: membershipId,
        businessId: business.id,
        status: {
          not: 'REMOVED',
        },
      },
      select: {
        id: true,
        role: true,
        status: true,
        joinedAt: true,

        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },

        branchAssignments: {
          select: {
            id: true,
            branchId: true,
            isActive: true,

            branch: {
              select: {
                id: true,
                branchName: true,
                isMainBranch: true,
                isActive: true,
              },
            },
          },
          orderBy: {
            assignedAt: 'asc',
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Team member was not found.');
    }

    return membership;
  }

  async updateBranchAssignments(
    userId: string,
    membershipId: string,
    branchIds: string[],
  ) {
    const { business } = await this.getManagementContext(userId);

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        id: membershipId,
        businessId: business.id,
        status: {
          not: 'REMOVED',
        },
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Team member was not found.');
    }

    if (membership.role === 'OWNER') {
      throw new BadRequestException(
        'The business owner branch assignments cannot be changed through this action.',
      );
    }

    /*
     * Confirm every submitted branch belongs to
     * the current business and is active.
     */
    const branches =
      branchIds.length > 0
        ? await this.prisma.branch.findMany({
            where: {
              businessId: business.id,
              id: {
                in: branchIds,
              },
              isActive: true,
            },
            select: {
              id: true,
            },
          })
        : [];

    if (branches.length !== branchIds.length) {
      throw new BadRequestException(
        'One or more selected branches are invalid or inactive.',
      );
    }

    const selectedBranchIds = new Set(branchIds);

    return this.prisma.$transaction(async (transaction) => {
      const existingAssignments = await transaction.branchAssignment.findMany({
        where: {
          membershipId,
        },
      });

      /*
       * Deactivate assignments that are no
       * longer selected.
       */
      for (const assignment of existingAssignments) {
        if (
          !selectedBranchIds.has(assignment.branchId) &&
          assignment.isActive
        ) {
          await transaction.branchAssignment.update({
            where: {
              id: assignment.id,
            },
            data: {
              isActive: false,
            },
          });
        }
      }

      /*
       * Create or reactivate every selected
       * branch assignment.
       */
      for (const branchId of branchIds) {
        const existing = existingAssignments.find(
          (assignment) => assignment.branchId === branchId,
        );

        if (existing) {
          if (!existing.isActive) {
            await transaction.branchAssignment.update({
              where: {
                id: existing.id,
              },
              data: {
                isActive: true,
              },
            });
          }

          continue;
        }

        await transaction.branchAssignment.create({
          data: {
            membershipId,
            branchId,
            isActive: true,
          },
        });
      }

      return transaction.businessMembership.findUnique({
        where: {
          id: membershipId,
        },
        select: {
          id: true,
          role: true,
          status: true,

          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },

          branchAssignments: {
            where: {
              isActive: true,
            },
            select: {
              id: true,
              branchId: true,

              branch: {
                select: {
                  id: true,
                  branchName: true,
                  isMainBranch: true,
                },
              },
            },
          },
        },
      });
    });
  }
}
