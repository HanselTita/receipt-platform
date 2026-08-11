import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BusinessContextModule } from '../business-context/business-context.module';
import { PrismaModule } from '../prisma/prisma.module';

import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [PrismaModule, AuthModule, BusinessContextModule],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
