import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BusinessesModule } from './businesses/businesses.module';
import { HealthModule } from './health/health.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { VerificationModule } from './verification/verification.module';
import { CustomersModule } from './customers/customers.module';
import { BusinessContextModule } from './business-context/business-context.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    PrismaModule,
    AuthModule,
    UsersModule,
    BusinessesModule,
    HealthModule,
    DashboardModule,
    ReceiptsModule,
    VerificationModule,
    CustomersModule,
    BusinessContextModule,
  ],
})
export class AppModule {}
