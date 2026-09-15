import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import type { AccessTokenPayload } from '../types/access-token-payload.type';

type AuthenticatedRequest = Request & {
  user?: AccessTokenPayload;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is required.');
    }

    let payload: AccessTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException(
        'Authentication token is invalid or expired.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
      select: {
        id: true,
        isActive: true,
        memberships: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('The authenticated user is unavailable.');
    }

    const hasMembership = user.memberships.length > 0;

    const hasActiveMembership = user.memberships.some(
      (membership) => membership.status === 'ACTIVE',
    );

    if (hasMembership && !hasActiveMembership) {
      throw new UnauthorizedException(
        'Your business membership is not active.',
      );
    }

    request.user = payload;

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authorization = request.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    const [type, token] = authorization.split(' ');

    return type === 'Bearer' && token ? token : undefined;
  }
}
