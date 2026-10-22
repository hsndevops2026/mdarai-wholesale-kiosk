'use client';

import type { ClarificationView } from '@mdarai/shared-types';
import { useState } from 'react';

export function Clarifications({
  items,
  onResolve,
  onDismiss,
  busy,
}: {
  items: ClarificationView[];
  onResolve: (id: string, value: string) => void;
  onDismiss: (id: string) => void;
  busy: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label="أسئلة" className="space-y-3">
      {items.map((c) => (
        <div key={c.id} data-testid="clarification" className="rounded-2xl bg-lavender/60 p-4 ring-2 ring-brand-violet/40">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xl font-bold">{c.question}</p>
            <button type="button" onClick={() => onDismiss(c.id)} disabled={busy} className="rounded-lg px-3 py-1 text-slate-ink ring-1 ring-black/10">
              تجاهل
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.options.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={busy}
                onClick={() => onResolve(c.id, o.value)}
                data-testid="clarification-option"
                className="min-h-14 rounded-xl bg-white px-4 py-2 text-start shadow-sm ring-1 ring-black/10 active:bg-lavender"
              >
                <div className="text-lg font-bold">{o.label}</div>
                {o.sublabel && <div className="text-xs text-slate-ink">{o.sublabel}</div>}
              </button>
            ))}
            {c.kind === 'QUANTITY' && <OtherQuantity disabled={busy} onPick={(n) => onResolve(c.id, String(n))} />}
          </div>
        </div>
      ))}
    </section>
  );
}

function OtherQuantity({ onPick, disabled }: { onPick: (n: number) => void; disabled: boolean }) {
  const [v, setV] = useState('');
  const n = Number(v);
  return (
    <div className="flex items-center gap-2">
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/\D/g, '').slice(0, 5))}
        placeholder="كمية ثانية"
        className="h-14 w-32 rounded-xl px-3 text-lg ring-1 ring-black/10"
      />
      <button type="button" disabled={disabled || !(n >= 1)} onClick={() => onPick(n)} className="h-14 rounded-xl bg-navy px-4 text-white disabled:opacity-40">
        تمام
      </button>
    </div>
  );
}
