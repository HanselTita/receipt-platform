import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { InventoryService } from './inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SetOpeningStockDto } from './dto/set-opening-stock.dto';
import { RestockProductDto } from './dto/restock-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // Create a new product
  @Post('products')
  createProduct(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateProductDto) {
    return this.inventoryService.createProduct(user.sub, dto);
  }

  // Get all products belonging to the current business
  @Get('products')
  findAllProducts(@CurrentUser() user: AccessTokenPayload) {
    return this.inventoryService.findAllProducts(user.sub);
  }

  // Get one product
  @Get('products/:id')
  findOneProduct(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.inventoryService.findOneProduct(user.sub, id);
  }

  // Update product details
  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.inventoryService.updateProduct(user.sub, id, dto);
  }

  // Deactivate a product without deleting its history
  @Patch('products/:id/deactivate')
  deactivateProduct(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.inventoryService.deactivateProduct(user.sub, id);
  }

  // Record initial stock for a product at a branch
  @Post('stock/opening')
  setOpeningStock(@CurrentUser() user: AccessTokenPayload, @Body() dto: SetOpeningStockDto) {
    return this.inventoryService.setOpeningStock(user.sub, dto);
  }

  // Add stock to an existing branch inventory record
  @Post('stock/restock')
  restockProduct(@CurrentUser() user: AccessTokenPayload, @Body() dto: RestockProductDto) {
    return this.inventoryService.restockProduct(user.sub, dto);
  }

  // Adjust existing stock for damage, loss, or corrections
  @Post('stock/adjust')
  adjustStock(@CurrentUser() user: AccessTokenPayload, @Body() dto: AdjustStockDto) {
    return this.inventoryService.adjustStock(user.sub, dto);
  }

  // Get inventory quantities for one branch
  @Get('stock/branch/:branchId')
  getBranchStock(@CurrentUser() user: AccessTokenPayload, @Param('branchId') branchId: string) {
    return this.inventoryService.getBranchStock(user.sub, branchId);
  }

  // Get products requiring replenishment
  @Get('stock/branch/:branchId/low-stock')
  getLowStockProducts(
    @CurrentUser() user: AccessTokenPayload,
    @Param('branchId') branchId: string,
  ) {
    return this.inventoryService.getLowStockProducts(user.sub, branchId);
  }

  // View stock movement history for a branch
  @Get('stock/branch/:branchId/movements')
  getStockMovements(@CurrentUser() user: AccessTokenPayload, @Param('branchId') branchId: string) {
    return this.inventoryService.getStockMovements(user.sub, branchId);
  }
}
