import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { BusinessContextModule } from '../business-context/business-context.module';

@Module({
  imports: [PrismaModule, AuthModule, BusinessContextModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
