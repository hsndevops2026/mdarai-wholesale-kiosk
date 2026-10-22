import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    await this.prisma.client.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}
