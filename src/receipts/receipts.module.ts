import { Module } from '@nestjs/common';

import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
