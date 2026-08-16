import { IsEnum } from 'class-validator';

import {
  SubscriptionBillingPeriod,
  SubscriptionPlan,
} from '../../../generated/prisma/client';

export class CreateSubscriptionCheckoutDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @IsEnum(SubscriptionBillingPeriod)
  billingPeriod: SubscriptionBillingPeriod;
}
