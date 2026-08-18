import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';
import { ScheduleSubscriptionPlanChangeDto } from './dto/schedule-subscription-plan-change.dto';
import { SubscriptionsService } from './subscriptions.service';

import { SubscriptionReceiptService } from './subscription-receipt.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,

    private readonly subscriptionReceiptService: SubscriptionReceiptService,
  ) {}

  /*
   * ============================================================
   * CURRENT SUBSCRIPTION
   * ============================================================
   *
   * GET /subscriptions/me
   *
   * Returns:
   * - current plan
   * - subscription status
   * - scheduled plan change
   * - plan limits
   * - current usage
   * - remaining allowance
   */

  @Get('me')
  getMySubscription(
    @CurrentUser()
    user: AccessTokenPayload,
  ) {
    return this.subscriptionsService.getMySubscription(user.sub);
  }

  /*
   * ============================================================
   * AVAILABLE PLANS
   * ============================================================
   *
   * GET /subscriptions/plans
   */

  @Get('plans')
  getPlans(
    @CurrentUser()
    user: AccessTokenPayload,
  ) {
    return this.subscriptionsService.getPlans(user.sub);
  }

  /*
   * ============================================================
   * PAYMENT HISTORY
   * ============================================================
   *
   * GET /subscriptions/payments
   *
   * Returns subscription payment attempts for the
   * authenticated business owner, newest first.
   */

  @Get('payments')
  getPaymentHistory(
    @CurrentUser()
    user: AccessTokenPayload,
  ) {
    return this.subscriptionsService.getPaymentHistory(user.sub);
  }

  /*
   * ============================================================
   * PAYMENT DETAILS
   * ============================================================
   *
   * GET /subscriptions/payments/:id
   *
   * Returns one subscription payment belonging to the
   * authenticated business owner.
   */

  @Get('payments/:id')
  getPaymentDetails(
    @CurrentUser()
    user: AccessTokenPayload,

    @Param('id')
    paymentId: string,
  ) {
    return this.subscriptionsService.getPaymentDetails(user.sub, paymentId);
  }

  /*
   * ============================================================
   * SUBSCRIPTION PAYMENT RECEIPT
   * ============================================================
   *
   * GET /subscriptions/payments/:id/receipt
   *
   * Returns a PDF only for a verified successful payment.
   */

  @Get('payments/:id/receipt')
  async getPaymentReceipt(
    @CurrentUser()
    user: AccessTokenPayload,

    @Param('id')
    paymentId: string,

    @Res()
    response: Response,
  ) {
    const pdf = await this.subscriptionReceiptService.generateReceipt(
      user.sub,
      paymentId,
    );

    response.set({
      'Content-Type': 'application/pdf',

      'Content-Disposition': `attachment; filename="swiftreceipt-subscription-${paymentId}.pdf"`,

      'Content-Length': pdf.length,
    });

    response.end(pdf);
  }

  /*
   * ============================================================
   * PAID CHECKOUT
   * ============================================================
   *
   * POST /subscriptions/checkout
   *
   * Used for paid upgrades and future paid renewals.
   */

  @Post('checkout')
  createCheckout(
    @CurrentUser()
    user: AccessTokenPayload,

    @Body()
    dto: CreateSubscriptionCheckoutDto,
  ) {
    return this.subscriptionsService.createCheckout(
      user.sub,
      dto.plan,
      dto.billingPeriod,
    );
  }

  /*
   * ============================================================
   * SCHEDULE DOWNGRADE / CANCELLATION
   * ============================================================
   *
   * POST /subscriptions/schedule-change
   *
   * Examples:
   *
   * BUSINESS → STARTER
   * PRO      → BUSINESS
   * STARTER  → FREE
   *
   * The current paid plan remains active until its endsAt date.
   */

  @Post('schedule-change')
  schedulePlanChange(
    @CurrentUser()
    user: AccessTokenPayload,

    @Body()
    dto: ScheduleSubscriptionPlanChangeDto,
  ) {
    return this.subscriptionsService.schedulePlanChange(user.sub, dto.plan);
  }

  /*
   * ============================================================
   * KEEP CURRENT PLAN
   * ============================================================
   *
   * POST /subscriptions/cancel-scheduled-change
   *
   * Removes a previously scheduled downgrade/cancellation.
   */

  @Post('cancel-scheduled-change')
  cancelScheduledPlanChange(
    @CurrentUser()
    user: AccessTokenPayload,
  ) {
    return this.subscriptionsService.cancelScheduledPlanChange(user.sub);
  }

  /*
   * ============================================================
   * MANUAL PAYMENT VERIFICATION
   * ============================================================
   *
   * POST /subscriptions/payments/:id/verify
   *
   * Reconciles a pending/processing subscription payment
   * directly with its payment provider.
   */

  @Post('payments/:id/verify')
  verifySubscriptionPayment(
    @CurrentUser()
    user: AccessTokenPayload,

    @Param('id')
    paymentId: string,
  ) {
    return this.subscriptionsService.verifySubscriptionPayment(
      user.sub,
      paymentId,
    );
  }

  /*
   * ============================================================
   * RETRY SUBSCRIPTION PAYMENT
   * ============================================================
   *
   * POST /subscriptions/payments/:id/retry
   */

  @Post('payments/:id/retry')
  retrySubscriptionPayment(
    @CurrentUser()
    user: AccessTokenPayload,

    @Param('id')
    paymentId: string,
  ) {
    return this.subscriptionsService.retrySubscriptionPayment(
      user.sub,
      paymentId,
    );
  }

  /*
   * ============================================================
   * FOREGROUND PAYMENT RECONCILIATION
   * ============================================================
   *
   * POST /subscriptions/payments/reconcile
   */

  @Post('payments/reconcile')
  reconcileSubscriptionPayments(
    @CurrentUser()
    user: AccessTokenPayload,
  ) {
    return this.subscriptionsService.reconcileRecentSubscriptionPayments(
      user.sub,
    );
  }
}
