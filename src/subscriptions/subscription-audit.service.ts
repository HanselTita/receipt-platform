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

@Injectable()
export class SubscriptionAuditService {
  private readonly logger = new Logger(SubscriptionAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /*
   * ============================================================
   * RECORD AUDIT EVENT
   * ============================================================
   *
   * Audit logging should never interfere with payment or
   * subscription processing.
   *
   * If audit persistence fails, we log the failure but do not
   * throw it back into the payment workflow.
   */

  async record(input: RecordSubscriptionAuditEventInput): Promise<void> {
    try {
      await this.prisma.subscriptionAuditEvent.create({
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
      this.logger.error(
        `Unable to record subscription audit event ${input.eventType}.`,
      );

      if (error instanceof Error) {
        this.logger.debug(error.message);
      }
    }
  }
}
