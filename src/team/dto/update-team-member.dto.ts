import { IsEnum, IsOptional } from 'class-validator';

import {
  BusinessRole,
  MembershipStatus,
} from '../../../generated/prisma/client';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsEnum(BusinessRole)
  role?: BusinessRole;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
