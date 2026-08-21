import { Injectable, Logger } from '@nestjs/common';

import type {
  Prisma,
  SubscriptionAuditEventType,
} from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type RecordSubscriptionAuditEventInput = {
  eventType: SubscriptionAuditEventType;

  businessId: string;

  message: string;

  metadata?: Prisma.InputJsonValue;

  subscriptionId?: string | null;

  paymentId?: string | null;

  actorUserId?: string | null;
};

type AuditDatabaseClient = Pick<
  Prisma.TransactionClient,
  'subscriptionAuditEvent'
>;

@Injectable()
export class SubscriptionAuditService {
  private readonly logger = new Logger(SubscriptionAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /*
   * ============================================================
   * RECORD AUDIT EVENT
   * ============================================================
   *
   * When transactionClient is supplied, the audit event becomes
   * part of the caller's existing database transaction.
   *
   * Without transactionClient, audit persistence remains
   * best-effort and must not interrupt ordinary workflows.
   */

  async record(
    input: RecordSubscriptionAuditEventInput,
    transactionClient?: AuditDatabaseClient,
  ): Promise<void> {
    const database = transactionClient ?? this.prisma;

    try {
      await database.subscriptionAuditEvent.create({
        data: {
          eventType: input.eventType,

          businessId: input.businessId,

          message: input.message,

          metadata: input.metadata,

          subscriptionId: input.subscriptionId ?? null,

          paymentId: input.paymentId ?? null,

          actorUserId: input.actorUserId ?? null,
        },
      });
    } catch (error) {
      /*
       * When operating inside a transaction, rethrow.
       *
       * This ensures payment/subscription state cannot commit
       * while the corresponding mandatory lifecycle audit is lost.
       */
      if (transactionClient) {
        throw error;
      }

      /*
       * Outside a transaction, preserve our existing best-effort
       * logging behavior.
       */
      this.logger.error(
        `Unable to record subscription audit event ${input.eventType}.`,
      );

      if (error instanceof Error) {
        this.logger.debug(error.message);
      }
    }
  }
}
