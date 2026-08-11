import { IsEmail, IsEnum } from 'class-validator';

import { BusinessRole } from '../../../generated/prisma/client';

export class AddTeamMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(BusinessRole)
  role: BusinessRole;
}
