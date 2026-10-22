import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Clarification } from '@mdarai/database';
import { ProductMatcher } from '@mdarai/product-matcher';
import type {
  AppliedAction,
  CartView,
  ClarificationKind,
  ClarificationOption,
  ClarificationView,
  CommandIntent,
  CommandResult,
  ProductView,
  SalesUnit,
} from '@mdarai/shared-types';
import type { ActiveSession } from '../auth/kiosk-auth.service';
import { quantityLabel, unitName } from '../core/arabic';
import { AuditService } from '../core/audit.service';
import { CatalogService, type CatalogProduct } from '../core/catalog.service';
import { AppError } from '../core/errors';
import { ParserService } from '../core/parser.service';
import { PricingService } from '../core/pricing.service';
import { PrismaService, type Tx } from '../core/prisma.service';

export const MAX_LINE_QUANTITY = 10000;

/** A command for one product, possibly waiting for a clarification answer. */
interface PendingAction {
  intent: CommandIntent;
  spoken: string;
  productId: string | null;
  quantity: number | null;
  unit: SalesUnit | null;
  newUnit: SalesUnit | null;
}

interface ClarificationDraft {
  kind: ClarificationKind;
  action: PendingAction;
  question: string;
  options: ClarificationOption[];
}

type Outcome = { applied: AppliedAction } | { clarification: ClarificationDraft } | { message: string };

