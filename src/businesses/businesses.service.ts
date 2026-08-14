import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private async getOwnerContext(userId: string) {
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
        businessId: true,
        role: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can manage business settings.',
      );
    }

    return membership;
  }

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
          businessName: createBusinessDto.businessName.trim(),
          businessType: createBusinessDto.businessType.trim(),
          defaultCurrency: createBusinessDto.defaultCurrency
            .trim()
            .toUpperCase(),

          taxEnabled,

          taxRate: taxEnabled ? createBusinessDto.taxRate : null,

          subscription: {
            create: {
              plan: 'FREE',
              status: 'ACTIVE',
            },
          },
        },

        include: {
          subscription: true,
        },
      });

      const mainBranch = await transaction.branch.create({
        data: {
          branchName: 'Main Branch',
          country: createBusinessDto.country.trim(),
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

            subscription: true,
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

  async getSettings(userId: string) {
    const membership = await this.getOwnerContext(userId);

    const business = await this.prisma.business.findUnique({
      where: {
        id: membership.businessId,
      },

      select: {
        id: true,
        businessName: true,
        businessType: true,
        logo: true,
        receiptFooter: true,
        email: true,
        phone: true,
        defaultCurrency: true,
        taxEnabled: true,
        taxRate: true,
        createdAt: true,
        updatedAt: true,

        subscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    if (!business) {
      throw new BadRequestException('Business could not be found.');
    }

    return {
      business: {
        ...business,
        taxRate: business.taxRate?.toString() ?? null,

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
      },
    };
  }

  async updateSettings(userId: string, dto: UpdateBusinessSettingsDto) {
    const membership = await this.getOwnerContext(userId);
    if (dto.receiptFooter !== undefined) {
      await this.subscriptionsService.assertCustomBrandingAllowed(
        membership.businessId,
      );
    }
    const currentBusiness = await this.prisma.business.findUnique({
      where: {
        id: membership.businessId,
      },

      select: {
        id: true,
        taxEnabled: true,
        taxRate: true,
        receiptFooter: true,
      },
    });

    if (!currentBusiness) {
      throw new BadRequestException('Business could not be found.');
    }

    const taxEnabled = dto.taxEnabled ?? currentBusiness.taxEnabled;

    const resultingTaxRate =
      dto.taxRate !== undefined ? dto.taxRate : currentBusiness.taxRate;

    if (
      taxEnabled &&
      (resultingTaxRate === null || resultingTaxRate === undefined)
    ) {
      throw new BadRequestException(
        'A tax rate is required when tax is enabled.',
      );
    }

    const business = await this.prisma.business.update({
      where: {
        id: membership.businessId,
      },

      data: {
        ...(dto.businessName !== undefined
          ? {
              businessName: dto.businessName.trim(),
            }
          : {}),

        ...(dto.businessType !== undefined
          ? {
              businessType: dto.businessType.trim(),
            }
          : {}),

        ...(dto.email !== undefined
          ? {
              email: dto.email.trim().toLowerCase(),
            }
          : {}),

        ...(dto.phone !== undefined
          ? {
              phone: dto.phone.trim() || null,
            }
          : {}),

        ...(dto.receiptFooter !== undefined
          ? {
              receiptFooter: dto.receiptFooter.trim() || null,
            }
          : {}),

        ...(dto.defaultCurrency !== undefined
          ? {
              defaultCurrency: dto.defaultCurrency.trim().toUpperCase(),
            }
          : {}),

        ...(dto.taxEnabled !== undefined
          ? {
              taxEnabled: dto.taxEnabled,
            }
          : {}),

        ...(taxEnabled
          ? dto.taxRate !== undefined
            ? {
                taxRate: dto.taxRate,
              }
            : {}
          : {
              taxRate: null,
            }),
      },

      select: {
        id: true,
        businessName: true,
        businessType: true,
        logo: true,
        receiptFooter: true,
        email: true,
        phone: true,
        defaultCurrency: true,
        taxEnabled: true,
        taxRate: true,
        createdAt: true,
        updatedAt: true,

        subscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    return {
      message: 'Business settings updated successfully.',

      business: {
        ...business,
        taxRate: business.taxRate?.toString() ?? null,

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
      },
    };
  }

  async updateLogo(userId: string, logoPath: string) {
    const membership = await this.getOwnerContext(userId);
    await this.subscriptionsService.assertCustomBrandingAllowed(
      membership.businessId,
    );
    const business = await this.prisma.business.update({
      where: {
        id: membership.businessId,
      },

      data: {
        logo: logoPath,
      },

      select: {
        id: true,
        logo: true,
      },
    });

    return {
      message: 'Business logo updated successfully.',
      business,
    };
  }

  async removeLogo(userId: string) {
    const membership = await this.getOwnerContext(userId);
    await this.subscriptionsService.assertCustomBrandingAllowed(
      membership.businessId,
    );
    const business = await this.prisma.business.update({
      where: {
        id: membership.businessId,
      },

      data: {
        logo: null,
      },

      select: {
        id: true,
        logo: true,
      },
    });

    return {
      message: 'Business logo removed successfully.',
      business,
    };
  }
}
