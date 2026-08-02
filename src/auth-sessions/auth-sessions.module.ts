import { Module } from '@nestjs/common';

import { AuthSessionsService } from './auth-sessions.service';

@Module({
  providers: [AuthSessionsService],
  exports: [AuthSessionsService],
})
export class AuthSessionsModule {}
