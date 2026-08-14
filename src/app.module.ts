import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
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

import { BranchesModule } from './branches/branches.module';
import { TeamModule } from './team/team.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
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
    BranchesModule,
    TeamModule,
  ],
})
export class AppModule {}
