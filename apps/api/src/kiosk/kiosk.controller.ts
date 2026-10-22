import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { KioskDevice } from '@mdarai/database';
import { SalesUnitSchema } from '@mdarai/shared-types';
import { z } from 'zod';
import { AllowEndedSession, ClientIp, CurrentDevice, CurrentSession, KioskDeviceGuard, KioskSessionGuard } from '../auth/guards';
import { KioskAuthService, type ActiveSession } from '../auth/kiosk-auth.service';
import { CatalogService } from '../core/catalog.service';
import { APP_CONFIG, type AppConfig } from '../core/config';
import { PricingService } from '../core/pricing.service';
import { ZodPipe } from '../core/zod.pipe';
import { serializeOrder } from '../orders/order.serializer';
import { OrderService } from '../orders/order.service';
import { CartService, MAX_LINE_QUANTITY } from './cart.service';

const IdentifySchema = z.object({ nationalId: z.string().regex(/^\d{5,9}$/) });
const AddItemSchema = z.object({ productId: z.string().min(1).max(64), unit: SalesUnitSchema, quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) });
const UpdateLineSchema = z
  .object({ quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).optional(), unit: SalesUnitSchema.optional() })
  .refine((v) => v.quantity !== undefined || v.unit !== undefined, 'nothing to update');
const CommandSchema = z.object({
  utteranceId: z.string().min(8).max(64),
  text: z.string().trim().min(1).max(1000),
  source: z.enum(['voice', 'text']).default('text'),
});
const ResolveSchema = z.object({ value: z.string().min(1).max(64) });
const ConfirmSchema = z.object({ idempotencyKey: z.string().min(16).max(64) });
const CatalogQuery = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  take: z.coerce.number().int().min(1).max(100).default(40),
  skip: z.coerce.number().int().min(0).default(0),
});

@Controller('kiosk')
export class KioskController {
  constructor(
    private readonly auth: KioskAuthService,
    private readonly cart: CartService,
    private readonly orders: OrderService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post('identify')
  @HttpCode(200)
  @UseGuards(KioskDeviceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async identify(@CurrentDevice() device: KioskDevice, @Body(new ZodPipe(IdentifySchema)) body: z.infer<typeof IdentifySchema>, @ClientIp() ip: string | null) {
    const { token, session, customer } = await this.auth.identify(device, body.nationalId, ip);
    return {
      sessionToken: token,
      expiresAt: session.expiresAt,
      idleTimeoutSeconds: this.cfg.KIOSK_IDLE_TIMEOUT_SECONDS,
      customer: { code: customer.code, name: customer.name, businessName: customer.businessName },
    };
  }

  @Get('session')
  @UseGuards(KioskSessionGuard)
  async session(@CurrentSession() s: ActiveSession) {
    return {
      customer: { code: s.customer.code, name: s.customer.name, businessName: s.customer.businessName },
      expiresAt: s.expiresAt,
      idleTimeoutSeconds: this.cfg.KIOSK_IDLE_TIMEOUT_SECONDS,
      cart: await this.cart.view(s),
      clarifications: await this.cart.clarifications(s.id),
    };
  }

  /** Keeps the session alive while the customer is active on screen without calling other endpoints. */
  @Post('heartbeat')
  @HttpCode(204)
  @UseGuards(KioskSessionGuard)
  heartbeat() {}

  @Post('logout')
  @HttpCode(204)
  @UseGuards(KioskSessionGuard)
  async logout(@CurrentSession() s: ActiveSession) {
    await this.cart.withSessionLock(s.id, (tx) => this.auth.endSession(s.id, 'logout', tx));
  }

  @Get('catalog')
  @UseGuards(KioskSessionGuard)
  async products(@CurrentSession() s: ActiveSession, @Query(new ZodPipe(CatalogQuery)) q: z.infer<typeof CatalogQuery>) {
    await this.catalog.ensureLoaded();
    let list = q.q?.trim() ? this.catalog.getMatcher().search(q.q, 200).map((r) => r.product) : this.catalog.activeProducts();
    if (q.category) list = list.filter((p) => p.category === q.category);
    if (!q.q?.trim()) list = [...list].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '', 'ar') || a.nameAr.localeCompare(b.nameAr, 'ar'));
    const page = list.slice(q.skip, q.skip + q.take);
    return { total: list.length, products: await this.pricing.productViews(s.customerId, page) };
  }

  @Get('categories')
  @UseGuards(KioskSessionGuard)
  async categories() {
    await this.catalog.ensureLoaded();
    return { categories: this.catalog.categories() };
  }

  @Get('cart')
  @UseGuards(KioskSessionGuard)
  async getCart(@CurrentSession() s: ActiveSession) {
    return { cart: await this.cart.view(s), clarifications: await this.cart.clarifications(s.id) };
  }

  @Post('cart/items')
  @UseGuards(KioskSessionGuard)
  async addItem(@CurrentSession() s: ActiveSession, @Body(new ZodPipe(AddItemSchema)) b: z.infer<typeof AddItemSchema>) {
    return { cart: await this.cart.addItem(s, b.productId, b.unit, b.quantity) };
  }

  @Patch('cart/items/:id')
  @UseGuards(KioskSessionGuard)
  async updateItem(@CurrentSession() s: ActiveSession, @Param('id') id: string, @Body(new ZodPipe(UpdateLineSchema)) b: z.infer<typeof UpdateLineSchema>) {
    return { cart: await this.cart.updateLine(s, id, b) };
  }

  @Delete('cart/items/:id')
  @UseGuards(KioskSessionGuard)
  async removeItem(@CurrentSession() s: ActiveSession, @Param('id') id: string) {
    return { cart: await this.cart.removeLine(s, id) };
  }

  @Delete('cart')
  @UseGuards(KioskSessionGuard)
  async clearCart(@CurrentSession() s: ActiveSession) {
    return { cart: await this.cart.clear(s) };
  }

  /** Apply a FINAL transcript (voice) or typed text. */
  @Post('cart/commands')
  @HttpCode(200)
  @UseGuards(KioskSessionGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async command(@CurrentSession() s: ActiveSession, @Body(new ZodPipe(CommandSchema)) b: z.infer<typeof CommandSchema>) {
    return this.cart.runCommand(s, b.utteranceId, b.text);
  }

  @Post('cart/clarifications/:id/resolve')
  @HttpCode(200)
  @UseGuards(KioskSessionGuard)
  async resolve(@CurrentSession() s: ActiveSession, @Param('id') id: string, @Body(new ZodPipe(ResolveSchema)) b: z.infer<typeof ResolveSchema>) {
    return this.cart.resolveClarification(s, id, b.value);
  }

  @Post('cart/clarifications/:id/dismiss')
  @HttpCode(200)
  @UseGuards(KioskSessionGuard)
  async dismiss(@CurrentSession() s: ActiveSession, @Param('id') id: string) {
    return { clarifications: await this.cart.dismissClarification(s, id) };
  }

  /** Explicit touchscreen confirmation. Retrying with the same key returns the same order. */
  @Post('orders/confirm')
  @HttpCode(200)
  @AllowEndedSession()
  @UseGuards(KioskSessionGuard)
  async confirm(@CurrentSession() s: ActiveSession, @Body(new ZodPipe(ConfirmSchema)) b: z.infer<typeof ConfirmSchema>, @ClientIp() ip: string | null) {
    const { order, duplicate } = await this.orders.confirm(s, b.idempotencyKey, ip);
    return { duplicate, order: serializeOrder(order) };
  }
}
