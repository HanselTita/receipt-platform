import { IsEnum } from 'class-validator';

import { SubscriptionPlan } from '../../../generated/prisma/client';

export class ScheduleSubscriptionPlanChangeDto {
  @IsEnum(SubscriptionPlan)
  plan!: SubscriptionPlan;
}
