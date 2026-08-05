import { Controller, Get, Param } from '@nestjs/common';

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
}
