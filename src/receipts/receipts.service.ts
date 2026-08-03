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

    return this.prisma.$transaction(async (transaction) => {
      const business = await transaction.business.findUnique({
        where: {
          id: dto.businessId,
        },
        select: {
          id: true,
          defaultCurrency: true,
        },
      });

      if (!business) {
        throw new NotFoundException('Business was not found.');
      }

      const branch = await transaction.branch.findFirst({
        where: {
          id: dto.branchId,
          businessId: dto.businessId,
        },
        select: {
          id: true,
          businessId: true,
        },
      });

      if (!branch) {
        throw new NotFoundException('Branch was not found.');
      }

      // TODO: continue receipt creation logic here.
    });
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

  private formatReceiptNumber(prefix: string, sequence: number): string {
    return `${prefix}-${String(sequence).padStart(6, '0')}`;
  }

  private generateVerificationCode(): string {
    return randomBytes(16).toString('hex').toUpperCase();
  }

  private async getBusinessCurrency(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    businessId: string,
  ): Promise<string> {
    const business = await transaction.business.findUnique({
      where: {
        id: businessId,
      },
      select: {
        id: true,
        defaultCurrency: true,
      },
    });

    if (!business) {
      throw new NotFoundException('Business was not found.');
    }
    return business.defaultCurrency;
  }
}
