import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@mdarai/database';
import { ORDER_STATUS_TRANSITIONS, WS_EVENTS } from '@mdarai/shared-types';
import type { ActiveSession } from '../auth/kiosk-auth.service';
import { KioskAuthService } from '../auth/kiosk-auth.service';
import { AuditService } from '../core/audit.service';
import { CatalogService } from '../core/catalog.service';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { EventsService } from '../core/events.service';
import { PricingService } from '../core/pricing.service';
import { PrismaService } from '../core/prisma.service';
import { CartService } from '../kiosk/cart.service';
import { nextOrderNumber } from './order-number';

const orderInclude = { items: true, printJobs: { orderBy: { createdAt: 'desc' } }, statusEvents: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.OrderInclude;
export type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly cart: CartService,
    private readonly kioskAuth: KioskAuthService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Confirm the cart as an order. Only ever called from an explicit touch on
   * the confirmation button — never from speech. Idempotent per key.
   */
  async confirm(session: ActiveSession, idempotencyKey: string, ip: string | null) {
    const previous = await this.prisma.client.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
    if (previous) {
      if (previous.sessionId !== session.id) throw new AppError(HttpStatus.CONFLICT, 'IDEMPOTENCY_KEY_REUSED', 'طلب غير صالح');
      return { order: previous, duplicate: true };
    }
    if (session.endedAt) throw new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'انتهت الجلسة');
    await this.catalog.ensureLoaded();

    const order = await this.cart.withSessionLock(session.id, async (tx) => {
      const again = await tx.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
      if (again) return again;
      const pending = await tx.clarification.count({ where: { sessionId: session.id, status: 'PENDING' } });
      if (pending > 0) {
        throw new AppError(HttpStatus.CONFLICT, 'PENDING_CLARIFICATIONS', 'في أسئلة لسا ما انجاوبت. جاوبها أو احذفها قبل التأكيد');
      }
      const lines = await tx.cartItem.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } });
      if (lines.length === 0) throw new AppError(HttpStatus.BAD_REQUEST, 'CART_EMPTY', 'السلة فاضية');
      for (const l of lines) {
        const p = this.catalog.get(l.productId);
        if (!p || !p.active) throw new AppError(HttpStatus.CONFLICT, 'PRODUCT_UNAVAILABLE', `منتج لم يعد متوفراً: ${p?.nameAr ?? l.productId}`);
        if (!CatalogService.sellsUnit(p, l.unit)) throw new AppError(HttpStatus.CONFLICT, 'UNIT_NOT_SOLD', `${p.nameAr} لم يعد يُباع بهذه الوحدة`);
      }
      // Prices are recalculated here from the database, never taken from the client.
      const view = await this.pricing.cartView(session.customerId, lines, tx);
      const orderNumber = await nextOrderNumber(tx, this.cfg.ORDER_NUMBER_PREFIX, this.cfg.BUSINESS_TIMEZONE);
      const created = await tx.order.create({
        data: {
          orderNumber,
          idempotencyKey,
          customerId: session.customerId,
          sessionId: session.id,
          deviceId: session.deviceId,
          pricesIncludeVat: view.pricesIncludeVat,
          vatRate: view.vatRate,
          subtotal: view.subtotal,
          discountTotal: view.discountTotal,
          vat: view.vat,
          total: view.total,
          customerSnapshot: { code: session.customer.code, name: session.customer.name, businessName: session.customer.businessName },
          items: {
            create: view.lines.map((l) => ({
                productId: l.productId,
                sku: l.sku,
                nameAr: l.nameAr,
                nameHe: l.nameHe,
                variant: l.variant,
                size: l.size,
                unit: l.unit,
                quantity: l.quantity,
                piecesPerCarton: l.piecesPerCarton,
                listUnitPrice: l.listUnitPrice,
                unitPrice: l.unitPrice,
                discountTotal: l.discountTotal,
                lineTotal: l.lineTotal,
                pricingRule: l.pricingRule,
                tierId: l.tierId,
            })),
          },
          printJobs: { create: { kind: 'AUTO', dedupeKey: `auto:${idempotencyKey}` } },
        },
        include: orderInclude,
      });
      await this.audit.log(
        { actorType: 'CUSTOMER', actorId: session.customerId, action: 'order.confirmed', entityType: 'Order', entityId: created.id, metadata: { orderNumber, total: view.total, lines: lines.length }, ip },
        tx,
      );
      await this.kioskAuth.endSession(session.id, 'order_confirmed', tx);
      return created;
    });
    this.events.emit(WS_EVENTS.ORDER_CREATED, { orderId: order.id, orderNumber: order.orderNumber });
    return { order, duplicate: false };
  }

  async list(filter: { status?: OrderStatus[]; from?: Date; to?: Date; q?: string; take: number; skip: number }) {
    const where: Prisma.OrderWhereInput = {
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
      ...(filter.q ? { OR: [{ orderNumber: { contains: filter.q, mode: 'insensitive' } }, { customer: { code: { contains: filter.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.order.count({ where }),
      this.prisma.client.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: filter.take, skip: filter.skip, include: { _count: { select: { items: true } } } }),
    ]);
    return { total, rows };
  }

  async get(id: string): Promise<OrderWithDetails> {
    const order = await this.prisma.client.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new AppError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'الطلب غير موجود');
    return order;
  }

  async setStatus(id: string, to: OrderStatus, staffUserId: string) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new AppError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'الطلب غير موجود');
      if (!ORDER_STATUS_TRANSITIONS[order.status].includes(to)) {
        throw new AppError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `لا يمكن الانتقال من ${order.status} إلى ${to}`);
      }
      // Optimistic check: only move from the status we just read.
      const r = await tx.order.updateMany({ where: { id, status: order.status }, data: { status: to } });
      if (r.count !== 1) throw new AppError(HttpStatus.CONFLICT, 'CONCURRENT_UPDATE', 'تم تعديل الطلب من مكان آخر، حدّث الصفحة');
      await tx.orderStatusEvent.create({ data: { orderId: id, fromStatus: order.status, toStatus: to, staffUserId } });
      await this.audit.log({ actorType: 'STAFF', actorId: staffUserId, action: 'order.status', entityType: 'Order', entityId: id, metadata: { from: order.status, to } }, tx);
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
    this.events.emit(WS_EVENTS.ORDER_UPDATED, { orderId: id, status: to });
    return updated;
  }
}
