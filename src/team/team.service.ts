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
}
