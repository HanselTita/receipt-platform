import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class SubscriptionReconciliationScheduler {
  private readonly logger = new Logger(
    SubscriptionReconciliationScheduler.name,
  );

  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /*
   * ============================================================
   * SCHEDULED SUBSCRIPTION PAYMENT RECONCILIATION
   * ============================================================
   *
   * Runs every 10 minutes.
   *
   * Purpose:
   *
   * - catch missed/delayed PayUnit webhooks
   * - reconcile unresolved payments even if the app is closed
   * - activate confirmed subscriptions automatically
   *
   * Important safeguards:
   *
   * - only unresolved payments
   * - only recent payments
   * - only non-expired payments
   * - limited batch size
   * - one scheduler run at a time
   */

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcilePayments(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Subscription reconciliation is already running. Skipping this cycle.',
      );

      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();

      const recentWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      /*
       * First expire abandoned checkout attempts globally.
       *
       * We do this directly here because the normal
       * expirePendingPayments() helper is business-scoped.
       */
      const expired = await this.prisma.subscriptionPayment.updateMany({
        where: {
          status: {
            in: ['PENDING', 'PROCESSING'],
          },

          expiresAt: {
            not: null,
            lte: now,
          },
        },

        data: {
          status: 'CANCELLED',

          failureReason: 'Checkout expired before payment was confirmed.',
        },
      });

      if (expired.count > 0) {
        this.logger.log(
          `Expired ${expired.count} abandoned subscription checkout(s).`,
        );
      }

      /*
       * Find recent unresolved payments that are still eligible
       * for provider verification.
       */
      const payments = await this.prisma.subscriptionPayment.findMany({
        where: {
          status: {
            in: ['PENDING', 'PROCESSING'],
          },

          createdAt: {
            gte: recentWindowStart,
          },

          OR: [
            {
              expiresAt: null,
            },

            {
              expiresAt: {
                gt: now,
              },
            },
          ],
        },

        orderBy: {
          createdAt: 'asc',
        },

        /*
         * Keep each scheduled run deliberately small.
         */
        take: 20,

        select: {
          id: true,
          reference: true,
        },
      });

      if (payments.length === 0) {
        this.logger.debug(
          'No unresolved subscription payments require scheduled reconciliation.',
        );

        return;
      }

      let successful = 0;
      let unresolved = 0;
      let failed = 0;

      for (const payment of payments) {
        try {
          const result = await this.subscriptionsService.reconcilePaymentById(
            payment.id,
          );

          switch (result.payment.status) {
            case 'SUCCESSFUL':
              successful += 1;
              break;

            case 'FAILED':
            case 'CANCELLED':
              failed += 1;
              break;

            default:
              unresolved += 1;
              break;
          }
        } catch (error) {
          failed += 1;

          this.logger.warn(
            `Scheduled reconciliation failed for payment ${payment.reference}.`,
          );

          if (error instanceof Error) {
            this.logger.debug(error.message);
          }
        }
      }

      this.logger.log(
        `Subscription reconciliation completed. Checked=${payments.length}, successful=${successful}, unresolved=${unresolved}, failed=${failed}.`,
      );
    } catch (error) {
      this.logger.error('Scheduled subscription reconciliation failed.');

      if (error instanceof Error) {
        this.logger.error(error.stack ?? error.message);
      }
    } finally {
      this.isRunning = false;
    }
  }
}
