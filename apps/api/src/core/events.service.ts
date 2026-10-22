import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** In-process event bus (orders -> websocket gateway, print queue). */
@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(type: string, payload: Record<string, unknown>) {
    this.emitter.emit('event', { type, payload } satisfies DomainEvent);
  }

  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
