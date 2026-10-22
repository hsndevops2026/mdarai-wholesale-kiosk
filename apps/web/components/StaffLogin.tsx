'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export function StaffLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api<{ token: string }>('/staff/login', { method: 'POST', body: JSON.stringify({ username, password }) });
          onLogin(r.token);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'خطأ');
        }
      }}
    >
      <h1 className="text-2xl font-bold">دخول الموظفين</h1>
      {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
      <input aria-label="اسم المستخدم" placeholder="اسم المستخدم" value={username} onChange={(e) => setUsername(e.target.value)} className="h-12 rounded-xl px-3 ring-1 ring-black/10" dir="ltr" />
      <input aria-label="كلمة المرور" placeholder="كلمة المرور" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl px-3 ring-1 ring-black/10" dir="ltr" />
      <button type="submit" className="h-12 rounded-xl bg-navy text-white">
        دخول
      </button>
    </form>
  );
}
