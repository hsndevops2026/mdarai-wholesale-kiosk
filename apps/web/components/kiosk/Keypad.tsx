'use client';

import { isValidIsraeliId } from '@mdarai/shared-types';
import { useState } from 'react';

export function Keypad({ onSubmit, busy, error }: { onSubmit: (id: string) => void; busy: boolean; error: string | null }) {
  const [value, setValue] = useState('');
  const press = (d: string) => setValue((v) => (v.length < 9 ? v + d : v));
  const valid = isValidIsraeliId(value);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5">
      <h1 className="text-center text-3xl font-bold">أهلاً وسهلاً</h1>
      <p className="text-center text-lg text-slate-ink">أدخل رقم الهوية لتبدأ الطلبية</p>
      <div dir="ltr" data-testid="id-display" className="flex h-20 w-full items-center justify-center rounded-2xl bg-white text-4xl font-bold tracking-[0.3em] shadow-inner ring-1 ring-black/10">
        {value.replace(/./g, '•') || <span className="text-xl tracking-normal text-slate-400">_ _ _ _ _ _ _ _ _</span>}
      </div>
      {error && <p role="alert" className="w-full rounded-xl bg-red-50 p-3 text-center text-red-700">{error}</p>}
      <div dir="ltr" className="grid w-full grid-cols-3 gap-3">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} className="h-20 rounded-2xl bg-white text-3xl font-bold shadow-sm ring-1 ring-black/10 active:bg-lavender">
            {k}
          </button>
        ))}
        <button type="button" onClick={() => setValue('')} className="h-20 rounded-2xl bg-white text-xl shadow-sm ring-1 ring-black/10 active:bg-lavender">
          مسح
        </button>
        <button type="button" onClick={() => press('0')} className="h-20 rounded-2xl bg-white text-3xl font-bold shadow-sm ring-1 ring-black/10 active:bg-lavender">
          0
        </button>
        <button type="button" aria-label="حذف رقم" onClick={() => setValue((v) => v.slice(0, -1))} className="h-20 rounded-2xl bg-white text-3xl shadow-sm ring-1 ring-black/10 active:bg-lavender">
          ⌫
        </button>
      </div>
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => {
          onSubmit(value);
          setValue('');
        }}
        className="brand-gradient h-20 w-full rounded-2xl text-2xl font-bold text-white shadow disabled:opacity-40"
      >
        {busy ? 'لحظة…' : 'دخول'}
      </button>
      {value.length >= 5 && !valid && <p className="text-slate-ink">الرقم غير صحيح، تأكد منه</p>}
    </div>
  );
}
