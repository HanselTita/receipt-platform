import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';
import { BusinessContextService } from '../business-context/business-context.service';

import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { SearchCustomersDto } from './dto/search-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly businessContextService: BusinessContextService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: SearchCustomersDto,
  ) {
    const business = await this.businessContextService.getCurrentBusiness(
      user.sub,
    );

    return this.customersService.search(business.id, query);
  }

  @Get('search')
  async search(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: SearchCustomersDto,
  ) {
    const business = await this.businessContextService.getCurrentBusiness(
      user.sub,
    );

    return this.customersService.search(business.id, {
      ...query,
      limit: Math.min(query.limit ?? 10, 20),
    });
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    const business = await this.businessContextService.getCurrentBusiness(
      user.sub,
    );

    return this.customersService.findOne(business.id, id);
  }

  @Post()
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateCustomerDto,
  ) {
    const business = await this.businessContextService.getCurrentBusiness(
      user.sub,
    );

    return this.customersService.create(business.id, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    const business = await this.businessContextService.getCurrentBusiness(
      user.sub,
    );

    return this.customersService.update(business.id, id, dto);
  }
}
