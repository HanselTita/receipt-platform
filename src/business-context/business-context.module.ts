import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BusinessContextService } from './business-context.service';

@Module({
  imports: [PrismaModule],
  providers: [BusinessContextService],
  exports: [BusinessContextService],
})
export class BusinessContextModule {}
