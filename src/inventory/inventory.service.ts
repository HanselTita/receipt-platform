import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { BusinessContextService } from '../business-context/business-context.service';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { SetOpeningStockDto } from './dto/set-opening-stock.dto';
import { RestockProductDto } from './dto/restock-product.dto';

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
    const { business } = await this.getInventoryContext(userId, true);

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
    const { business } = await this.getInventoryContext(userId, true);

    const quantity = new Prisma.Decimal(dto.quantity);

    if (!quantity.isFinite() || quantity.lte(0)) {
      throw new BadRequestException('Restock quantity must be greater than zero.');
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
}
