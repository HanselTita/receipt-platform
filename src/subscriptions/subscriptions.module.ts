import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrismaModule } from '../prisma/prisma.module';

import { SubscriptionPaymentsController } from './subscription-payments.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PrismaModule, AuthModule, PaymentsModule],

  controllers: [SubscriptionsController, SubscriptionPaymentsController],

  providers: [SubscriptionsService],

  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
