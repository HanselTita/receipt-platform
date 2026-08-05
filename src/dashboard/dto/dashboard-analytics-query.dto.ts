import { IsDateString, IsEnum, IsOptional } from 'class-validator';

import { AnalyticsPeriod } from '../enums/analytics-period.enum';

export class DashboardAnalyticsQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period: AnalyticsPeriod = AnalyticsPeriod.LAST_7_DAYS;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