const CART_INTENTS: CommandIntent[] = ['SET_QUANTITY', 'INCREASE_QUANTITY', 'DECREASE_QUANTITY', 'REMOVE_ITEM', 'CHANGE_UNIT'];

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly parser: ParserService,
    private readonly audit: AuditService,
  ) {}

  /** Serialise all cart mutations of one session (works across API instances). */
  async withSessionLock<T>(sessionId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))::text`;
        return fn(tx);
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  }

  async view(session: ActiveSession, tx?: Tx): Promise<CartView> {
    await this.catalog.ensureLoaded();
    const db = tx ?? this.prisma.client;
    const lines = await db.cartItem.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } });
    return this.pricing.cartView(session.customerId, lines, tx);
  }

  async clarifications(sessionId: string, tx?: Tx): Promise<ClarificationView[]> {
    const db = tx ?? this.prisma.client;
    const rows = await db.clarification.findMany({ where: { sessionId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => this.clarificationView(c));
  }

  // ------------------------------------------------------------------ touch operations

  async addItem(session: ActiveSession, productId: string, unit: SalesUnit, quantity: number) {
    await this.catalog.ensureLoaded();
    return this.withSessionLock(session.id, async (tx) => {
      const p = this.requireProduct(productId);
      this.requireUnit(p, unit);
      await this.incrementLine(tx, session.id, p.id, unit, quantity);
      await tx.kioskSession.update({ where: { id: session.id }, data: { lastSpokenProduct: p.nameAr } });
      return this.view(session, tx);
    });
  }

  async updateLine(session: ActiveSession, lineId: string, patch: { quantity?: number; unit?: SalesUnit }) {
    await this.catalog.ensureLoaded();
    return this.withSessionLock(session.id, async (tx) => {
      const line = await tx.cartItem.findFirst({ where: { id: lineId, sessionId: session.id } });
      if (!line) throw new AppError(HttpStatus.NOT_FOUND, 'LINE_NOT_FOUND', 'المنتج غير موجود في السلة');
      const p = this.requireProduct(line.productId);
      const unit = patch.unit ?? line.unit;
      this.requireUnit(p, unit);
      const quantity = patch.quantity ?? line.quantity;
      if (unit !== line.unit) {
        await this.moveLine(tx, line.id, session.id, p.id, unit, quantity);
      } else {
        await tx.cartItem.update({ where: { id: line.id }, data: { quantity } });
      }
      return this.view(session, tx);
    });
  }

  async removeLine(session: ActiveSession, lineId: string) {
    return this.withSessionLock(session.id, async (tx) => {
      await tx.cartItem.deleteMany({ where: { id: lineId, sessionId: session.id } });
      return this.view(session, tx);
    });
  }

  async clear(session: ActiveSession) {
    return this.withSessionLock(session.id, async (tx) => {
      await tx.cartItem.deleteMany({ where: { sessionId: session.id } });
      await tx.clarification.deleteMany({ where: { sessionId: session.id } });
      return this.view(session, tx);
    });
  }

  // ------------------------------------------------------------------ voice / text commands

  /**
   * Apply one FINAL transcript (voice or typed). Partial transcripts must never
   * reach this method. The utteranceId makes retries idempotent.
   */
  async runCommand(session: ActiveSession, utteranceId: string, text: string): Promise<CommandResult> {
    await this.catalog.ensureLoaded();
    const stored = await this.prisma.client.processedUtterance.findUnique({ where: { sessionId_utteranceId: { sessionId: session.id, utteranceId } } });
    if (stored) return this.duplicateResult(session, stored.result);

    const cartLines = await this.prisma.client.cartItem.findMany({ where: { sessionId: session.id } });
    const { utterance, parser } = await this.parser.parse(text, {
      lastProduct: session.lastSpokenProduct,
      cartProducts: cartLines.map((l) => this.catalog.get(l.productId)?.nameAr).filter((n): n is string => !!n),
      vocabulary: this.catalog.getVocabulary(),
    });

    return this.withSessionLock(session.id, async (tx) => {
      const again = await tx.processedUtterance.findUnique({ where: { sessionId_utteranceId: { sessionId: session.id, utteranceId } } });
      if (again) return this.duplicateResult(session, again.result, tx);

      const applied: AppliedAction[] = [];
      const messages: string[] = [];
      const newClarifications: string[] = [];
      let searchResults: ProductView[] = [];
      let lastProduct: string | null = null;

      for (const cmd of utterance.commands) {
        if (cmd.intent === 'REQUEST_TOTAL') {
          const cart = await this.view(session, tx);
          messages.push(`المجموع ${cart.total} ₪ (${cart.lines.length} أصناف)`);
          applied.push({ intent: 'REQUEST_TOTAL', message: `المجموع ${cart.total} ₪` });
          continue;
        }
        if (cmd.intent === 'SEARCH_PRODUCT') {
          const found = this.catalog.getMatcher().search(cmd.search_query ?? '', 8).map((s) => s.product);
          searchResults = await this.pricing.productViews(session.customerId, found);
          messages.push(found.length ? `هذه نتائج «${cmd.search_query}»` : `ما لقيت «${cmd.search_query}» بالكتالوج`);
          continue;
        }
        if (cmd.intent === 'REQUEST_CLARIFICATION' || cmd.items.length === 0) {
          messages.push('ما فهمت أي منتج. احكي اسم المنتج والكمية، أو اختار من الكتالوج');
          continue;
        }
        for (const item of cmd.items) {
          const outcome = await this.applyAction(tx, session, {
            intent: cmd.intent,
            spoken: item.spoken_product,
            productId: null,
            quantity: item.quantity,
            unit: item.unit,
            newUnit: item.new_unit,
          });
          lastProduct = item.spoken_product;
          await this.collect(tx, session.id, outcome, applied, messages, newClarifications);
        }
      }
      if (utterance.commands.length === 0) messages.push('ما فهمت الطلب. جرّب مرة ثانية، مثلاً: «بدي خمس كراتين حليب»');
      if (lastProduct) await tx.kioskSession.update({ where: { id: session.id }, data: { lastSpokenProduct: lastProduct } });

      const result: Omit<CommandResult, 'cart' | 'clarifications'> = {
        utteranceId,
        transcript: text,
        parser,
        applied,
        searchResults,
        messages,
        duplicate: false,
      };
      await tx.processedUtterance.create({
        data: { sessionId: session.id, utteranceId, transcript: text, parser, result: result as unknown as Prisma.InputJsonValue },
      });
      await this.audit.log(
        {
          actorType: 'CUSTOMER',
          actorId: session.customerId,
          action: 'cart.command',
          entityType: 'KioskSession',
          entityId: session.id,
          metadata: { parser, intents: utterance.commands.map((c) => c.intent), applied: applied.length, clarifications: newClarifications.length },
        },
        tx,
      );
      return { ...result, cart: await this.view(session, tx), clarifications: await this.clarifications(session.id, tx) };
    });
  }

  async resolveClarification(session: ActiveSession, clarificationId: string, value: string): Promise<CommandResult> {
    await this.catalog.ensureLoaded();
    return this.withSessionLock(session.id, async (tx) => {
      const c = await tx.clarification.findFirst({ where: { id: clarificationId, sessionId: session.id, status: 'PENDING' } });
      if (!c) throw new AppError(HttpStatus.NOT_FOUND, 'CLARIFICATION_NOT_FOUND', 'السؤال لم يعد موجوداً');
      const options = c.options as unknown as ClarificationOption[];
      const action: PendingAction = {
        intent: c.intent as CommandIntent,
        spoken: c.spokenProduct,
        productId: c.productId,
        quantity: c.quantity,
        unit: c.unit,
        newUnit: c.newUnit,
      };
      if (c.kind === 'QUANTITY') {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > MAX_LINE_QUANTITY) throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_QUANTITY', 'كمية غير صحيحة');
        action.quantity = n;
      } else {
        if (!options.some((o) => o.value === value)) throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_OPTION', 'خيار غير صحيح');
        if (c.kind === 'UNIT_CHOICE') {
          if (action.intent === 'CHANGE_UNIT' && action.newUnit === null) action.newUnit = value as SalesUnit;
          else action.unit = value as SalesUnit;
        } else {
          action.productId = value;
        }
      }
      await tx.clarification.update({ where: { id: c.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
      const applied: AppliedAction[] = [];
      const messages: string[] = [];
      const outcome = await this.applyAction(tx, session, action);
      await this.collect(tx, session.id, outcome, applied, messages, []);
      return {
        utteranceId: c.id,
        transcript: '',
        parser: 'touch',
        applied,
        searchResults: [],
        messages,
        duplicate: false,
        cart: await this.view(session, tx),
        clarifications: await this.clarifications(session.id, tx),
      };
    });
  }

  async dismissClarification(session: ActiveSession, clarificationId: string) {
    return this.withSessionLock(session.id, async (tx) => {
      await tx.clarification.updateMany({ where: { id: clarificationId, sessionId: session.id, status: 'PENDING' }, data: { status: 'DISMISSED', resolvedAt: new Date() } });
      return this.clarifications(session.id, tx);
    });
  }

  // ------------------------------------------------------------------ internals

  private async collect(tx: Tx, sessionId: string, outcome: Outcome, applied: AppliedAction[], messages: string[], created: string[]) {
    if ('applied' in outcome) {
      applied.push(outcome.applied);
      messages.push(outcome.applied.message);
    } else if ('clarification' in outcome) {
      const id = await this.saveClarification(tx, sessionId, outcome.clarification);
      created.push(id);
      messages.push(outcome.clarification.question);
    } else {
      messages.push(outcome.message);
    }
  }

  private async saveClarification(tx: Tx, sessionId: string, d: ClarificationDraft): Promise<string> {
    // Saying the same thing twice must not stack duplicate questions.
    await tx.clarification.updateMany({
      where: { sessionId, status: 'PENDING', spokenProduct: d.action.spoken, intent: d.action.intent },
      data: { status: 'DISMISSED', resolvedAt: new Date() },
    });
    const c = await tx.clarification.create({
      data: {
        sessionId,
        kind: d.kind,
        intent: d.action.intent,
        spokenProduct: d.action.spoken,
        productId: d.action.productId,
        quantity: d.action.quantity,
        unit: d.action.unit,
        newUnit: d.action.newUnit,
        options: d.options as unknown as Prisma.InputJsonValue,
      },
    });
    return c.id;
  }

  private clarificationView(c: Clarification): ClarificationView {
    const p = c.productId ? this.catalog.get(c.productId) : undefined;
    const name = p?.nameAr ?? c.spokenProduct;
    const kind = c.kind as ClarificationKind;
    const question =
      kind === 'PRODUCT_CHOICE'
        ? `أي «${c.spokenProduct}» بتقصد؟`
        : kind === 'UNIT_CHOICE'
          ? `${name}: بالكرتونة ولا بالقطعة؟`
          : kind === 'QUANTITY'
            ? `كم ${c.unit ? unitName(c.unit) : ''} ${name} بدك؟`.replace(/\s+/g, ' ')
            : `ما لقيت «${c.spokenProduct}». يمكن قصدك:`;
    return {
      id: c.id,
      kind,
      intent: c.intent as CommandIntent,
      spokenProduct: c.spokenProduct,
      question,
      options: c.options as unknown as ClarificationOption[],
      createdAt: c.createdAt.toISOString(),
    };
  }

  private productOption(p: CatalogProduct): ClarificationOption {
    return { value: p.id, label: p.nameAr, sublabel: [p.nameHe, p.sku].filter(Boolean).join(' · ') };
  }

  private requireProduct(productId: string): CatalogProduct {
    const p = this.catalog.get(productId);
    if (!p || !p.active) throw new AppError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'المنتج غير متوفر');
    return p;
  }

  private requireUnit(p: CatalogProduct, unit: SalesUnit) {
    if (!CatalogService.sellsUnit(p, unit)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'UNIT_NOT_SOLD', `${p.nameAr} لا يُباع ب${unitName(unit)}`);
    }
  }

  private async incrementLine(tx: Tx, sessionId: string, productId: string, unit: SalesUnit, by: number): Promise<number> {
    const existing = await tx.cartItem.findUnique({ where: { sessionId_productId_unit: { sessionId, productId, unit } } });
    const quantity = Math.min((existing?.quantity ?? 0) + by, MAX_LINE_QUANTITY);
    if (existing) await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
    else await tx.cartItem.create({ data: { sessionId, productId, unit, quantity } });
    return quantity;
  }

  /** Change a line's unit; merges into an existing line of the target unit. */
  private async moveLine(tx: Tx, lineId: string, sessionId: string, productId: string, unit: SalesUnit, quantity: number) {
    const target = await tx.cartItem.findUnique({ where: { sessionId_productId_unit: { sessionId, productId, unit } } });
    if (target) {
      await tx.cartItem.update({ where: { id: target.id }, data: { quantity: Math.min(target.quantity + quantity, MAX_LINE_QUANTITY) } });
      await tx.cartItem.delete({ where: { id: lineId } });
    } else {
      await tx.cartItem.update({ where: { id: lineId }, data: { unit, quantity } });
    }
  }

  private unitClarification(action: PendingAction, p: CatalogProduct, units: SalesUnit[], forNewUnit = false): Outcome {
    return {
      clarification: {
        kind: 'UNIT_CHOICE',
        action: { ...action, productId: p.id, ...(forNewUnit ? { newUnit: null } : { unit: null }) },
        question: `${p.nameAr}: بالكرتونة ولا بالقطعة؟`,
        options: units.map((u) => ({
          value: u,
          label: u === 'carton' ? 'كرتونة' : 'قطعة',
          sublabel: u === 'carton' ? `${p.piecesPerCarton} قطعة بالكرتونة` : null,
        })),
      },
    };
  }

  /** Resolve the spoken product to a catalog product id, or explain why not. */
  private async resolveProduct(tx: Tx, sessionId: string, action: PendingAction): Promise<{ productId: string } | Outcome> {
    if (CART_INTENTS.includes(action.intent)) {
      const lines = await tx.cartItem.findMany({ where: { sessionId } });
      const inCart = [...new Set(lines.map((l) => l.productId))].map((id) => this.catalog.get(id)).filter((p): p is CatalogProduct => !!p);
      if (inCart.length) {
        // The cart is small, so a looser threshold is safe: "الحليب" should find the one milk in the cart.
        const r = new ProductMatcher(inCart, { minScore: 0.45, autoScore: 0.5, margin: 0.05 }).match(action.spoken);
        if (r.status === 'MATCHED' && r.product) return { productId: r.product.id };
        if (r.status === 'AMBIGUOUS') {
          return {
            clarification: { kind: 'PRODUCT_CHOICE', action, question: `أي «${action.spoken}» بتقصد؟`, options: r.candidates.map((c) => this.productOption(c.product)) },
          };
        }
      }
      if (action.intent !== 'SET_QUANTITY' && action.intent !== 'INCREASE_QUANTITY') {
        return { message: `«${action.spoken}» مش موجود بالسلة` };
      }
    }
    const r = this.catalog.getMatcher().match(action.spoken);
    if (r.status === 'MATCHED' && r.product) return { productId: r.product.id };
    if (r.status === 'AMBIGUOUS') {
      // "ضيف كمان كرتونة حليب" when one of the candidate milks is already in the cart -> that one.
      const lines = await tx.cartItem.findMany({ where: { sessionId }, select: { productId: true } });
      const inCart = r.candidates.filter((c) => lines.some((l) => l.productId === c.product.id));
      if (inCart.length === 1) return { productId: inCart[0].product.id };
      return {
        clarification: { kind: 'PRODUCT_CHOICE', action, question: `أي «${action.spoken}» بتقصد؟`, options: r.candidates.map((c) => this.productOption(c.product)) },
      };
    }
    const suggestions = this.catalog.getMatcher().search(action.spoken, 4).map((s) => s.product);
    if (suggestions.length) {
      return {
        clarification: { kind: 'NOT_FOUND', action, question: `ما لقيت «${action.spoken}». يمكن قصدك:`, options: suggestions.map((p) => this.productOption(p)) },
      };
    }
    return { message: `ما لقيت «${action.spoken}» بالكتالوج` };
  }

  private async applyAction(tx: Tx, session: ActiveSession, input: PendingAction): Promise<Outcome> {
    let action = { ...input };
    if (!action.productId) {
      const r = await this.resolveProduct(tx, session.id, action);
      if (!('productId' in r)) return r;
      action = { ...action, productId: r.productId };
    }
    const p = this.catalog.get(action.productId!);
    if (!p || !p.active) return { message: `«${action.spoken}» غير متوفر حالياً` };
    const sellable = CatalogService.sellableUnits(p);
    const lines = await tx.cartItem.findMany({ where: { sessionId: session.id, productId: p.id } });

    // Asked for a unit this product is not sold in: never switch silently, ask.
    if (action.unit && !sellable.includes(action.unit)) return this.unitClarification(action, p, sellable);

    switch (action.intent) {
      case 'ADD_ITEM':
      case 'INCREASE_QUANTITY': {
        const unit =
          action.unit ?? (lines.length === 1 ? lines[0].unit : null) ?? (sellable.length === 1 ? sellable[0] : null);
        if (!unit) return this.unitClarification(action, p, sellable);
        if (action.quantity === null && action.intent === 'ADD_ITEM') {
          return { clarification: { kind: 'QUANTITY', action: { ...action, unit }, question: `كم ${unitName(unit)} ${p.nameAr} بدك؟`, options: quantityOptions() } };
        }
        const by = action.quantity ?? 1;
        const total = await this.incrementLine(tx, session.id, p.id, unit, by);
        const msg = total === by ? `أضفت ${quantityLabel(by, unit)} ${p.nameAr}` : `زدت ${p.nameAr}: صار ${quantityLabel(total, unit)}`;
        return { applied: { intent: action.intent, message: msg, productId: p.id } };
      }
      case 'SET_QUANTITY': {
        let line = action.unit ? lines.find((l) => l.unit === action.unit) : lines.length === 1 ? lines[0] : undefined;
        if (!line && action.unit && lines.length === 1) line = lines[0]; // "خلي الحليب 7 كراتين" when it was in pieces
        if (!line && lines.length > 1) return this.unitClarification(action, p, lines.map((l) => l.unit));
        const unit = action.unit ?? line?.unit ?? (sellable.length === 1 ? sellable[0] : null);
        if (!unit) return this.unitClarification(action, p, sellable);
        if (action.quantity === null) {
          return { clarification: { kind: 'QUANTITY', action: { ...action, unit }, question: `كم ${unitName(unit)} ${p.nameAr} بدك؟`, options: quantityOptions() } };
        }
        if (line) {
          if (line.unit !== unit) await this.moveLine(tx, line.id, session.id, p.id, unit, action.quantity);
          else await tx.cartItem.update({ where: { id: line.id }, data: { quantity: action.quantity } });
        } else {
          await tx.cartItem.create({ data: { sessionId: session.id, productId: p.id, unit, quantity: action.quantity } });
        }
        return { applied: { intent: 'SET_QUANTITY', message: `${p.nameAr}: صار ${quantityLabel(action.quantity, unit)}`, productId: p.id } };
      }
      case 'DECREASE_QUANTITY':
      case 'REMOVE_ITEM': {
        if (lines.length === 0) return { message: `${p.nameAr} مش موجود بالسلة` };
        const candidates = action.unit ? lines.filter((l) => l.unit === action.unit) : lines;
        if (candidates.length === 0) return { message: `${p.nameAr} مش موجود ب${unitName(action.unit!)}` };
        if (action.intent === 'REMOVE_ITEM' && !action.unit) {
          await tx.cartItem.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
          return { applied: { intent: 'REMOVE_ITEM', message: `شلت ${p.nameAr} من السلة`, productId: p.id } };
        }
        if (candidates.length > 1) return this.unitClarification(action, p, candidates.map((l) => l.unit));
        const line = candidates[0];
        if (action.intent === 'REMOVE_ITEM') {
          await tx.cartItem.delete({ where: { id: line.id } });
          return { applied: { intent: 'REMOVE_ITEM', message: `شلت ${p.nameAr} من السلة`, productId: p.id } };
        }
        const left = line.quantity - (action.quantity ?? 1);
        if (left <= 0) {
          await tx.cartItem.delete({ where: { id: line.id } });
          return { applied: { intent: 'DECREASE_QUANTITY', message: `شلت ${p.nameAr} من السلة`, productId: p.id } };
        }
        await tx.cartItem.update({ where: { id: line.id }, data: { quantity: left } });
        return { applied: { intent: 'DECREASE_QUANTITY', message: `نقصت ${p.nameAr}: صار ${quantityLabel(left, line.unit)}`, productId: p.id } };
      }
      case 'CHANGE_UNIT': {
        if (lines.length === 0) return { message: `${p.nameAr} مش موجود بالسلة` };
        const newUnit = action.newUnit;
        if (!newUnit) return this.unitClarification(action, p, sellable, true);
        if (!sellable.includes(newUnit)) return { message: `${p.nameAr} لا يُباع ب${unitName(newUnit)}` };
        const line = lines.find((l) => l.unit !== newUnit);
        if (!line) return { message: `${p.nameAr} أصلاً ب${unitName(newUnit)}` };
        await this.moveLine(tx, line.id, session.id, p.id, newUnit, line.quantity);
        return { applied: { intent: 'CHANGE_UNIT', message: `${p.nameAr}: صار ${quantityLabel(line.quantity, newUnit)}`, productId: p.id } };
      }
      default:
        return { message: 'ما فهمت الطلب' };
    }
  }

  private async duplicateResult(session: ActiveSession, stored: unknown, tx?: Tx): Promise<CommandResult> {
    const r = stored as Omit<CommandResult, 'cart' | 'clarifications'>;
    return { ...r, duplicate: true, cart: await this.view(session, tx), clarifications: await this.clarifications(session.id, tx) };
  }
}

function quantityOptions(): ClarificationOption[] {
  return [1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: String(n) }));
}
