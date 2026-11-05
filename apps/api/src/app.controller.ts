import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  async health() {
    const trades = await this.prisma.trade.count();
    return {
      ok: true,
      service: 'trading-review-api',
      version: '0.1.0',
      trades,
      now: new Date().toISOString(),
    };
  }
}
