import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { VerificationService } from './verification.service';

@Controller('verify')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get(':verificationCode')
  verifyReceipt(
    @Param('verificationCode')
    verificationCode: string,
  ) {
    return this.verificationService.verifyReceipt(verificationCode);
  }

  @Get(':verificationCode/qr')
  getQrCode(
    @Param('verificationCode')
    verificationCode: string,
  ) {
    return this.verificationService.generateQrCode(verificationCode);
  }

  @Get(':verificationCode/view')
  async viewReceipt(
    @Param('verificationCode')
    verificationCode: string,

    @Res()
    response: Response,
  ) {
    try {
      const html =
        await this.verificationService.buildVerificationPage(verificationCode);

      response.status(200).type('html').send(html);
    } catch (error) {
      if (error instanceof NotFoundException) {
        response
          .status(404)
          .type('html')
          .send(this.verificationService.buildNotFoundPage());

        return;
      }

      throw error;
    }
  }
}
