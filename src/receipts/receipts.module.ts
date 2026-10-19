import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InventoryModule } from '../inventory/inventory.module';
@Module({
  imports: [AuthModule, SubscriptionsModule, CustomersModule, InventoryModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
