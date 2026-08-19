import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class SubscriptionReconciliationScheduler {
  private readonly logger = new Logger(
    SubscriptionReconciliationScheduler.name,
  );

  /*
   * Prevent overlapping scheduler executions.
   *
   * Example:
   *
   * Run A starts
   * Run B fires before Run A finishes
   *
   * Run B will be skipped.
   */
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
   * 1. Expire abandoned checkout attempts.
   * 2. Record PAYMENT_EXPIRED audit events.
   * 3. Find recent unresolved payments.
   * 4. Verify them directly with the payment provider.
   * 5. Activate confirmed subscriptions automatically.
   *
   * This acts as a safety net when:
   *
   * - a PayUnit webhook is delayed,
   * - a webhook is missed,
   * - the customer closes the app,
   * - the owner never manually checks the payment status.
   *
   * Important safeguards:
   *
   * - only recent unresolved payments are processed
   * - expired payments are excluded from verification
   * - each batch is limited
   * - one scheduler run happens at a time
   * - one payment failure does not stop the entire batch
   * - the shared idempotent reconciliation pipeline is reused
   */

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcilePayments(): Promise<void> {
    /*
     * ============================================================
     * PREVENT OVERLAPPING RUNS
     * ============================================================
     */

    if (this.isRunning) {
      this.logger.warn(
        'Subscription reconciliation is already running. Skipping this cycle.',
      );

      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();

      /*
       * Only reconcile unresolved payments created within
       * the last 24 hours.
       *
       * Older unresolved payments should already have expired
       * or otherwise reached a terminal state.
       */
      const recentWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      /*
       * ============================================================
       * EXPIRE ABANDONED PAYMENT ATTEMPTS
       * ============================================================
       *
       * Do not update expired payments directly here.
       *
       * The centralized expirePendingPayments() method:
       *
       * - changes the payment to CANCELLED
       * - records PAYMENT_EXPIRED
       * - protects against duplicate expiry processing
       *
       * We first find which businesses currently have expired
       * unresolved payments.
       */

      const businessesWithExpiredPayments =
        await this.prisma.subscriptionPayment.findMany({
          where: {
            status: {
              in: ['PENDING', 'PROCESSING'],
            },

            expiresAt: {
              not: null,
              lte: now,
            },
          },

          distinct: ['businessId'],

          select: {
            businessId: true,
          },
        });

      let expiredCount = 0;

      /*
       * Expire each business's stale payments using the shared
       * audited expiry method.
       */
      for (const item of businessesWithExpiredPayments) {
        try {
          const result = await this.subscriptionsService.expirePendingPayments(
            item.businessId,
          );

          expiredCount += result.expiredPayments;
        } catch (error) {
          /*
           * An expiry problem for one business must not stop
           * reconciliation for every other business.
           */
          this.logger.warn(
            `Unable to expire subscription payments for business ${item.businessId}.`,
          );

          if (error instanceof Error) {
            this.logger.debug(error.message);
          }
        }
      }

      if (expiredCount > 0) {
        this.logger.log(
          `Expired ${expiredCount} abandoned subscription checkout(s).`,
        );
      }

      /*
       * ============================================================
       * FIND RECENT UNRESOLVED PAYMENTS
       * ============================================================
       *
       * At this point expired checkouts have already been changed
       * to CANCELLED.
       *
       * We now look only for still-valid unresolved payments.
       */

      const payments = await this.prisma.subscriptionPayment.findMany({
        where: {
          status: {
            in: ['PENDING', 'PROCESSING'],
          },

          createdAt: {
            gte: recentWindowStart,
          },

          /*
           * Only verify payments whose checkout has not expired.
           */
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

        /*
         * Process oldest eligible payment first.
         */
        orderBy: {
          createdAt: 'asc',
        },

        /*
         * Keep each scheduled batch deliberately limited.
         *
         * This avoids hammering the payment provider if there
         * are many unresolved transactions.
         */
        take: 20,

        select: {
          id: true,

          reference: true,

          businessId: true,

          status: true,
        },
      });

      /*
       * Nothing needs provider verification.
       */
      if (payments.length === 0) {
        this.logger.debug(
          'No unresolved subscription payments require scheduled reconciliation.',
        );

        return;
      }

      /*
       * ============================================================
       * RECONCILIATION COUNTERS
       * ============================================================
       */

      let successful = 0;

      let unresolved = 0;

      let failed = 0;

      let cancelled = 0;

      let errors = 0;

      /*
       * ============================================================
       * VERIFY EACH PAYMENT
       * ============================================================
       */

      for (const payment of payments) {
        try {
          /*
           * Reuse the same trusted pipeline used by:
           *
           * - PayUnit webhook
           * - manual Check Payment Status
           * - foreground reconciliation
           *
           * That pipeline already performs:
           *
           * - provider verification
           * - amount verification
           * - currency verification
           * - terminal-state mapping
           * - idempotency
           * - subscription activation
           * - payment audit events
           */
          const result = await this.subscriptionsService.reconcilePaymentById(
            payment.id,
          );

          switch (result.payment.status) {
            case 'SUCCESSFUL':
              successful += 1;
              break;

            case 'FAILED':
              failed += 1;
              break;

            case 'CANCELLED':
              cancelled += 1;
              break;

            case 'PENDING':

            case 'PROCESSING':

            default:
              unresolved += 1;
              break;
          }
        } catch (error) {
          /*
           * One failing provider request must not stop the rest
           * of the scheduled batch.
           */
          errors += 1;

          this.logger.warn(
            `Scheduled reconciliation failed for payment ${payment.reference}.`,
          );

          if (error instanceof Error) {
            this.logger.debug(`Payment ${payment.reference}: ${error.message}`);
          }
        }
      }

      /*
       * ============================================================
       * SUMMARY LOG
       * ============================================================
       */

      this.logger.log(
        [
          'Subscription reconciliation completed.',
          `Checked=${payments.length}`,
          `Successful=${successful}`,
          `Unresolved=${unresolved}`,
          `Failed=${failed}`,
          `Cancelled=${cancelled}`,
          `Errors=${errors}`,
          `Expired=${expiredCount}`,
        ].join(', '),
      );
    } catch (error) {
      /*
       * Catch unexpected scheduler-wide failures.
       */
      this.logger.error('Scheduled subscription reconciliation failed.');

      if (error instanceof Error) {
        this.logger.error(error.stack ?? error.message);
      }
    } finally {
      /*
       * Always unlock the scheduler.
       */
      this.isRunning = false;
    }
  }
}
