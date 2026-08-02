import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        const expiresIn = Number(
          configService.get<string>('JWT_ACCESS_EXPIRES_IN_SECONDS', '900'),
        );

        if (!secret) {
          throw new Error('JWT_ACCESS_SECRET is not defined.');
        }

        if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
          throw new Error(
            'JWT_ACCESS_EXPIRES_IN_SECONDS must be a positive number.',
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
