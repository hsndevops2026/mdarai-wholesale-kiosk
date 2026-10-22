import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hashNationalId, hashToken, newToken, type Customer, type KioskDevice, type KioskSession } from '@mdarai/database';
import { isValidIsraeliId } from '@mdarai/shared-types';
import { AuditService } from '../core/audit.service';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { PrismaService, type Tx } from '../core/prisma.service';

export type ActiveSession = KioskSession & { customer: Customer };

const FAILED_WINDOW_MS = 10 * 60 * 1000;
const TOUCH_THROTTLE_MS = 10 * 1000;

@Injectable()
export class KioskAuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('KioskAuth');
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch((err) => this.logger.error(`session cleanup failed: ${(err as Error).message}`));
    }, 30_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async verifyDevice(token: string | undefined): Promise<KioskDevice> {
    if (!token) throw new AppError(HttpStatus.UNAUTHORIZED, 'DEVICE_REQUIRED', 'هذا الجهاز غير مسجّل ككشك');
    const device = await this.prisma.client.kioskDevice.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!device || !device.active) throw new AppError(HttpStatus.UNAUTHORIZED, 'DEVICE_INVALID', 'هذا الجهاز غير مسجّل ككشك');
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
      await this.prisma.client.kioskDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }
    return device;
  }

  /**
   * DEMO-ONLY identification by national ID. See docs/architecture/security-review.md:
   * an ID number is not a secret and must be combined with a second factor before production.
   */
  async identify(device: KioskDevice, nationalId: string, ip: string | null) {
    const since = new Date(Date.now() - FAILED_WINDOW_MS);
    const failures = await this.prisma.client.auditLog.count({
      where: { action: 'kiosk.identify.failed', actorId: device.id, createdAt: { gte: since } },
    });
    if (failures >= this.cfg.KIOSK_MAX_FAILED_IDENTIFY) {
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_ATTEMPTS', 'محاولات كثيرة. الرجاء التوجّه للموظف أو المحاولة بعد عشر دقائق');
    }
    const fail = async (reason: string) => {
      await this.audit.log({ actorType: 'KIOSK', actorId: device.id, action: 'kiosk.identify.failed', metadata: { reason }, ip });
      return new AppError(HttpStatus.UNAUTHORIZED, 'CUSTOMER_NOT_FOUND', 'لم نجد حساباً بهذا الرقم. تأكد من الرقم أو توجّه للموظف');
    };
    if (!isValidIsraeliId(nationalId)) throw await fail('invalid_format');
    const customer = await this.prisma.client.customer.findUnique({
      where: { nationalIdHash: hashNationalId(nationalId, this.cfg.ID_HASH_PEPPER) },
    });
    if (!customer || !customer.active) throw await fail(customer ? 'inactive' : 'not_found');

    const token = newToken();
    const now = new Date();
    const session = await this.prisma.client.$transaction(async (tx) => {
      // One shared tablet = one active customer at a time.
      const open = await tx.kioskSession.findMany({ where: { deviceId: device.id, endedAt: null }, select: { id: true } });
      for (const s of open) await this.endSession(s.id, 'replaced', tx);
      const created = await tx.kioskSession.create({
        data: {
          tokenHash: hashToken(token),
          customerId: customer.id,
          deviceId: device.id,
          lastActivityAt: now,
          expiresAt: new Date(now.getTime() + this.cfg.KIOSK_MAX_SESSION_SECONDS * 1000),
        },
      });
      await this.audit.log({ actorType: 'CUSTOMER', actorId: customer.id, action: 'kiosk.session.started', entityType: 'KioskSession', entityId: created.id, ip }, tx);
      return created;
    });
    return { token, session, customer };
  }

  isExpired(s: Pick<KioskSession, 'lastActivityAt' | 'expiresAt' | 'endedAt'>, now = Date.now()): boolean {
    return !!s.endedAt || s.expiresAt.getTime() <= now || s.lastActivityAt.getTime() + this.cfg.KIOSK_IDLE_TIMEOUT_SECONDS * 1000 <= now;
  }

  /** Resolve a session token. Expired sessions are ended (and their cart cleared) on the spot. */
  async resolveSession(token: string | undefined, deviceId: string, opts: { allowEnded?: boolean } = {}): Promise<ActiveSession> {
    if (!token) throw new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_REQUIRED', 'الرجاء إدخال رقم الهوية');
    const session = await this.prisma.client.kioskSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { customer: true } });
    if (!session || session.deviceId !== deviceId) throw new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_INVALID', 'انتهت الجلسة');
    if (this.isExpired(session)) {
      const alreadyEnded = !!session.endedAt;
      if (!alreadyEnded) await this.prisma.client.$transaction((tx) => this.endSession(session.id, 'timeout', tx));
      if (opts.allowEnded) return session;
      if (alreadyEnded) throw new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_ENDED', 'انتهت الجلسة');
      throw new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'انتهت الجلسة بسبب عدم النشاط');
    }
    if (Date.now() - session.lastActivityAt.getTime() > TOUCH_THROTTLE_MS) {
      session.lastActivityAt = new Date();
      await this.prisma.client.kioskSession.update({ where: { id: session.id }, data: { lastActivityAt: session.lastActivityAt } });
    }
    return session;
  }

  /** End a session and wipe everything customer-specific attached to it. */
  async endSession(sessionId: string, reason: string, tx: Tx): Promise<void> {
    const r = await tx.kioskSession.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: new Date(), endReason: reason, lastSpokenProduct: null } });
    await tx.cartItem.deleteMany({ where: { sessionId } });
    await tx.clarification.deleteMany({ where: { sessionId } });
    if (r.count > 0) {
      await this.audit.log({ actorType: 'SYSTEM', action: 'kiosk.session.ended', entityType: 'KioskSession', entityId: sessionId, metadata: { reason } }, tx);
    }
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const idleCutoff = new Date(now - this.cfg.KIOSK_IDLE_TIMEOUT_SECONDS * 1000);
    const expired = await this.prisma.client.kioskSession.findMany({
      where: { endedAt: null, OR: [{ expiresAt: { lte: new Date(now) } }, { lastActivityAt: { lte: idleCutoff } }] },
      select: { id: true },
    });
    for (const s of expired) await this.prisma.client.$transaction((tx) => this.endSession(s.id, 'timeout', tx));
    return expired.length;
  }
}
