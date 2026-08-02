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

      await transaction.businessMembership.create({
        data: {
          userId,
          businessId: business.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      return {
        message: 'Business created successfully.',
        business,
      };
    });
  }
}
