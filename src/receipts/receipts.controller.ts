import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { CreateReceiptDto } from './dto/create-receipt.dto';
import { QueryReceiptsDto } from './dto/query-receipts.dto';
import { ReceiptsService } from './receipts.service';

@Controller('receipts')
@UseGuards(JwtAuthGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: QueryReceiptsDto,
  ) {
    return this.receiptsService.findAll(user.sub, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.receiptsService.findOne(user.sub, id);
  }

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateReceiptDto,
  ) {
    return this.receiptsService.create(user.sub, dto);
  }
}
