import type { SalesUnit } from '@mdarai/shared-types';

/** "5 كراتين", "كرتونتين", "11 كرتونة" — Arabic number agreement for unit words. */
export function quantityLabel(qty: number, unit: SalesUnit): string {
  const [one, two, few] = unit === 'carton' ? ['كرتونة', 'كرتونتين', 'كراتين'] : ['قطعة', 'قطعتين', 'قطع'];
  if (qty === 1) return one;
  if (qty === 2) return two;
  if (qty >= 3 && qty <= 10) return `${qty} ${few}`;
  return `${qty} ${one}`;
}

export function unitName(unit: SalesUnit): string {
  return unit === 'carton' ? 'كرتونة' : 'قطعة';
}
