import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  async generateReceipt(userId: string, paymentId: string): Promise<Buffer> {
    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      orderBy: {
        createdAt: 'asc',
      },

      select: {
        role: true,
        businessId: true,

        business: {
          select: {
            id: true,
            businessName: true,
            email: true,
            phone: true,
            defaultCurrency: true,
          },
        },

        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'You do not have an active business membership.',
      );
    }

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the business owner can download subscription receipts.',
      );
    }

    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: {
        id: paymentId,
        businessId: membership.businessId,
      },

      select: {
        id: true,
        reference: true,

        plan: true,
        billingPeriod: true,

        amount: true,
        currency: true,

        provider: true,
        status: true,

        providerReference: true,
        providerTransactionId: true,

        paidAt: true,
        createdAt: true,

        subscription: {
          select: {
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Subscription payment could not be found.');
    }

    if (payment.status !== 'SUCCESSFUL') {
      throw new ForbiddenException(
        'A receipt is available only for a successful subscription payment.',
      );
    }

    return this.createPdf({
      businessName: membership.business.businessName,

      businessEmail: membership.business.email,

      businessPhone: membership.business.phone,

      ownerName:
        `${membership.user.firstName} ${membership.user.lastName}`.trim(),

      ownerEmail: membership.user.email,

      reference: payment.reference,

      plan: payment.plan,

      billingPeriod: payment.billingPeriod,

      amount: payment.amount.toString(),

      currency: payment.currency,

      provider: payment.provider,

      providerReference: payment.providerReference,

      providerTransactionId: payment.providerTransactionId,

      paidAt: payment.paidAt,

      subscriptionStartsAt: payment.subscription.startsAt,

      subscriptionEndsAt: payment.subscription.endsAt,
    });
  }

  private createPdf(data: {
    businessName: string;

    businessEmail: string | null;
    businessPhone: string | null;

    ownerName: string;
    ownerEmail: string;

    reference: string;

    plan: string;
    billingPeriod: string;

    amount: string;
    currency: string;

    provider: string;

    providerReference: string | null;

    providerTransactionId: string | null;

    paidAt: Date | null;

    subscriptionStartsAt: Date;

    subscriptionEndsAt: Date | null;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        margin: 50,
      });

      const chunks: Buffer[] = [];

      document.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      document.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      document.on('error', reject);

      /*
       * --------------------------------------------------------
       * HEADER
       * --------------------------------------------------------
       */

      document.fontSize(24).font('Helvetica-Bold').text('SwiftReceipt');

      document
        .fontSize(11)
        .font('Helvetica')
        .fillColor('#64748B')
        .text('Subscription Payment Receipt');

      document.moveDown(1.5);

      document
        .strokeColor('#E2E8F0')
        .moveTo(50, document.y)
        .lineTo(545, document.y)
        .stroke();

      document.moveDown();

      /*
       * --------------------------------------------------------
       * PAID BADGE
       * --------------------------------------------------------
       */

      document
        .fillColor('#166534')
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('PAID');

      document.moveDown();

      /*
       * --------------------------------------------------------
       * RECEIPT INFO
       * --------------------------------------------------------
       */

      this.addRow(document, 'Receipt reference', data.reference);

      this.addRow(document, 'Payment date', this.formatDate(data.paidAt));

      this.addRow(document, 'Payment provider', data.provider);

      if (data.providerReference) {
        this.addRow(document, 'Provider reference', data.providerReference);
      }

      if (data.providerTransactionId) {
        this.addRow(
          document,
          'Provider transaction ID',
          data.providerTransactionId,
        );
      }

      document.moveDown();

      /*
       * --------------------------------------------------------
       * BUSINESS
       * --------------------------------------------------------
       */

      document
        .fontSize(15)
        .fillColor('#0F172A')
        .font('Helvetica-Bold')
        .text('Business');

      document.moveDown(0.5);

      this.addRow(document, 'Business name', data.businessName);

      this.addRow(document, 'Account owner', data.ownerName);

      this.addRow(document, 'Owner email', data.ownerEmail);

      if (data.businessEmail) {
        this.addRow(document, 'Business email', data.businessEmail);
      }

      if (data.businessPhone) {
        this.addRow(document, 'Business phone', data.businessPhone);
      }

      document.moveDown();

      /*
       * --------------------------------------------------------
       * SUBSCRIPTION
       * --------------------------------------------------------
       */

      document
        .fontSize(15)
        .font('Helvetica-Bold')
        .fillColor('#0F172A')
        .text('Subscription');

      document.moveDown(0.5);

      this.addRow(document, 'Plan', data.plan);

      this.addRow(
        document,
        'Billing period',
        this.formatBillingPeriod(data.billingPeriod),
      );

      this.addRow(
        document,
        'Subscription starts',
        this.formatDate(data.subscriptionStartsAt),
      );

      this.addRow(
        document,
        'Subscription ends',
        this.formatDate(data.subscriptionEndsAt),
      );

      document.moveDown();

      /*
       * --------------------------------------------------------
       * TOTAL
       * --------------------------------------------------------
       */

      document
        .strokeColor('#E2E8F0')
        .moveTo(50, document.y)
        .lineTo(545, document.y)
        .stroke();

      document.moveDown();

      document
        .fontSize(12)
        .font('Helvetica')
        .fillColor('#64748B')
        .text('Amount paid');

      document
        .fontSize(24)
        .font('Helvetica-Bold')
        .fillColor('#0F172A')
        .text(`${Number(data.amount).toLocaleString()} ${data.currency}`);

      document.moveDown(2);

      /*
       * --------------------------------------------------------
       * FOOTER
       * --------------------------------------------------------
       */

      document
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#64748B')
        .text(
          'This receipt confirms a verified SwiftReceipt subscription payment.',
        );

      document.text('Generated by SwiftReceipt - VectorUp Solutions.');

      document.text(`Generated on ${new Date().toLocaleString()}`);

      document.end();
    });
  }

  private addRow(document: PDFKit.PDFDocument, label: string, value: string) {
    const startY = document.y;

    document
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#64748B')
      .text(label, 50, startY, {
        width: 180,
      });

    document
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#0F172A')
      .text(value, 240, startY, {
        width: 305,
        align: 'right',
      });

    document.y = Math.max(document.y, startY + 20);
  }

  private formatDate(value: Date | null): string {
    if (!value) {
      return 'Not available';
    }

    return value.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',

      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatBillingPeriod(billingPeriod: string): string {
    return billingPeriod === 'ANNUAL' ? 'Annual' : 'Monthly';
  }
}
