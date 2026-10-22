import { describe, expect, it } from 'vitest';
import { pickingOrder, retryDelayMs } from './print-utils';

describe('print utils', () => {
  it('backs off exponentially and caps at 5 minutes', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([5000, 10000, 20000, 40000]);
    expect(retryDelayMs(20)).toBe(300000);
  });
  it('sorts lines for a picking walk, unknown locations last', () => {
    const items = [
      { sku: 'C', aisle: null, shelf: null },
      { sku: 'B', aisle: 'A10', shelf: 'S1' },
      { sku: 'A', aisle: 'A2', shelf: 'S3' },
      { sku: 'D', aisle: 'A2', shelf: 'S1' },
    ];
    expect(pickingOrder(items).map((i) => i.sku)).toEqual(['D', 'A', 'B', 'C']);
  });
});
