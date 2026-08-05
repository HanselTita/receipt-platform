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
    const receipt = await this.findReceiptByVerificationCode(verificationCode);

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

    return `${normalizedBaseUrl}/verify/${encodeURIComponent(
      normalizedCode,
    )}/view`;
  }

  /** HTML escaping helper */

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /**Formating Helper */
  private formatMoney(value: string, currency: string): string {
    const numericValue = Number(value);

    const formattedValue = Number.isFinite(numericValue)
      ? numericValue.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4,
        })
      : value;

    return `${formattedValue} ${currency}`;
  }

  /**Payment Method Format */
  private formatPaymentMethod(paymentMethod: string): string {
    return paymentMethod
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  /**Date Format */
  private formatReceiptDate(issuedAt: Date): string {
    return issuedAt.toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
  }

  /** Create a reusable public receipt query*/
  private async findReceiptByVerificationCode(verificationCode: string) {
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

    return receipt;
  }

  async buildVerificationPage(verificationCode: string): Promise<string> {
    const receipt = await this.findReceiptByVerificationCode(verificationCode);

    const businessName = this.escapeHtml(receipt.business.businessName);

    const receiptNumber = this.escapeHtml(receipt.receiptNumber);

    const safeVerificationCode = this.escapeHtml(receipt.verificationCode);

    const branchName = this.escapeHtml(receipt.branch.branchName);

    const cashierName = this.escapeHtml(
      `${receipt.createdByUser.firstName} ${receipt.createdByUser.lastName}`,
    );

    const location = [
      receipt.branch.city,
      receipt.branch.stateOrProvince,
      receipt.branch.country,
    ]
      .filter(Boolean)
      .map((value) => this.escapeHtml(String(value)))
      .join(', ');

    const formattedTotal = this.escapeHtml(
      this.formatMoney(receipt.grandTotal.toString(), receipt.currency),
    );

    const formattedSubtotal = this.escapeHtml(
      this.formatMoney(receipt.subtotal.toString(), receipt.currency),
    );

    const formattedDiscount = this.escapeHtml(
      this.formatMoney(receipt.discountTotal.toString(), receipt.currency),
    );

    const formattedTax = this.escapeHtml(
      this.formatMoney(receipt.taxTotal.toString(), receipt.currency),
    );

    const formattedPaymentMethod = this.escapeHtml(
      this.formatPaymentMethod(receipt.paymentMethod),
    );

    const formattedDate = this.escapeHtml(
      this.formatReceiptDate(receipt.issuedAt),
    );

    const status = this.escapeHtml(receipt.status);

    const isIssued = receipt.status === 'ISSUED';

    const statusTitle = isIssued ? 'Verified Receipt' : `Receipt ${status}`;

    const statusDescription = isIssued
      ? 'This receipt was found in the SwiftReceipt verification system.'
      : 'This receipt exists, but its current status requires attention.';

    const statusClass = isIssued ? 'status-issued' : 'status-warning';

    return `
    <!DOCTYPE html>

    <html lang="en">
      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <meta
          name="robots"
          content="noindex, nofollow"
        />

        <title>
          Verify ${receiptNumber} | SwiftReceipt
        </title>

        <style>
          * {
            box-sizing: border-box;
          }

          :root {
            color-scheme: light;
            font-family:
              Inter,
              Arial,
              Helvetica,
              sans-serif;
          }

          body {
            min-height: 100vh;
            margin: 0;
            color: #172033;
            background:
              linear-gradient(
                180deg,
                #eff6ff 0%,
                #f8fafc 55%,
                #ffffff 100%
              );
          }

          .page {
            width: 100%;
            max-width: 720px;
            margin: 0 auto;
            padding: 32px 18px 56px;
          }

          .brand {
            margin-bottom: 28px;
            color: #2563eb;
            font-size: 22px;
            font-weight: 800;
            text-align: center;
          }

          .verification-card {
            overflow: hidden;
            border: 1px solid #dbe4f0;
            border-radius: 24px;
            background: #ffffff;
            box-shadow:
              0 20px 50px
              rgba(15, 23, 42, 0.09);
          }

          .status-area {
            padding: 30px 24px;
            text-align: center;
          }

          .status-icon {
            display: flex;
            width: 70px;
            height: 70px;
            align-items: center;
            justify-content: center;
            margin: 0 auto 18px;
            border-radius: 999px;
            font-size: 34px;
            font-weight: 800;
          }

          .status-issued .status-icon {
            color: #166534;
            background: #dcfce7;
          }

          .status-warning .status-icon {
            color: #9a3412;
            background: #ffedd5;
          }

          .status-title {
            margin: 0;
            color: #0f172a;
            font-size: 28px;
            font-weight: 800;
          }

          .status-description {
            max-width: 480px;
            margin: 10px auto 0;
            color: #64748b;
            font-size: 15px;
            line-height: 1.6;
          }

          .business-section {
            padding: 24px;
            border-top: 1px solid #e2e8f0;
            border-bottom: 1px solid #e2e8f0;
            background: #f8fafc;
            text-align: center;
          }

          .business-name {
            margin: 0;
            color: #0f172a;
            font-size: 24px;
            font-weight: 800;
          }

          .branch-name {
            margin-top: 6px;
            color: #475569;
            font-size: 15px;
          }

          .location {
            margin-top: 5px;
            color: #94a3b8;
            font-size: 13px;
          }

          .receipt-number {
            margin-top: 18px;
            color: #2563eb;
            font-size: 20px;
            font-weight: 800;
          }

          .receipt-date {
            margin-top: 5px;
            color: #64748b;
            font-size: 13px;
          }

          .content {
            padding: 24px;
          }

          .total-card {
            margin-bottom: 22px;
            padding: 22px;
            border-radius: 18px;
            color: #ffffff;
            background:
              linear-gradient(
                135deg,
                #2563eb,
                #1d4ed8
              );
            text-align: center;
          }

          .total-label {
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 1px;
            opacity: 0.85;
            text-transform: uppercase;
          }

          .total-value {
            margin-top: 8px;
            font-size: 31px;
            font-weight: 800;
          }

          .details-grid {
            display: grid;
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .detail-card {
            min-height: 96px;
            padding: 16px;
            border: 1px solid #e2e8f0;
            border-radius: 15px;
            background: #ffffff;
          }

          .detail-label {
            color: #94a3b8;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.7px;
            text-transform: uppercase;
          }

          .detail-value {
            margin-top: 7px;
            color: #1e293b;
            font-size: 15px;
            font-weight: 700;
            overflow-wrap: anywhere;
          }

          .totals-section {
            margin-top: 22px;
            padding: 18px;
            border-radius: 16px;
            background: #f8fafc;
          }

          .totals-row {
            display: flex;
            justify-content: space-between;
            gap: 20px;
            padding: 7px 0;
          }

          .totals-label {
            color: #64748b;
          }

          .totals-value {
            color: #0f172a;
            font-weight: 700;
            text-align: right;
          }

          .verification-code-section {
            margin-top: 22px;
            padding: 18px;
            border: 1px dashed #93c5fd;
            border-radius: 16px;
            background: #eff6ff;
            text-align: center;
          }

          .verification-label {
            color: #64748b;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.8px;
            text-transform: uppercase;
          }

          .verification-code {
            margin-top: 8px;
            color: #1d4ed8;
            font-family:
              "Courier New",
              monospace;
            font-size: 14px;
            font-weight: 800;
            overflow-wrap: anywhere;
          }

          .privacy-note {
            margin-top: 22px;
            color: #64748b;
            font-size: 12px;
            line-height: 1.6;
            text-align: center;
          }

          .footer {
            margin-top: 26px;
            color: #94a3b8;
            font-size: 12px;
            text-align: center;
          }

          @media (max-width: 520px) {
            .page {
              padding-top: 18px;
            }

            .details-grid {
              grid-template-columns: 1fr;
            }

            .status-title {
              font-size: 24px;
            }

            .total-value {
              font-size: 26px;
            }
          }
        </style>
      </head>

      <body>
        <main class="page">
          <div class="brand">
            SwiftReceipt
          </div>

          <article class="verification-card">
            <section class="status-area ${statusClass}">
              <div class="status-icon">
                ${isIssued ? '✓' : '!'}
              </div>

              <h1 class="status-title">
                ${statusTitle}
              </h1>

              <p class="status-description">
                ${statusDescription}
              </p>
            </section>

            <section class="business-section">
              <h2 class="business-name">
                ${businessName}
              </h2>

              <div class="branch-name">
                ${branchName}
              </div>

              ${
                location
                  ? `
                    <div class="location">
                      ${location}
                    </div>
                  `
                  : ''
              }

              <div class="receipt-number">
                ${receiptNumber}
              </div>

              <div class="receipt-date">
                ${formattedDate}
              </div>
            </section>

            <section class="content">
              <div class="total-card">
                <div class="total-label">
                  Grand total
                </div>

                <div class="total-value">
                  ${formattedTotal}
                </div>
              </div>

              <div class="details-grid">
                <div class="detail-card">
                  <div class="detail-label">
                    Status
                  </div>

                  <div class="detail-value">
                    ${status}
                  </div>
                </div>

                <div class="detail-card">
                  <div class="detail-label">
                    Payment method
                  </div>

                  <div class="detail-value">
                    ${formattedPaymentMethod}
                  </div>
                </div>

                <div class="detail-card">
                  <div class="detail-label">
                    Number of items
                  </div>

                  <div class="detail-value">
                    ${receipt._count.items}
                  </div>
                </div>

                <div class="detail-card">
                  <div class="detail-label">
                    Issued by
                  </div>

                  <div class="detail-value">
                    ${cashierName}
                  </div>
                </div>
              </div>

              <div class="totals-section">
                <div class="totals-row">
                  <span class="totals-label">
                    Subtotal
                  </span>

                  <span class="totals-value">
                    ${formattedSubtotal}
                  </span>
                </div>

                <div class="totals-row">
                  <span class="totals-label">
                    Discount
                  </span>

                  <span class="totals-value">
                    ${formattedDiscount}
                  </span>
                </div>

                <div class="totals-row">
                  <span class="totals-label">
                    Tax
                  </span>

                  <span class="totals-value">
                    ${formattedTax}
                  </span>
                </div>
              </div>

              <div class="verification-code-section">
                <div class="verification-label">
                  Verification code
                </div>

                <div class="verification-code">
                  ${safeVerificationCode}
                </div>
              </div>

              <p class="privacy-note">
                Customer names, phone numbers, email addresses,
                item descriptions and private notes are intentionally
                hidden from this public verification page.
              </p>
            </section>
          </article>

          <footer class="footer">
            Receipt authenticity provided by SwiftReceipt.
          </footer>
        </main>
      </body>
    </html>
  `;
  }

  buildNotFoundPage(): string {
    return `
    <!DOCTYPE html>

    <html lang="en">
      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <meta
          name="robots"
          content="noindex, nofollow"
        />

        <title>
          Receipt Not Found | SwiftReceipt
        </title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            display: flex;
            min-height: 100vh;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
            color: #172033;
            background:
              linear-gradient(
                180deg,
                #fff7ed,
                #ffffff
              );
            font-family:
              Inter,
              Arial,
              Helvetica,
              sans-serif;
          }

          .card {
            width: 100%;
            max-width: 520px;
            padding: 36px 28px;
            border: 1px solid #fed7aa;
            border-radius: 24px;
            background: #ffffff;
            box-shadow:
              0 20px 50px
              rgba(15, 23, 42, 0.08);
            text-align: center;
          }

          .icon {
            display: flex;
            width: 72px;
            height: 72px;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            border-radius: 999px;
            color: #9a3412;
            background: #ffedd5;
            font-size: 34px;
            font-weight: 800;
          }

          h1 {
            margin: 0;
            color: #0f172a;
            font-size: 28px;
          }

          p {
            margin: 14px 0 0;
            color: #64748b;
            font-size: 15px;
            line-height: 1.7;
          }

          .brand {
            margin-top: 28px;
            color: #2563eb;
            font-weight: 800;
          }
        </style>
      </head>

      <body>
        <main class="card">
          <div class="icon">
            !
          </div>

          <h1>
            Receipt not found
          </h1>

          <p>
            SwiftReceipt could not find a receipt matching this
            verification code. Confirm that the complete code was
            used, or contact the business that issued the receipt.
          </p>

          <div class="brand">
            SwiftReceipt
          </div>
        </main>
      </body>
    </html>
  `;
  }
}
