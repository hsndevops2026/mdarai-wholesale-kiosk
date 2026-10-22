import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PrintJob } from '@mdarai/database';
import { WS_EVENTS } from '@mdarai/shared-types';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../core/audit.service';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { EventsService } from '../core/events.service';
import { PrismaService, type Tx } from '../core/prisma.service';
import { pickingOrder, retryDelayMs } from './print-utils';

/** What the print agent needs to print a picking slip. Deliberately contains no prices. */
export interface SlipPayload {
  jobId: string;
  kind: 'AUTO' | 'REPRINT';
  attempt: number;
  order: {
    orderNumber: string;
    createdAt: string;
    customer: { code: string; name: string; businessName: string };
    items: Array<{
      sku: string;
      barcode: string | null;
      nameAr: string;
      nameHe: string | null;
      unit: 'piece' | 'carton';
      quantity: number;
      piecesPerCarton: number;
      pieceLabel: string | null;
      aisle: string | null;
      shelf: string | null;
    }>;
  };
}

@Injectable()
export class PrintService {
  /** Last contact per agent id (in-memory; good enough for one API instance). */
  private readonly agents = new Map<string, Date>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  agentStatus() {
    return [...this.agents].map(([id, lastSeen]) => ({ id, lastSeen, online: Date.now() - lastSeen.getTime() < 60_000 }));
  }

  /**
   * Claim the next due job. A job stuck in PRINTING longer than the claim timeout
   * (agent crashed) becomes claimable again. SKIP LOCKED lets several agents poll safely.
   */
  async claim(agentId: string): Promise<SlipPayload | null> {
    this.agents.set(agentId, new Date());
    const job = await this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "PrintJob"
        WHERE ("status" = 'PENDING' AND "nextAttemptAt" <= now())
           OR ("status" = 'PRINTING' AND "claimedAt" < now() - make_interval(secs => ${this.cfg.PRINT_CLAIM_TIMEOUT_SECONDS}))
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return null;
      const updated = await tx.printJob.update({
        where: { id: rows[0].id },
        data: { status: 'PRINTING', claimedAt: new Date(), claimedBy: agentId, attempts: { increment: 1 } },
        include: { order: { include: { items: true } } },
      });
      await this.syncOrderPrintStatus(tx, updated.orderId);
      return updated;
    });
    if (!job) return null;
    this.events.emit(WS_EVENTS.PRINT_UPDATED, { orderId: job.orderId, jobId: job.id, status: 'PRINTING' });
    const customer = job.order.customerSnapshot as { code: string; name: string; businessName: string };
    return {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
      order: {
        orderNumber: job.order.orderNumber,
        createdAt: job.order.createdAt.toISOString(),
        customer,
        items: pickingOrder(
          job.order.items.map((i) => ({
            sku: i.sku,
            barcode: i.barcode,
            nameAr: i.nameAr,
            nameHe: i.nameHe,
            unit: i.unit,
            quantity: i.quantity,
            piecesPerCarton: i.piecesPerCarton,
            pieceLabel: i.pieceLabel,
            aisle: i.aisle,
            shelf: i.shelf,
          })),
        ),
      },
    };
  }

  /** Idempotent: completing an already-printed job is a no-op. */
  async complete(jobId: string, agentId: string) {
    this.agents.set(agentId, new Date());
    const job = await this.prisma.client.$transaction(async (tx) => {
      const j = await this.ownedJob(tx, jobId, agentId);
      if (j.status === 'PRINTED') return j;
      const done = await tx.printJob.update({ where: { id: jobId }, data: { status: 'PRINTED', printedAt: new Date(), lastError: null } });
      await this.syncOrderPrintStatus(tx, j.orderId);
      await this.audit.log({ actorType: 'PRINT_AGENT', actorId: agentId, action: 'print.printed', entityType: 'PrintJob', entityId: jobId, metadata: { kind: j.kind, attempts: j.attempts } }, tx);
      return done;
    });
    this.events.emit(WS_EVENTS.PRINT_UPDATED, { orderId: job.orderId, jobId, status: job.status });
    return { status: job.status };
  }

  /** Record a failure; retry later with exponential backoff until maxAttempts. */
  async fail(jobId: string, agentId: string, error: string) {
    this.agents.set(agentId, new Date());
    const job = await this.prisma.client.$transaction(async (tx) => {
      const j = await this.ownedJob(tx, jobId, agentId);
      if (j.status === 'PRINTED') return j;
      const final = j.attempts >= j.maxAttempts;
      const updated = await tx.printJob.update({
        where: { id: jobId },
        data: {
          status: final ? 'FAILED' : 'PENDING',
          lastError: error.slice(0, 500),
          claimedAt: null,
          claimedBy: null,
          nextAttemptAt: new Date(Date.now() + retryDelayMs(j.attempts)),
        },
      });
      await this.syncOrderPrintStatus(tx, j.orderId);
      await this.audit.log({ actorType: 'PRINT_AGENT', actorId: agentId, action: final ? 'print.failed' : 'print.retry', entityType: 'PrintJob', entityId: jobId, metadata: { attempts: j.attempts, error: error.slice(0, 200) } }, tx);
      return updated;
    });
    this.events.emit(WS_EVENTS.PRINT_UPDATED, { orderId: job.orderId, jobId, status: job.status });
    return { status: job.status, nextAttemptAt: job.nextAttemptAt };
  }

  /**
   * Staff-requested reprint. Refused while another reprint of the same order is
   * still waiting, so a double tap cannot queue two copies.
   */
  async reprint(orderId: string, staffUserId: string) {
    const job = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'reprint:' + orderId}))::text`;
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
      if (!order) throw new AppError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'الطلب غير موجود');
      const open = await tx.printJob.findFirst({ where: { orderId, status: { in: ['PENDING', 'PRINTING'] } } });
      if (open) throw new AppError(HttpStatus.CONFLICT, 'PRINT_ALREADY_QUEUED', 'في طباعة لهاي الطلبية بالانتظار. استنى لتخلص');
      const created = await tx.printJob.create({ data: { orderId, kind: 'REPRINT', dedupeKey: `reprint:${randomUUID()}`, requestedById: staffUserId } });
      await this.syncOrderPrintStatus(tx, orderId);
      await this.audit.log({ actorType: 'STAFF', actorId: staffUserId, action: 'print.reprint_requested', entityType: 'Order', entityId: orderId }, tx);
      return created;
    });
    this.events.emit(WS_EVENTS.PRINT_UPDATED, { orderId, jobId: job.id, status: job.status });
    return { jobId: job.id, status: job.status };
  }

  private async ownedJob(tx: Tx, jobId: string, agentId: string): Promise<PrintJob> {
    const j = await tx.printJob.findUnique({ where: { id: jobId } });
    if (!j) throw new AppError(HttpStatus.NOT_FOUND, 'JOB_NOT_FOUND', 'job not found');
    if (j.status === 'PRINTING' && j.claimedBy !== agentId) throw new AppError(HttpStatus.CONFLICT, 'JOB_NOT_OWNED', 'job claimed by another agent');
    if (j.status !== 'PRINTING' && j.status !== 'PRINTED') throw new AppError(HttpStatus.CONFLICT, 'JOB_NOT_CLAIMED', 'job is not being printed');
    return j;
  }

  /** Order.printStatus mirrors its most recent print job. */
  private async syncOrderPrintStatus(tx: Tx, orderId: string) {
    const latest = await tx.printJob.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
    if (latest) await tx.order.update({ where: { id: orderId }, data: { printStatus: latest.status } });
  }
}
