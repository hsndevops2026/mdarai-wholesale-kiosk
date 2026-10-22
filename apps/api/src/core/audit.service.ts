import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@mdarai/database';
import { PrismaService, type Tx } from './prisma.service';

export type ActorType = 'CUSTOMER' | 'STAFF' | 'KIOSK' | 'SYSTEM' | 'PRINT_AGENT';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Never put national IDs, tokens or passwords here. */
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma.client;
    try {
      await db.auditLog.create({ data: { ...entry, actorId: entry.actorId ?? null, ip: entry.ip ?? null } });
    } catch (err) {
      // Audit failures must not break the customer flow, but must be visible.
      this.logger.error(`audit write failed for ${entry.action}: ${(err as Error).message}`);
      if (tx) throw err;
    }
  }
}
