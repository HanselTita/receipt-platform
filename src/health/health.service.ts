import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth() {
    return {
      status: 'ok',
      service: 'Receipt Platform API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
