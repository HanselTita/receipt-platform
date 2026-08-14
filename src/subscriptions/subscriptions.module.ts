import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PrismaModule, AuthModule],

  controllers: [SubscriptionsController],

  providers: [SubscriptionsService],

  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
