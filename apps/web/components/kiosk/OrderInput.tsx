'use client';

import { useState } from 'react';

/**
 * Typed order input. The microphone (Phase 3) feeds the same onSubmit with
 * FINAL transcripts only; partial transcripts are displayed, never submitted.
 */
export function OrderInput({ onSubmit, busy }: { onSubmit: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSubmit(t);
    setText('');
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="اكتب طلبك"
        data-testid="order-text"
        placeholder="اكتب طلبك، مثلاً: بدي خمس كراتين حليب وثلاث كراتين زيت"
        className="h-16 min-w-0 flex-1 rounded-xl px-4 text-lg ring-1 ring-black/10"
      />
      <button type="submit" disabled={busy || !text.trim()} className="brand-gradient h-16 rounded-xl px-6 text-xl font-bold text-white disabled:opacity-40">
        أرسل
      </button>
    </form>
  );
}
