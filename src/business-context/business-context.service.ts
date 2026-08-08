import { ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentBusiness(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        business: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!membership) {
      throw new ForbiddenException('No active business membership found.');
    }

    return membership.business;
  }
}
