import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { StaffUser } from '@mdarai/database';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../core/zod.pipe';
import { bearer, ClientIp, CurrentStaff, StaffGuard } from './guards';
import { StaffAuthService } from './staff-auth.service';

const LoginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });

@Controller('staff')
export class StaffController {
  constructor(private readonly auth: StaffAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body(new ZodPipe(LoginSchema)) b: z.infer<typeof LoginSchema>, @ClientIp() ip: string | null) {
    return this.auth.login(b.username, b.password, ip);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(StaffGuard)
  async logout(@Req() req: Request) {
    await this.auth.logout(bearer(req)!);
  }

  @Get('me')
  @UseGuards(StaffGuard)
  me(@CurrentStaff() user: StaffUser) {
    return this.auth.publicUser(user);
  }
}
