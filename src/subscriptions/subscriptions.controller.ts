import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';
import { ScheduleSubscriptionPlanChangeDto } from './dto/schedule-subscription-plan-change.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

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
}
