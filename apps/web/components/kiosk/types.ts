import type { CartView, ClarificationView, CommandResult, ProductView } from '@mdarai/shared-types';

export type { CartView, ClarificationView, CommandResult, ProductView };

export interface CustomerInfo {
  code: string;
  name: string;
  businessName: string;
}

export interface ConfirmedOrder {
  orderNumber: string;
  total: string;
  items: Array<{ sku: string; nameAr: string; unit: 'piece' | 'carton'; quantity: number; lineTotal: string }>;
}
