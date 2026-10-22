import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { KioskDevice, StaffRole, StaffUser } from '@mdarai/database';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { KioskAuthService, type ActiveSession } from './kiosk-auth.service';
import { StaffAuthService } from './staff-auth.service';

export const DEVICE_HEADER = 'x-kiosk-device';
export const SESSION_HEADER = 'x-kiosk-session';
export const PRINT_AGENT_HEADER = 'x-print-agent-token';

interface AppRequest extends Request {
  kioskDevice?: KioskDevice;
  kioskSession?: ActiveSession;
  staffUser?: StaffUser;
}

const ALLOW_ENDED = 'kiosk:allowEnded';
/** Let a route see an already-ended session (used for idempotent order confirmation retries). */
export const AllowEndedSession = () => SetMetadata(ALLOW_ENDED, true);

@Injectable()
export class KioskDeviceGuard implements CanActivate {
  constructor(private readonly auth: KioskAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    req.kioskDevice = await this.auth.verifyDevice(req.header(DEVICE_HEADER));
    return true;
  }
}

@Injectable()
export class KioskSessionGuard implements CanActivate {
  constructor(
    private readonly auth: KioskAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const device = await this.auth.verifyDevice(req.header(DEVICE_HEADER));
    req.kioskDevice = device;
    const allowEnded = this.reflector.getAllAndOverride<boolean>(ALLOW_ENDED, [ctx.getHandler(), ctx.getClass()]) ?? false;
    req.kioskSession = await this.auth.resolveSession(req.header(SESSION_HEADER), device.id, { allowEnded });
    return true;
  }
}

const ROLES = 'staff:roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES, roles);

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const roles = this.reflector.getAllAndOverride<StaffRole[]>(ROLES, [ctx.getHandler(), ctx.getClass()]) ?? [];
    req.staffUser = await this.auth.resolve(bearer(req), roles);
    return true;
  }
}

@Injectable()
export class PrintAgentGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const given = Buffer.from(req.header(PRINT_AGENT_HEADER) ?? '');
    const expected = Buffer.from(this.cfg.PRINT_AGENT_TOKEN);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'PRINT_AGENT_UNAUTHORIZED', 'unauthorized');
    }
    return true;
  }
}

export function bearer(req: Request): string | undefined {
  const h = req.header('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}

export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().kioskDevice);
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().kioskSession);
export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().staffUser);
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().ip ?? null);
