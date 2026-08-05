import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import QRCode from 'qrcode';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async verifyReceipt(verificationCode: string) {
    const normalizedCode = verificationCode.trim().toUpperCase();

    const receipt = await this.prisma.receipt.findUnique({
      where: {
        verificationCode: normalizedCode,
      },
      select: {
        id: true,
        receiptNumber: true,
        verificationCode: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        grandTotal: true,
        paymentMethod: true,
        status: true,
        issuedAt: true,

        business: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            logo: true,
          },
        },

        branch: {
          select: {
            id: true,
            branchName: true,
            city: true,
            stateOrProvince: true,
            country: true,
          },
        },

        createdByUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },

        _count: {
          select: {
            items: true,
          },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException(
        'No receipt was found with this verification code.',
      );
    }

    return {
      valid: true,

      receipt: {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        verificationCode: receipt.verificationCode,
        currency: receipt.currency,
        subtotal: receipt.subtotal.toString(),
        discountTotal: receipt.discountTotal.toString(),
        taxTotal: receipt.taxTotal.toString(),
        grandTotal: receipt.grandTotal.toString(),
        paymentMethod: receipt.paymentMethod,
        status: receipt.status,
        issuedAt: receipt.issuedAt,
        itemCount: receipt._count.items,

        business: receipt.business,
        branch: receipt.branch,

        issuedBy: {
          firstName: receipt.createdByUser.firstName,
          lastName: receipt.createdByUser.lastName,
        },
      },
    };
  }

  async generateQrCode(verificationCode: string) {
    const verificationUrl = this.buildVerificationUrl(verificationCode);

    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      type: 'image/png',
    });

    return {
      verificationUrl,
      qrCodeDataUrl,
    };
  }

  buildVerificationUrl(verificationCode: string): string {
    const baseUrl = this.configService.get<string>(
      'PUBLIC_VERIFICATION_BASE_URL',
    );

    if (!baseUrl) {
      throw new Error('PUBLIC_VERIFICATION_BASE_URL is not defined.');
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

    const normalizedCode = verificationCode.trim().toUpperCase();

    return `${normalizedBaseUrl}/verify/${encodeURIComponent(normalizedCode)}`;
  }
}
