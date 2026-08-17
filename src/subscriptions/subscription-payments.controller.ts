import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions/payments')
export class SubscriptionPaymentsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /*
   * PayUnit server-to-server notification.
   *
   * This route intentionally does not use JwtAuthGuard.
   * We independently verify the transaction with PayUnit
   * before activating any subscription.
   */
  @Post('payunit/notify')
  @HttpCode(HttpStatus.OK)
  notifyPayUnit(@Body() payload: unknown) {
    return this.subscriptionsService.processPayUnitNotification(payload);
  }

  /*
   * PayUnit redirects the customer here after a successful
   * checkout.
   *
   * This endpoint does NOT activate the subscription.
   * Activation happens only after server-side verification.
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
   * PayUnit redirects the customer here when checkout
   * is cancelled.
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
