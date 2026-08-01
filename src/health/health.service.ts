import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      service: 'SwiftReceipt API',
      version: '1.0.0',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}
