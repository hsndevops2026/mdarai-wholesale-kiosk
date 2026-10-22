'use client';

import type { ProductView } from '@mdarai/shared-types';
import { money } from '@/lib/api';

export function ProductGrid({ products, onAdd, busy }: { products: ProductView[]; onAdd: (p: ProductView, unit: 'piece' | 'carton') => void; busy: boolean }) {
  if (products.length === 0) return <p className="p-6 text-center text-slate-ink">ما في نتائج</p>;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {products.map((p) => (
        <li key={p.id} data-testid="product-card" className="flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="text-lg font-bold">{p.nameAr}</div>
          {p.nameHe && <div className="text-sm text-slate-ink">{p.nameHe}</div>}
          <div className="text-xs text-slate-400" dir="ltr">
            {p.sku} · {p.piecesPerCarton} pcs/carton
          </div>
          <div className="mt-auto flex gap-2 pt-3">
            {p.sellsCarton && (
              <button type="button" disabled={busy} onClick={() => onAdd(p, 'carton')} className="flex-1 rounded-xl bg-navy px-2 py-3 text-white">
                + كرتونة
                <div className="text-sm opacity-80">{money(p.cartonPrice)}</div>
              </button>
            )}
            {p.sellsPiece && (
              <button type="button" disabled={busy} onClick={() => onAdd(p, 'piece')} className="flex-1 rounded-xl bg-white px-2 py-3 ring-1 ring-navy">
                + {p.pieceLabel ?? 'قطعة'}
                <div className="text-sm text-slate-ink">{money(p.piecePrice)}</div>
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
