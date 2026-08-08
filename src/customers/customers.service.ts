import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { SearchCustomersDto } from './dto/search-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

type FindOrCreateCustomerInput = {
  businessId: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
};

type CustomerDatabaseClient = {
  customer: PrismaService['customer'];
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeOptionalText(value?: string | null): string | undefined {
    const normalized = value?.trim();

    return normalized ? normalized : undefined;
  }

  private normalizeEmail(value?: string | null): string | undefined {
    const normalized = this.normalizeOptionalText(value);

    return normalized?.toLowerCase();
  }

  async findOrCreateCustomer(
    { businessId, fullName, phone, email }: FindOrCreateCustomerInput,
    database: CustomerDatabaseClient = this.prisma,
  ) {
    const normalizedName = this.normalizeOptionalText(fullName);

    const normalizedPhone = this.normalizeOptionalText(phone);

    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedName && !normalizedPhone && !normalizedEmail) {
      return null;
    }

    let existingCustomer: Awaited<
      ReturnType<typeof database.customer.findFirst>
    > = null;

    if (normalizedPhone) {
      existingCustomer = await database.customer.findFirst({
        where: {
          businessId,
          phone: normalizedPhone,
        },
      });
    }

    if (!existingCustomer && normalizedEmail) {
      existingCustomer = await database.customer.findFirst({
        where: {
          businessId,
          email: {
            equals: normalizedEmail,
            mode: 'insensitive',
          },
        },
      });
    }

    if (!existingCustomer && normalizedName) {
      existingCustomer = await database.customer.findFirst({
        where: {
          businessId,
          fullName: {
            equals: normalizedName,
            mode: 'insensitive',
          },
        },
      });
    }

    if (existingCustomer) {
      return existingCustomer;
    }

    return database.customer.create({
      data: {
        businessId,
        fullName: normalizedName,
        phone: normalizedPhone,
        email: normalizedEmail,
      },
    });
  }

  async create(businessId: string, dto: CreateCustomerDto) {
    const fullName = this.normalizeOptionalText(dto.fullName);

    const phone = this.normalizeOptionalText(dto.phone);

    const email = this.normalizeEmail(dto.email);

    if (!fullName && !phone && !email) {
      throw new BadRequestException('Provide at least one customer detail.');
    }

    if (phone) {
      const existingByPhone = await this.prisma.customer.findFirst({
        where: {
          businessId,
          phone,
        },
      });

      if (existingByPhone) {
        throw new BadRequestException(
          'A customer with this phone number already exists.',
        );
      }
    }

    if (email) {
      const existingByEmail = await this.prisma.customer.findFirst({
        where: {
          businessId,
          email: {
            equals: email,
            mode: 'insensitive',
          },
        },
      });

      if (existingByEmail) {
        throw new BadRequestException(
          'A customer with this email address already exists.',
        );
      }
    }

    return this.prisma.customer.create({
      data: {
        businessId,
        fullName,
        phone,
        email,
      },
    });
  }

  async search(businessId: string, query: SearchCustomersDto) {
    const page = query.page;
    const limit = query.limit;

    const search = query.q?.trim();

    const where = {
      businessId,

      ...(search
        ? {
            OR: [
              {
                fullName: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                phone: {
                  contains: search,
                },
              },
              {
                email: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [customers, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: {
          updatedAt: 'desc',
        },
      }),

      this.prisma.customer.count({
        where,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      data: customers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        businessId,
      },
      include: {
        receipts: {
          orderBy: {
            issuedAt: 'desc',
          },
          take: 10,
          select: {
            id: true,
            receiptNumber: true,
            grandTotal: true,
            currency: true,
            status: true,
            paymentMethod: true,
            issuedAt: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    const aggregates = await this.prisma.receipt.aggregate({
      where: {
        businessId,
        customerId,
        status: 'ISSUED',
      },
      _count: {
        id: true,
      },
      _sum: {
        grandTotal: true,
      },
    });

    return {
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        email: customer.email,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },

      stats: {
        receiptCount: aggregates._count.id,

        totalSpent: aggregates._sum.grandTotal?.toString() ?? '0',
      },

      recentReceipts: customer.receipts,
    };
  }

  async update(businessId: string, customerId: string, dto: UpdateCustomerDto) {
    await this.findOne(businessId, customerId);

    const phone =
      dto.phone !== undefined
        ? this.normalizeOptionalText(dto.phone)
        : undefined;

    const email =
      dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;

    if (phone) {
      const existingByPhone = await this.prisma.customer.findFirst({
        where: {
          businessId,
          phone,
          NOT: {
            id: customerId,
          },
        },
      });

      if (existingByPhone) {
        throw new BadRequestException(
          'Another customer already uses this phone number.',
        );
      }
    }

    if (email) {
      const existingByEmail = await this.prisma.customer.findFirst({
        where: {
          businessId,
          email: {
            equals: email,
            mode: 'insensitive',
          },
          NOT: {
            id: customerId,
          },
        },
      });

      if (existingByEmail) {
        throw new BadRequestException(
          'Another customer already uses this email address.',
        );
      }
    }

    return this.prisma.customer.update({
      where: {
        id: customerId,
      },
      data: {
        ...(dto.fullName !== undefined
          ? {
              fullName: this.normalizeOptionalText(dto.fullName) ?? null,
            }
          : {}),

        ...(dto.phone !== undefined
          ? {
              phone: this.normalizeOptionalText(dto.phone) ?? null,
            }
          : {}),

        ...(dto.email !== undefined
          ? {
              email: this.normalizeEmail(dto.email) ?? null,
            }
          : {}),
      },
    });
  }
}
