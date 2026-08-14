import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';
import { CreateBusinessDto } from './dto/create-business.dto';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

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

  @Post('settings/logo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'logos'),

        filename: (_request, file, callback) => {
          const extension = extname(file.originalname).toLowerCase();

          callback(null, `${randomUUID()}${extension}`);
        },
      }),

      limits: {
        fileSize: 2 * 1024 * 1024,
      },

      fileFilter: (_request, file, callback) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (!allowedMimeTypes.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              'Only JPG, PNG, and WebP logo images are allowed.',
            ),
            false,
          );

          return;
        }

        callback(null, true);
      },
    }),
  )
  uploadLogo(
    @CurrentUser()
    user: AccessTokenPayload,

    @UploadedFile()
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A logo image is required.');
    }

    const logoPath = `/uploads/logos/${file.filename}`;

    return this.businessesService.updateLogo(user.sub, logoPath);
  }

  @Delete('settings/logo')
  @UseGuards(JwtAuthGuard)
  removeLogo(
    @CurrentUser()
    user: AccessTokenPayload,
  ) {
    return this.businessesService.removeLogo(user.sub);
  }
}
