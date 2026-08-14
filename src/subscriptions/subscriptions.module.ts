import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PrismaModule],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
