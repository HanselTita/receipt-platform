import { Injectable } from '@nestjs/common';
import type { AuthSession, Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AuthSessionCreateInput): Promise<AuthSession> {
    return this.prisma.authSession.create({
      data,
    });
  }

  findById(id: string): Promise<AuthSession | null> {
    return this.prisma.authSession.findUnique({
      where: {
        id,
      },
    });
  }

  updateRefreshToken(
    id: string,
    data: Prisma.AuthSessionUpdateInput,
  ): Promise<AuthSession> {
    return this.prisma.authSession.update({
      where: {
        id,
      },
      data,
    });
  }

  revoke(id: string): Promise<AuthSession> {
    return this.prisma.authSession.update({
      where: {
        id,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  revokeAllForUser(userId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
