import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /*
   * GET /subscriptions/me
   *
   * Returns:
   *
   * - current plan
   * - subscription status
   * - plan limits
   * - current usage
   * - remaining allowance
   */
  @Get('me')
  getMySubscription(@CurrentUser() user: AccessTokenPayload) {
    return this.subscriptionsService.getMySubscription(user.sub);
  }

  @Get('plans')
  getPlans(@CurrentUser() user: AccessTokenPayload) {
    return this.subscriptionsService.getPlans(user.sub);
  }

  @Post('checkout')
  createCheckout(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateSubscriptionCheckoutDto,
  ) {
    return this.subscriptionsService.createCheckout(
      user.sub,
      dto.plan,
      dto.billingPeriod,
    );
  }
}
