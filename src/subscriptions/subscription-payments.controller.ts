import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions/payments')
export class SubscriptionPaymentsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /*
   * ============================================================
   * PAYUNIT WEBHOOK
   * ============================================================
   *
   * Public server-to-server route.
   *
   * It does NOT trust the notification as proof of payment.
   * The transaction is independently verified with PayUnit
   * before any subscription is activated.
   */

  @Post('payunit/notify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
    },
  })
  notifyPayUnit(
    @Body()
    payload: unknown,
  ) {
    return this.subscriptionsService.processPayUnitNotification(payload);
  }
  /*
   * ============================================================
   * PAYUNIT SUCCESS REDIRECT
   * ============================================================
   *
   * This route does NOT activate a subscription.
   */

  @Get('payunit/success')
  @HttpCode(HttpStatus.OK)
  paymentSuccess() {
    return {
      status: 'success',
      message: 'Payment completed. You can return to SwiftReceipt.',
    };
  }

  /*
   * ============================================================
   * PAYUNIT CANCEL REDIRECT
   * ============================================================
   */

  @Get('payunit/cancel')
  @HttpCode(HttpStatus.OK)
  paymentCancelled() {
    return {
      status: 'cancelled',
      message: 'Payment was cancelled. You can return to SwiftReceipt.',
    };
  }
}
