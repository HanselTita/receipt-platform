import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
