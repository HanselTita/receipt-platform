import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { DashboardAnalyticsQueryDto } from './dto/dashboard-analytics-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@CurrentUser() user: AccessTokenPayload) {
    return this.dashboardService.getDashboard(user.sub);
  }

  @Get('analytics')
  getAnalytics(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: DashboardAnalyticsQueryDto,
  ) {
    return this.dashboardService.getAnalytics(user.sub, query);
  }
}
