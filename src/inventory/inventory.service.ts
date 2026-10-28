import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { BusinessContextService } from '../business-context/business-context.service';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

import { Prisma } from '../../generated/prisma/client';
import { SetOpeningStockDto } from './dto/set-opening-stock.dto';
import { RestockProductDto } from './dto/restock-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import Decimal from 'decimal.js';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessContext: BusinessContextService,
  ) {}

  private async getInventoryContext(userId: string, requireManagement = false) {
    const business = await this.businessContext.getCurrentBusiness(userId);

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

    if (requireManagement && !['OWNER', 'ADMIN', 'MANAGER'].includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to manage products.');
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId: business.id,
      },
      select: {
        plan: true,
        status: true,
        endsAt: true,
      },
    });

    const hasInventoryAccess =
      subscription !== null &&
      subscription.plan !== 'FREE' &&
      subscription.status === 'ACTIVE' &&
      (subscription.endsAt === null || subscription.endsAt > new Date());

    if (!hasInventoryAccess) {
      throw new ForbiddenException(
        'An active paid subscription is required for inventory management.',
      );
    }

    return { business, membership };
  }

  async assertInventorySubscription(businessId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        businessId,
      },
      select: {
        plan: true,
        status: true,
        endsAt: true,
      },
    });

    const hasInventoryAccess =
      subscription !== null &&
      subscription.plan !== 'FREE' &&
      subscription.status === 'ACTIVE' &&
      (subscription.endsAt === null || subscription.endsAt > new Date());

    if (!hasInventoryAccess) {
      throw new ForbiddenException(
        'An active paid subscription is required for inventory-linked receipts.',
      );
    }
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const { business } = await this.getInventoryContext(userId, true);

    const name = dto.name.trim();
    const sku = dto.sku?.trim() || null;

    if (!name) {
      throw new ForbiddenException('Product name cannot be empty.');
    }

    if (sku) {
      const existing = await this.prisma.product.findFirst({
        where: {
          businessId: business.id,
          sku,
        },
      });

      if (existing) {
        throw new ConflictException('A product with this SKU already exists.');
      }
    }

    return this.prisma.product.create({
      data: {
        businessId: business.id,
        name,
        sku,
        description: dto.description?.trim() || null,
        sellingPrice: dto.sellingPrice,
        costPrice: dto.costPrice ?? null,
        unit: dto.unit,
      },
    });
  }

  async findAllProducts(userId: string) {
    const { business } = await this.getInventoryContext(userId);

    return this.prisma.product.findMany({
      where: {
        businessId: business.id,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOneProduct(userId: string, productId: string) {
    const { business } = await this.getInventoryContext(userId);

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        businessId: business.id,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return product;
  }

  async updateProduct(userId: string, productId: string, dto: UpdateProductDto) {
    const { business } = await this.getInventoryContext(userId, true);

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        businessId: business.id,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    const sku = dto.sku !== undefined ? dto.sku.trim() || null : undefined;

    if (sku) {
      const duplicate = await this.prisma.product.findFirst({
        where: {
          businessId: business.id,
          sku,
          NOT: {
            id: productId,
          },
        },
      });

      if (duplicate) {
        throw new ConflictException('Another product already uses this SKU.');
      }
    }

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new ForbiddenException('Product name cannot be empty.');
    }

    return this.prisma.product.update({
      where: {
        id: productId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(sku !== undefined ? { sku } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.sellingPrice !== undefined ? { sellingPrice: dto.sellingPrice } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: dto.costPrice } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
      },
    });
  }

  async deactivateProduct(userId: string, productId: string) {
    const { business } = await this.getInventoryContext(userId, true);

    const result = await this.prisma.product.updateMany({
      where: {
        id: productId,
        businessId: business.id,
      },
      data: {
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Product not found.');
    }

    return {
      message: 'Product deactivated successfully.',
    };
  }

  async setOpeningStock(userId: string, dto: SetOpeningStockDto) {
    const { business, membership } = await this.getInventoryContext(userId, true);

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: dto.branchId,
        businessId: business.id,
        isActive: true,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found or inactive.');
    }

    if (membership.role !== 'OWNER') {
      const assignment = await this.prisma.businessMembership.findFirst({
        where: {
          id: membership.id,

          branchAssignments: {
            some: {
              branchId: dto.branchId,
              isActive: true,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!assignment) {
        throw new ForbiddenException('You are not assigned to this branch.');
      }
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        businessId: business.id,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or inactive.');
    }

    const quantity = new Prisma.Decimal(dto.quantity);
    const referenceStock = new Prisma.Decimal(dto.referenceStock);

    if (
      !quantity.isFinite() ||
      !referenceStock.isFinite() ||
      quantity.decimalPlaces() > 3 ||
      referenceStock.decimalPlaces() > 3
    ) {
      throw new BadRequestException(
        'Stock quantities must be finite numbers with no more than 3 decimal places.',
      );
    }

    if (quantity.isNegative() || referenceStock.isNegative()) {
      throw new BadRequestException('Stock quantities cannot be negative.');
    }

    const wholeNumberUnits = ['PIECE', 'PACK', 'BOX'];

    if (
      wholeNumberUnits.includes(product.unit) &&
      (!quantity.isInteger() || !referenceStock.isInteger())
    ) {
      throw new BadRequestException(
        `Products measured in ${product.unit} require whole-number quantities.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.branchStock.findUnique({
        where: {
          branchId_productId: {
            branchId: dto.branchId,
            productId: dto.productId,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          'Opening stock has already been recorded for this product at this branch.',
        );
      }

      const stock = await tx.branchStock.create({
        data: {
          branchId: dto.branchId,
          productId: dto.productId,
          quantity,
          referenceStock,
          lowStockPercent: 20,
        },
      });

      await tx.stockMovement.create({
        data: {
          businessId: business.id,
          branchId: dto.branchId,
          productId: dto.productId,
          userId,
          type: 'OPENING',
          quantityChange: quantity,
          quantityAfter: quantity,
          note: 'Initial opening stock',
        },
      });

      return stock;
    });
  }

  async restockProduct(userId: string, dto: RestockProductDto) {
    const { business, membership } = await this.getInventoryContext(userId, true);

    const quantity = new Prisma.Decimal(dto.quantity);

    if (!quantity.isFinite() || quantity.lte(0)) {
      throw new BadRequestException('Restock quantity must be greater than zero.');
    }

    if (quantity.decimalPlaces() > 3) {
      throw new BadRequestException('Restock quantity cannot exceed 3 decimal places.');
    }

    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: {
          id: dto.branchId,
          businessId: business.id,
          isActive: true,
        },
      });

      if (!branch) {
        throw new NotFoundException('Branch not found or inactive.');
      }

      if (membership.role !== 'OWNER') {
        const assignment = await tx.businessMembership.findFirst({
          where: {
            id: membership.id,

            branchAssignments: {
              some: {
                branchId: dto.branchId,
                isActive: true,
              },
            },
          },
          select: {
            id: true,
          },
        });

        if (!assignment) {
          throw new ForbiddenException('You are not assigned to this branch.');
        }
      }

      const product = await tx.product.findFirst({
        where: {
          id: dto.productId,
          businessId: business.id,
          isActive: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product not found or inactive.');
      }

      if (['PIECE', 'PACK', 'BOX'].includes(product.unit) && !quantity.isInteger()) {
        throw new BadRequestException(
          `Products measured in ${product.unit} require whole-number quantities.`,
        );
      }

      const stock = await tx.branchStock.findUnique({
        where: {
          branchId_productId: {
            branchId: dto.branchId,
            productId: dto.productId,
          },
        },
      });

      if (!stock) {
        throw new NotFoundException('Opening stock must be recorded before restocking.');
      }

      // Atomically increase the database quantity.
      const updatedStock = await tx.branchStock.update({
        where: {
          id: stock.id,
        },
        data: {
          quantity: {
            increment: quantity,
          },
        },
      });

      await tx.stockMovement.create({
        data: {
          businessId: business.id,
          branchId: dto.branchId,
          productId: dto.productId,
          userId,
          type: 'RESTOCK',
          quantityChange: quantity,
          quantityAfter: updatedStock.quantity,
          note: dto.note?.trim() || 'Stock replenishment',
        },
      });

      return updatedStock;
    });
  }

  async adjustStock(userId: string, dto: AdjustStockDto) {
    const { business, membership } = await this.getInventoryContext(userId, true);

    const quantityChange = new Prisma.Decimal(dto.quantityChange);
    const reason = dto.reason?.trim();

    if (
      !quantityChange.isFinite() ||
      quantityChange.isZero() ||
      quantityChange.decimalPlaces() > 3
    ) {
      throw new BadRequestException(
        'Adjustment must be a non-zero number with up to 3 decimal places.',
      );
    }

    if (!reason) {
      throw new BadRequestException('An adjustment reason is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: {
          id: dto.branchId,
          businessId: business.id,
          isActive: true,
        },
      });

      if (!branch) {
        throw new NotFoundException('Branch not found or inactive.');
      }

      if (membership.role !== 'OWNER') {
        const assignment = await tx.businessMembership.findFirst({
          where: {
            id: membership.id,
            branchAssignments: {
              some: {
                branchId: dto.branchId,
                isActive: true,
              },
            },
          },
          select: { id: true },
        });

        if (!assignment) {
          throw new ForbiddenException('You are not assigned to this branch.');
        }
      }

      const product = await tx.product.findFirst({
        where: {
          id: dto.productId,
          businessId: business.id,
          isActive: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product not found or inactive.');
      }

      if (['PIECE', 'PACK', 'BOX'].includes(product.unit) && !quantityChange.isInteger()) {
        throw new BadRequestException(
          `Products measured in ${product.unit} require whole-number adjustments.`,
        );
      }

      const stock = await tx.branchStock.findUnique({
        where: {
          branchId_productId: {
            branchId: dto.branchId,
            productId: dto.productId,
          },
        },
      });

      if (!stock) {
        throw new NotFoundException('Opening stock must be recorded before adjustments.');
      }

      // Conditional update prevents concurrent deductions
      // from producing negative inventory.
      const result = await tx.branchStock.updateMany({
        where: {
          id: stock.id,
          ...(quantityChange.isNegative()
            ? {
                quantity: {
                  gte: quantityChange.abs(),
                },
              }
            : {}),
        },
        data: {
          quantity: {
            increment: quantityChange,
          },
        },
      });

      if (result.count !== 1) {
        throw new BadRequestException('Insufficient stock for this adjustment.');
      }

      const updatedStock = await tx.branchStock.findUniqueOrThrow({
        where: { id: stock.id },
      });

      await tx.stockMovement.create({
        data: {
          businessId: business.id,
          branchId: dto.branchId,
          productId: dto.productId,
          userId,
          type: 'ADJUSTMENT',
          quantityChange,
          quantityAfter: updatedStock.quantity,
          note: reason,
        },
      });

      return updatedStock;
    });
  }

  async getBranchStock(userId: string, branchId: string) {
    const { business, membership } = await this.getInventoryContext(userId);

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        businessId: business.id,
        isActive: true,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found or inactive.');
    }

    // Owners can view all branches.
    // Other users must have an active branch assignment.
    if (membership.role !== 'OWNER') {
      const assignment = await this.prisma.branchAssignment.findFirst({
        where: {
          branchId,
          membershipId: membership.id,
          isActive: true,
        },
      });

      if (!assignment) {
        throw new ForbiddenException('You are not assigned to this branch.');
      }
    }

    const stocks = await this.prisma.branchStock.findMany({
      where: {
        branchId,
        product: {
          businessId: business.id,
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
            sellingPrice: true,
            isActive: true,
          },
        },
      },
      orderBy: {
        product: {
          name: 'asc',
        },
      },
    });

    return stocks.map((stock) => {
      const threshold = stock.referenceStock.mul(stock.lowStockPercent).div(100);

      const isLowStock = stock.quantity.lte(threshold);

      return {
        id: stock.id,
        branchId: stock.branchId,
        product: stock.product,
        quantity: stock.quantity.toString(),
        referenceStock: stock.referenceStock.toString(),
        lowStockPercent: stock.lowStockPercent,
        lowStockThreshold: threshold.toString(),
        isLowStock,
        isOutOfStock: stock.quantity.isZero(),
      };
    });
  }

  async getLowStockProducts(userId: string, branchId: string) {
    // Reuse the existing method so subscription,
    // business and branch-assignment checks are enforced.
    const stocks = await this.getBranchStock(userId, branchId);

    return stocks
      .filter((stock) => {
        // Only alert for active products with a
        // meaningful reference stock level.
        return stock.product.isActive && Number(stock.referenceStock) > 0 && stock.isLowStock;
      })
      .map((stock) => ({
        ...stock,
        stockStatus: stock.isOutOfStock ? 'OUT_OF_STOCK' : 'LOW_STOCK',
      }));
  }

  async getStockMovements(userId: string, branchId: string) {
    // Reuse the existing business, subscription,
    // and branch-assignment authorization checks.
    await this.getBranchStock(userId, branchId);

    const { business } = await this.getInventoryContext(userId);

    return this.prisma.stockMovement.findMany({
      where: {
        businessId: business.id,
        branchId,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }

  async deductStockForReceiptItem(
    tx: Prisma.TransactionClient,
    params: {
      businessId: string;
      branchId: string;
      productId: string;
      receiptItemId: string;
      userId: string;
      quantity: Decimal;
    },
  ) {
    const { businessId, branchId, productId, receiptItemId, userId, quantity } = params;

    if (!quantity.isFinite() || !quantity.isPositive() || quantity.decimalPlaces() > 3) {
      throw new BadRequestException(
        'Inventory quantity must be positive and have at most 3 decimal places.',
      );
    }

    const product = await tx.product.findFirst({
      where: {
        id: productId,
        businessId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Inventory product was not found or is inactive.');
    }

    const wholeNumberUnits = ['PIECE', 'PACK', 'BOX'];

    if (wholeNumberUnits.includes(product.unit) && !quantity.isInteger()) {
      throw new BadRequestException(`${product.unit} products require whole-number quantities.`);
    }

    // Prevent duplicate stock deduction for the same receipt item.
    const existingSale = await tx.stockMovement.findFirst({
      where: {
        receiptItemId,
        type: 'SALE',
      },
      select: { id: true },
    });

    if (existingSale) {
      throw new ConflictException('Stock has already been deducted for this receipt item.');
    }

    // Conditional atomic update prevents stock from becoming negative.
    const result = await tx.branchStock.updateMany({
      where: {
        branchId,
        productId,
        quantity: {
          gte: quantity.toFixed(3),
        },
      },
      data: {
        quantity: {
          decrement: quantity.toFixed(3),
        },
      },
    });

    if (result.count !== 1) {
      throw new ConflictException('Insufficient stock or stock record not found for this branch.');
    }

    const updatedStock = await tx.branchStock.findUniqueOrThrow({
      where: {
        branchId_productId: {
          branchId,
          productId,
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        businessId,
        branchId,
        productId,
        receiptItemId,
        userId,
        type: 'SALE',
        quantityChange: quantity.negated().toFixed(3),
        quantityAfter: updatedStock.quantity,
        note: 'Stock deducted when receipt was issued.',
      },
    });

    return updatedStock;
  }

  async reverseStockForReceiptItem(
    tx: Prisma.TransactionClient,
    params: {
      businessId: string;
      branchId: string;
      receiptItemId: string;
      userId: string;
    },
  ) {
    const { businessId, branchId, receiptItemId, userId } = params;

    const sale = await tx.stockMovement.findFirst({
      where: {
        businessId,
        branchId,
        receiptItemId,
        type: 'SALE',
      },
    });

    if (!sale) {
      return null;
    }

    const existingReversal = await tx.stockMovement.findFirst({
      where: {
        receiptItemId,
        type: 'SALE_REVERSAL',
      },
      select: {
        id: true,
      },
    });

    if (existingReversal) {
      throw new ConflictException('Stock has already been restored for this receipt item.');
    }

    const quantityToRestore = new Decimal(sale.quantityChange.toString()).abs();

    const stock = await tx.branchStock.update({
      where: {
        branchId_productId: {
          branchId,
          productId: sale.productId,
        },
      },
      data: {
        quantity: {
          increment: quantityToRestore.toFixed(3),
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        businessId,
        branchId,
        productId: sale.productId,
        receiptItemId,
        userId,
        type: 'SALE_REVERSAL',
        quantityChange: quantityToRestore.toFixed(3),
        quantityAfter: stock.quantity,
        note: 'Stock restored because the receipt was voided or corrected.',
      },
    });

    return stock;
  }
}
