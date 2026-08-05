import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { CreateReceiptDto } from './dto/create-receipt.dto';
import { ReceiptItemDto } from './dto/receipt-item.dto';
import { QueryReceiptsDto } from './dto/query-receipts.dto';

type CalculatedItem = {
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  discountAmount: Decimal;
  taxRate: Decimal;
  taxAmount: Decimal;
  lineSubtotal: Decimal;
  lineTotal: Decimal;
};

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateReceiptDto) {
    /*
     * Calculate all item and receipt totals before opening the
     * database transaction.
     *
     * The client is not trusted to calculate financial totals.
     */
    const calculatedItems = dto.items.map((item, index) =>
      this.calculateItem(item, index),
    );

    const subtotal = calculatedItems.reduce(
      (total, item) => total.plus(item.lineSubtotal),
      new Decimal(0),
    );

    const discountTotal = calculatedItems.reduce(
      (total, item) => total.plus(item.discountAmount),
      new Decimal(0),
    );

    const taxTotal = calculatedItems.reduce(
      (total, item) => total.plus(item.taxAmount),
      new Decimal(0),
    );

    const grandTotal = calculatedItems.reduce(
      (total, item) => total.plus(item.lineTotal),
      new Decimal(0),
    );

    return this.prisma.$transaction(
      async (transaction) => {
        /*
         * 1. Verify that the business exists and retrieve its currency.
         */
        const business = await transaction.business.findUnique({
          where: {
            id: dto.businessId,
          },
          select: {
            id: true,
            businessName: true,
            defaultCurrency: true,
          },
        });

        if (!business) {
          throw new NotFoundException('Business was not found.');
        }

        /*
         * 2. Verify that the selected branch belongs to that business.
         */
        const branch = await transaction.branch.findFirst({
          where: {
            id: dto.branchId,
            businessId: business.id,
          },
          select: {
            id: true,
            branchName: true,
            receiptPrefix: true,
            nextReceiptNumber: true,
            businessId: true,
          },
        });

        if (!branch) {
          throw new NotFoundException(
            'The selected branch does not belong to this business.',
          );
        }

        /*
         * 3. Verify that the authenticated user has:
         *
         * - an ACTIVE membership in the business, and
         * - an ACTIVE assignment to the selected branch.
         */
        const membership = await transaction.businessMembership.findFirst({
          where: {
            userId,
            businessId: business.id,
            status: 'ACTIVE',
            branchAssignments: {
              some: {
                branchId: branch.id,
                isActive: true,
              },
            },
          },
          select: {
            id: true,
            role: true,
            status: true,
          },
        });

        if (!membership) {
          throw new ForbiddenException(
            'You do not have permission to create receipts for this branch.',
          );
        }

        /*
         * 4. Atomically increment the branch counter.
         *
         * Example:
         * Existing nextReceiptNumber = 1
         * Updated nextReceiptNumber  = 2
         * This receipt uses sequence = 1
         */
        const updatedBranch = await transaction.branch.update({
          where: {
            id: branch.id,
          },
          data: {
            nextReceiptNumber: {
              increment: 1,
            },
          },
          select: {
            id: true,
            branchName: true,
            receiptPrefix: true,
            nextReceiptNumber: true,
          },
        });

        const issuedSequence = updatedBranch.nextReceiptNumber - 1;

        const receiptNumber = this.formatReceiptNumber(
          updatedBranch.receiptPrefix,
          issuedSequence,
        );

        /*
         * 5. Generate a unique public verification code.
         */
        const verificationCode = this.generateVerificationCode();

        /*
         * 6. Create the receipt and all ReceiptItem rows together.
         */
        const receipt = await transaction.receipt.create({
          data: {
            receiptNumber,
            verificationCode,

            customerName: dto.customerName?.trim() || null,

            customerPhone: dto.customerPhone?.trim() || null,

            customerEmail: dto.customerEmail?.trim().toLowerCase() || null,

            currency: business.defaultCurrency,

            subtotal: subtotal.toFixed(4),
            discountTotal: discountTotal.toFixed(4),
            taxTotal: taxTotal.toFixed(4),
            grandTotal: grandTotal.toFixed(4),

            paymentMethod: dto.paymentMethod,
            notes: dto.notes?.trim() || null,

            businessId: business.id,
            branchId: branch.id,
            createdByUserId: userId,

            items: {
              create: calculatedItems.map((item) => ({
                description: item.description,
                quantity: item.quantity.toFixed(4),
                unitPrice: item.unitPrice.toFixed(4),
                discountAmount: item.discountAmount.toFixed(4),
                taxRate: item.taxRate.toFixed(4),
                taxAmount: item.taxAmount.toFixed(4),
                lineSubtotal: item.lineSubtotal.toFixed(4),
                lineTotal: item.lineTotal.toFixed(4),
              })),
            },
          },

          /*
           * Return everything needed to display the completed receipt.
           */
          include: {
            items: {
              orderBy: {
                createdAt: 'asc',
              },
            },

            business: {
              select: {
                id: true,
                businessName: true,
                businessType: true,
                defaultCurrency: true,
                logo: true,
                email: true,
                phone: true,
              },
            },

            branch: {
              select: {
                id: true,
                branchName: true,
                address: true,
                city: true,
                stateOrProvince: true,
                country: true,
                phone: true,
                receiptPrefix: true,
                isMainBranch: true,
              },
            },

            createdByUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        });

        /*
         * 7. Returning this object completes the HTTP request.
         */
        return {
          message: 'Receipt created successfully.',
          receipt,
        };
      },
      {
        maxWait: 10_000,
        timeout: 20_000,
      },
    );
  }
  async findAll(userId: string, query: QueryReceiptsDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const assignments = await this.prisma.branchAssignment.findMany({
      where: {
        isActive: true,
        membership: {
          userId,
          status: 'ACTIVE',
        },
      },
      select: {
        branchId: true,
        membership: {
          select: {
            businessId: true,
          },
        },
      },
    });

    const branchIds = assignments.map((assignment) => assignment.branchId);

    const businessIds = [
      ...new Set(
        assignments.map((assignment) => assignment.membership.businessId),
      ),
    ];

    if (branchIds.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    const issuedAtFilter = this.buildIssuedAtFilter(
      query.dateFrom,
      query.dateTo,
    );

    const minAmount =
      query.minAmount !== undefined ? new Decimal(query.minAmount) : undefined;

    const maxAmount =
      query.maxAmount !== undefined ? new Decimal(query.maxAmount) : undefined;

    if (minAmount && minAmount.isNegative()) {
      throw new BadRequestException('Minimum amount cannot be negative.');
    }

    if (maxAmount && maxAmount.isNegative()) {
      throw new BadRequestException('Maximum amount cannot be negative.');
    }

    if (minAmount && maxAmount && minAmount.greaterThan(maxAmount)) {
      throw new BadRequestException(
        'Minimum amount cannot be greater than maximum amount.',
      );
    }

    const search = query.search?.trim();

    const where = {
      branchId: {
        in: branchIds,
      },

      businessId: {
        in: businessIds,
      },

      ...(search
        ? {
            OR: [
              {
                receiptNumber: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                customerName: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                customerPhone: {
                  contains: search,
                },
              },
            ],
          }
        : {}),

      ...(query.status
        ? {
            status: query.status,
          }
        : {}),

      ...(issuedAtFilter
        ? {
            issuedAt: issuedAtFilter,
          }
        : {}),

      ...(query.paymentMethod
        ? {
            paymentMethod: query.paymentMethod,
          }
        : {}),

      ...(minAmount || maxAmount
        ? {
            grandTotal: {
              ...(minAmount
                ? {
                    gte: minAmount.toFixed(4),
                  }
                : {}),

              ...(maxAmount
                ? {
                    lte: maxAmount.toFixed(4),
                  }
                : {}),
            },
          }
        : {}),
    };

    const [receipts, total] = await this.prisma.$transaction([
      this.prisma.receipt.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          issuedAt: 'desc',
        },
        select: {
          id: true,
          receiptNumber: true,
          verificationCode: true,
          customerName: true,
          customerPhone: true,
          currency: true,
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          grandTotal: true,
          paymentMethod: true,
          status: true,
          issuedAt: true,

          business: {
            select: {
              id: true,
              businessName: true,
            },
          },

          branch: {
            select: {
              id: true,
              branchName: true,
            },
          },

          createdByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },

          _count: {
            select: {
              items: true,
            },
          },
        },
      }),

      this.prisma.receipt.count({
        where,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      data: receipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        verificationCode: receipt.verificationCode,
        customerName: receipt.customerName,
        customerPhone: receipt.customerPhone,
        currency: receipt.currency,
        subtotal: receipt.subtotal,
        discountTotal: receipt.discountTotal,
        taxTotal: receipt.taxTotal,
        grandTotal: receipt.grandTotal,
        paymentMethod: receipt.paymentMethod,
        status: receipt.status,
        issuedAt: receipt.issuedAt,
        itemCount: receipt._count.items,
        business: receipt.business,
        branch: receipt.branch,
        createdBy: receipt.createdByUser,
      })),

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

  async findOne(userId: string, receiptId: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: {
        id: receiptId,
      },
      include: {
        items: {
          orderBy: {
            createdAt: 'asc',
          },
        },

        business: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            defaultCurrency: true,
            logo: true,
            email: true,
            phone: true,
            taxEnabled: true,
            taxRate: true,
          },
        },

        branch: {
          select: {
            id: true,
            branchName: true,
            address: true,
            city: true,
            stateOrProvince: true,
            country: true,
            phone: true,
            receiptPrefix: true,
            isMainBranch: true,
          },
        },

        createdByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException('Receipt was not found.');
    }

    const assignment = await this.prisma.branchAssignment.findFirst({
      where: {
        branchId: receipt.branchId,
        isActive: true,

        membership: {
          userId,
          businessId: receipt.businessId,
          status: 'ACTIVE',
        },
      },
      select: {
        id: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        'Receipt was not found or you do not have access to it.',
      );
    }

    return {
      receipt,
    };
  }

  private calculateItem(item: ReceiptItemDto, index: number): CalculatedItem {
    const description = item.description.trim();

    if (!description) {
      throw new BadRequestException(
        `Item ${index + 1} must have a description.`,
      );
    }

    const quantity = new Decimal(item.quantity);
    const unitPrice = new Decimal(item.unitPrice);
    const discountAmount = new Decimal(item.discountAmount ?? 0);
    const taxRate = new Decimal(item.taxRate ?? 0);

    const lineSubtotal = quantity.times(unitPrice).toDecimalPlaces(4);

    if (discountAmount.greaterThan(lineSubtotal)) {
      throw new BadRequestException(
        `Item ${index + 1} discount cannot exceed its subtotal.`,
      );
    }

    const taxableAmount = lineSubtotal.minus(discountAmount);

    const taxAmount = taxableAmount
      .times(taxRate)
      .dividedBy(100)
      .toDecimalPlaces(4);

    const lineTotal = taxableAmount.plus(taxAmount).toDecimalPlaces(4);

    return {
      description,
      quantity,
      unitPrice,
      discountAmount,
      taxRate,
      taxAmount,
      lineSubtotal,
      lineTotal,
    };
  }

  private buildIssuedAtFilter(
    dateFrom?: string,
    dateTo?: string,
  ):
    | {
        gte?: Date;
        lte?: Date;
      }
    | undefined {
    if (!dateFrom && !dateTo) {
      return undefined;
    }

    const filter: {
      gte?: Date;
      lte?: Date;
    } = {};

    if (dateFrom) {
      const startDate = new Date(dateFrom);

      startDate.setUTCHours(0, 0, 0, 0);

      filter.gte = startDate;
    }

    if (dateTo) {
      const endDate = new Date(dateTo);

      endDate.setUTCHours(23, 59, 59, 999);

      filter.lte = endDate;
    }

    return filter;
  }
  private formatReceiptNumber(prefix: string, sequence: number): string {
    return `${prefix}-${String(sequence).padStart(6, '0')}`;
  }

  private generateVerificationCode(): string {
    return randomBytes(16).toString('hex').toUpperCase();
  }
}
