import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';
import { CreateBusinessDto } from './dto/create-business.dto';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() createBusinessDto: CreateBusinessDto,
  ) {
    return this.businessesService.create(user.sub, createBusinessDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser() user: AccessTokenPayload) {
    return this.businessesService.findAllForUser(user.sub);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  getSettings(@CurrentUser() user: AccessTokenPayload) {
    return this.businessesService.getSettings(user.sub);
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  updateSettings(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateBusinessSettingsDto,
  ) {
    return this.businessesService.updateSettings(user.sub, dto);
  }
}
