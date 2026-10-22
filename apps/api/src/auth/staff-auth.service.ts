import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { hashToken, newToken, verifyPassword, type StaffRole, type StaffUser } from '@mdarai/database';
import { AuditService } from '../core/audit.service';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { PrismaService } from '../core/prisma.service';

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async login(username: string, password: string, ip: string | null) {
    const user = await this.prisma.client.staffUser.findUnique({ where: { username } });
    const ok = !!user && user.active && (await verifyPassword(password, user.passwordHash));
    if (!ok || !user) {
      await this.audit.log({ actorType: 'STAFF', actorId: user?.id ?? null, action: 'staff.login.failed', ip });
      throw new AppError(HttpStatus.UNAUTHORIZED, 'BAD_CREDENTIALS', 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    const token = newToken();
    const expiresAt = new Date(Date.now() + this.cfg.STAFF_SESSION_HOURS * 3600 * 1000);
    await this.prisma.client.staffSession.create({ data: { tokenHash: hashToken(token), staffUserId: user.id, expiresAt } });
    await this.audit.log({ actorType: 'STAFF', actorId: user.id, action: 'staff.login', ip });
    return { token, expiresAt, user: this.publicUser(user) };
  }

  async resolve(token: string | undefined, roles: StaffRole[]): Promise<StaffUser> {
    if (!token) throw new AppError(HttpStatus.UNAUTHORIZED, 'STAFF_AUTH_REQUIRED', 'الرجاء تسجيل الدخول');
    const s = await this.prisma.client.staffSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { staffUser: true } });
    if (!s || s.revokedAt || s.expiresAt <= new Date() || !s.staffUser.active) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'STAFF_SESSION_INVALID', 'انتهت جلسة الدخول');
    }
    if (roles.length && !roles.includes(s.staffUser.role)) throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'لا تملك صلاحية');
    return s.staffUser;
  }

  async logout(token: string) {
    await this.prisma.client.staffSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  publicUser(u: StaffUser) {
    return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
  }
}
