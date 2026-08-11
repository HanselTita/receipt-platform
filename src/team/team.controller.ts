import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type';

import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { TeamService } from './team.service';

@Controller('team')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  findAll(@CurrentUser() user: AccessTokenPayload) {
    return this.teamService.findAll(user.sub);
  }

  @Post()
  addMember(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamService.addMember(user.sub, dto);
  }

  @Patch(':membershipId')
  updateMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('membershipId')
    membershipId: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamService.updateMember(user.sub, membershipId, dto);
  }
}
