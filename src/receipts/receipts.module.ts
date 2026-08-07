import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [AuthModule, CustomersModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
