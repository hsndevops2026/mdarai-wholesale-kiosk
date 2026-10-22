import { z } from 'zod';

/** Units a product can be sold in. Kept deliberately small for the MVP. */
export const SalesUnitSchema = z.enum(['piece', 'carton']);
export type SalesUnit = z.infer<typeof SalesUnitSchema>;

export const CommandIntentSchema = z.enum([
  'ADD_ITEM',
  'SET_QUANTITY',
  'INCREASE_QUANTITY',
  'DECREASE_QUANTITY',
  'REMOVE_ITEM',
  'CHANGE_UNIT',
  'SEARCH_PRODUCT',
  'REQUEST_TOTAL',
  'REQUEST_CLARIFICATION',
]);
export type CommandIntent = z.infer<typeof CommandIntentSchema>;

/**
 * One product mention extracted from speech/text. Every field is required and
 * nullable (rather than optional) so the same schema can be used for OpenAI
 * strict structured outputs.
 */
export const ParsedItemSchema = z
  .object({
    /** The product words exactly as the customer said them (no SKU invention). */
    spoken_product: z.string().trim().min(1).max(200),
    /** Positive integer quantity, or null when the customer did not say one. */
    quantity: z.number().int().positive().max(100000).nullable(),
    /** Unit the customer said, or null when not stated. */
    unit: SalesUnitSchema.nullable(),
    /** Only for CHANGE_UNIT: the unit to switch to. */
    new_unit: SalesUnitSchema.nullable(),
  })
  .strict();
export type ParsedItem = z.infer<typeof ParsedItemSchema>;

export const ParsedCommandSchema = z
  .object({
    intent: CommandIntentSchema,
    items: z.array(ParsedItemSchema).max(50),
    /** Free-text query for SEARCH_PRODUCT, otherwise null. */
    search_query: z.string().max(200).nullable(),
    requires_clarification: z.boolean(),
    clarification_reason: z.string().max(300).nullable(),
  })
  .strict();
export type ParsedCommand = z.infer<typeof ParsedCommandSchema>;

/** A single utterance can contain several commands ("add oil and remove the milk"). */
export const ParsedUtteranceSchema = z
  .object({
    commands: z.array(ParsedCommandSchema).max(20),
  })
  .strict();
export type ParsedUtterance = z.infer<typeof ParsedUtteranceSchema>;

// ---------------------------------------------------------------------------
// API view models (shared by API and web)
// ---------------------------------------------------------------------------

export interface ProductView {
  id: string;
  sku: string;
  nameAr: string;
  nameHe: string | null;
  brand: string | null;
  variant: string | null;
  size: string | null;
  category: string | null;
  imageUrl: string | null;
  piecesPerCarton: number;
  sellsPiece: boolean;
  sellsCarton: boolean;
  /** Customer-specific unit prices (decimal strings). Null when the unit is not sold. */
  piecePrice: string | null;
  cartonPrice: string | null;
}

export interface CartLineView {
  id: string;
  productId: string;
  sku: string;
  nameAr: string;
  nameHe: string | null;
  variant: string | null;
  size: string | null;
  imageUrl: string | null;
  unit: SalesUnit;
  quantity: number;
  piecesPerCarton: number;
  sellsPiece: boolean;
  sellsCarton: boolean;
  /** Default list price for this unit (decimal string). */
  listUnitPrice: string;
  /** Price actually charged per unit (decimal string). */
  unitPrice: string;
  discountTotal: string;
  lineTotal: string;
  pricingRule: PricingRule;
  tierId: string | null;
}

export type PricingRule = 'CUSTOMER_TIER' | 'CUSTOMER_PRICE' | 'DEFAULT_TIER' | 'DEFAULT_PRICE';

export interface CartView {
  lines: CartLineView[];
  currency: 'ILS';
  pricesIncludeVat: boolean;
  vatRate: string;
  subtotal: string;
  discountTotal: string;
  vat: string;
  total: string;
}

export type ClarificationKind = 'PRODUCT_CHOICE' | 'UNIT_CHOICE' | 'QUANTITY' | 'NOT_FOUND';

export interface ClarificationOption {
  /** Opaque value sent back when the option is chosen. */
  value: string;
  label: string;
  sublabel?: string | null;
}

export interface ClarificationView {
  id: string;
  kind: ClarificationKind;
  intent: CommandIntent;
  spokenProduct: string;
  question: string;
  options: ClarificationOption[];
  createdAt: string;
}

export interface AppliedAction {
  intent: CommandIntent;
  message: string;
  productId?: string;
}

export interface CommandResult {
  utteranceId: string;
  transcript: string;
  parser: string;
  applied: AppliedAction[];
  clarifications: ClarificationView[];
  searchResults: ProductView[];
  messages: string[];
  cart: CartView;
  /** True when the same utteranceId was already processed (no changes made). */
  duplicate: boolean;
}

export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
export type PrintStatus = 'PENDING' | 'PRINTING' | 'PRINTED' | 'FAILED';

export const ORDER_STATUSES: OrderStatus[] = ['NEW', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

/** Allowed fulfilment transitions for warehouse staff. */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Websocket events emitted to the warehouse dashboard. */
export const WS_EVENTS = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  PRINT_UPDATED: 'print.updated',
} as const;

/**
 * Israeli ID (Teudat Zehut) check-digit validation. Accepts 5-9 digits
 * (left-padded to 9). This only checks the format; it is NOT authentication.
 */
export function isValidIsraeliId(input: string): boolean {
  const digits = input.trim();
  if (!/^\d{5,9}$/.test(digits)) return false;
  const id = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(id[i]) * ((i % 2) + 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}
