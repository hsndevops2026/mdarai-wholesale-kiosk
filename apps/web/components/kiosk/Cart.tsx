'use client';

import type { CartView } from '@mdarai/shared-types';
import { money } from '@/lib/api';

const unitLabel = (u: 'piece' | 'carton') => (u === 'carton' ? 'كرتونة' : 'قطعة');

export function Cart({
  cart,
  onQuantity,
  onUnit,
  onRemove,
  onReview,
  busy,
}: {
  cart: CartView;
  onQuantity: (lineId: string, q: number) => void;
  onUnit: (lineId: string, u: 'piece' | 'carton') => void;
  onRemove: (lineId: string) => void;
  onReview: () => void;
  busy: boolean;
}) {
  return (
    <section aria-label="السلة" className="flex h-full flex-col rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
      <header className="flex items-center justify-between border-b p-4">
        <h2 className="text-2xl font-bold">السلة</h2>
        <span className="text-slate-ink">{cart.lines.length} أصناف</span>
      </header>
      <ul data-testid="cart-lines" className="flex-1 divide-y overflow-y-auto">
        {cart.lines.length === 0 && <li className="p-8 text-center text-lg text-slate-ink">السلة فاضية. احكي طلبك أو اختار من الكتالوج</li>}
        {cart.lines.map((l) => (
          <li key={l.id} data-testid="cart-line" className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold" data-testid="cart-line-name">{l.nameAr}</div>
                {l.nameHe && <div className="text-sm text-slate-ink" dir="rtl">{l.nameHe}</div>}
                <div className="text-xs text-slate-400" dir="ltr">{l.sku}{l.unit === 'carton' ? ` · ${l.piecesPerCarton} pcs/carton` : ''}</div>
              </div>
              <button type="button" aria-label={`حذف ${l.nameAr}`} onClick={() => onRemove(l.id)} disabled={busy} className="h-12 w-12 shrink-0 rounded-xl bg-red-50 text-xl text-red-700">
                ✕
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-xl ring-1 ring-black/10" dir="ltr">
                <button type="button" aria-label="نقص" disabled={busy} onClick={() => (l.quantity > 1 ? onQuantity(l.id, l.quantity - 1) : onRemove(l.id))} className="h-12 w-12 text-2xl">
                  −
                </button>
                <span data-testid="cart-line-qty" className="w-14 text-center text-xl font-bold">{l.quantity}</span>
                <button type="button" aria-label="زيد" disabled={busy} onClick={() => onQuantity(l.id, l.quantity + 1)} className="h-12 w-12 text-2xl">
                  +
                </button>
              </div>
              {l.sellsPiece && l.sellsCarton ? (
                <div className="flex overflow-hidden rounded-xl ring-1 ring-black/10">
                  {(['carton', 'piece'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      disabled={busy || l.unit === u}
                      onClick={() => onUnit(l.id, u)}
                      className={`h-12 px-4 ${l.unit === u ? 'bg-navy text-white' : 'bg-white'}`}
                    >
                      {unitLabel(u)}
                    </button>
                  ))}
                </div>
              ) : (
                <span data-testid="cart-line-unit" className="rounded-xl bg-slate-100 px-3 py-2">{unitLabel(l.unit)}</span>
              )}
              <div className="ms-auto text-start">
                <div className="text-sm text-slate-ink">
                  {money(l.unitPrice)} / {unitLabel(l.unit)}
                  {l.listUnitPrice !== l.unitPrice && <span className="ms-2 text-slate-400 line-through">{money(l.listUnitPrice)}</span>}
                </div>
                {Number(l.discountTotal) > 0 && <div className="text-sm text-green-700">خصم {money(l.discountTotal)}</div>}
                <div className="text-lg font-bold">{money(l.lineTotal)}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <footer className="space-y-1 border-t p-4">
        <Row label="المجموع" value={money(cart.subtotal)} />
        {Number(cart.discountTotal) > 0 && <Row label="وفّرت" value={money(cart.discountTotal)} className="text-green-700" />}
        <Row label={cart.pricesIncludeVat ? 'منها ضريبة' : `ضريبة ${Math.round(Number(cart.vatRate) * 100)}%`} value={money(cart.vat)} />
        <Row label="الإجمالي" value={money(cart.total)} className="text-2xl font-bold" testId="cart-total" />
        <button type="button" disabled={busy || cart.lines.length === 0} onClick={onReview} className="brand-gradient mt-3 h-16 w-full rounded-2xl text-2xl font-bold text-white disabled:opacity-40">
          مراجعة الطلبية
        </button>
      </footer>
    </section>
  );
}

function Row({ label, value, className = '', testId }: { label: string; value: string; className?: string; testId?: string }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <span>{label}</span>
      <span data-testid={testId}>{value}</span>
    </div>
  );
}
