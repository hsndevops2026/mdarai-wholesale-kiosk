import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { StaffAuthService } from '../auth/staff-auth.service';
import { EventsService } from '../core/events.service';

/**
 * Pushes order/print events to the warehouse dashboard. Clients authenticate
 * with their staff token in the socket.io handshake (auth.token).
 * Events carry ids only; the dashboard re-fetches details over REST.
 */
@WebSocketGateway({ namespace: '/warehouse', cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',') } })
export class WarehouseGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger('WarehouseGateway');
  private unsubscribe: (() => void) | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly staff: StaffAuthService,
    private readonly events: EventsService,
  ) {}

  afterInit() {
    this.unsubscribe = this.events.subscribe((e) => this.server.to('staff').emit(e.type, e.payload));
  }

  async handleConnection(client: Socket) {
    try {
      const token = typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : undefined;
      await this.staff.resolve(token, ['WAREHOUSE', 'ADMIN']);
      await client.join('staff');
    } catch {
      this.logger.warn('rejected unauthenticated websocket connection');
      client.disconnect(true);
    }
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }
}
