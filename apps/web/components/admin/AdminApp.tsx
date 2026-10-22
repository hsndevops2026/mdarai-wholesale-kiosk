'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffLogin } from '@/components/StaffLogin';
import { api, ApiError, download } from '@/lib/api';

const TOKEN_KEY = 'mdarai.staff.token';

interface Issue {
  sheet: string;
  row: number;
  column?: string;
  severity: 'error' | 'warning';
  message: string;
}

interface Summary {
  fileName: string;
  products: { create: number; update: number; unchanged: number };
  customers: { create: number; update: number };
  customerPrices: number;
  tiers: number;
  tierSkus: number;
  errors: number;
  warnings: number;
}

interface Preview {
  id: string;
  summary: Summary;
  issues: Issue[];
  changes: Array<{ sku: string; action: 'create' | 'update'; fields: string[] }>;
  canCommit: boolean;
}

interface Device {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'import' | 'devices'>('import');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(TOKEN_KEY));
    } catch {}
    setReady(true);
  }, []);

  const auth = useCallback((): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {}), [token]);
  const onError = useCallback((e: unknown) => {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch {}
      setToken(null);
    }
    setError(e instanceof Error ? e.message : 'خطأ');
  }, []);

  if (!ready) return null;
  if (!token)
    return (
      <StaffLogin
        onLogin={(t) => {
          try {
            sessionStorage.setItem(TOKEN_KEY, t);
          } catch {}
          setError(null);
          setToken(t);
        }}
      />
    );

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b bg-white px-5 py-3">
        <h1 className="text-xl font-bold">الإدارة</h1>
        {(['import', 'devices'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 ${tab === t ? 'bg-navy text-white' : 'ring-1 ring-black/10'}`}>
            {t === 'import' ? 'استيراد من إكسل' : 'أجهزة الكشك'}
          </button>
        ))}
        <button
          type="button"
          className="ms-auto rounded-lg px-4 py-2 ring-1 ring-black/10"
          onClick={async () => {
            await api('/staff/logout', { method: 'POST', headers: auth() }).catch(() => undefined);
            try {
              sessionStorage.removeItem(TOKEN_KEY);
            } catch {}
            setToken(null);
          }}
        >
          خروج
        </button>
      </header>
      {error && (
        <div role="status" className="bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}
      <main className="mx-auto max-w-5xl p-5">{tab === 'import' ? <ImportPanel auth={auth} onError={onError} clearError={() => setError(null)} /> : <DevicesPanel auth={auth} onError={onError} />}</main>
    </div>
  );
}

function ImportPanel({ auth, onError, clearError }: { auth: () => Record<string, string>; onError: (e: unknown) => void; clearError: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setDone(null);
    clearError();
    try {
      const form = new FormData();
      form.append('file', file);
      setPreview(await api<Preview>('/admin/import/preview', { method: 'POST', headers: auth(), body: form }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api<{ summary: Summary }>(`/admin/import/${preview.id}/commit`, { method: 'POST', headers: auth() });
      setDone(r.summary);
      setPreview(null);
      setFile(null);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const s = preview?.summary;
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/5">
        <h2 className="text-lg font-bold">1. القالب</h2>
        <p className="text-sm text-slate-ink">
          النظام بيقرأ قالب المحل كما هو. الأعمدة المظللة (عدد القطع بالكرتونة، سعر الكرتونة، النوع، الحجم) وأوراق الزبائن والأسعار الخاصة وخصومات الكمية اختيارية.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => download('/admin/import/template', auth(), 'MdarAi_Wholesale_Import_Template.xlsx').catch(onError)} className="rounded-xl px-4 py-2 ring-1 ring-black/20">
            تنزيل قالب فارغ
          </button>
          <button type="button" onClick={() => download('/admin/import/template?data=1', auth(), 'MdarAi_Catalog_Export.xlsx').catch(onError)} className="rounded-xl px-4 py-2 ring-1 ring-black/20">
            تصدير الكتالوج الحالي (للتعديل وإعادة الرفع)
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/5">
        <h2 className="text-lg font-bold">2. رفع ومعاينة</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            aria-label="ملف الإكسل"
            accept=".xlsx,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setDone(null);
            }}
          />
          <button type="button" disabled={!file || busy} onClick={upload} className="rounded-xl bg-navy px-5 py-2 text-white disabled:opacity-40">
            {busy && !preview ? 'جاري الفحص…' : 'معاينة'}
          </button>
        </div>
        <p className="text-xs text-slate-ink">المعاينة لا تغيّر أي بيانات. أرقام الهوية في ورقة الزبائن تُشفّر فوراً ولا تُحفظ. احذف الملف من جهازك بعد الاستيراد.</p>
      </section>

      {preview && s && (
        <section data-testid="import-preview" className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-black/5">
          <h2 className="text-lg font-bold">3. النتيجة: {s.fileName}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="منتجات جديدة" value={s.products.create} />
            <Stat label="منتجات ستتعدل" value={s.products.update} />
            <Stat label="بدون تغيير" value={s.products.unchanged} />
            <Stat label="زبائن (جديد/تعديل)" value={`${s.customers.create}/${s.customers.update}`} />
            <Stat label="أسعار خاصة" value={s.customerPrices} />
            <Stat label="شرائح خصم" value={`${s.tiers} (${s.tierSkus} منتج)`} />
            <Stat label="أخطاء" value={s.errors} tone={s.errors ? 'bad' : 'ok'} />
            <Stat label="تنبيهات" value={s.warnings} tone={s.warnings ? 'warn' : 'ok'} />
          </div>
          {preview.issues.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-black/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="p-2 text-start">الورقة</th>
                    <th className="p-2 text-start">الصف</th>
                    <th className="p-2 text-start">العمود</th>
                    <th className="p-2 text-start">المشكلة</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.issues.map((i, k) => (
                    <tr key={k} className={i.severity === 'error' ? 'bg-red-50' : 'bg-amber-50'}>
                      <td className="p-2">{i.sheet}</td>
                      <td className="p-2">{i.row || '—'}</td>
                      <td className="p-2" dir="ltr">{i.column ?? ''}</td>
                      <td className="p-2">{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.changes.filter((c) => c.action === 'update').length > 0 && (
            <details>
              <summary className="cursor-pointer">تفاصيل التعديلات</summary>
              <ul className="mt-2 text-sm" dir="ltr">
                {preview.changes
                  .filter((c) => c.action === 'update')
                  .map((c) => (
                    <li key={c.sku}>
                      {c.sku}: {c.fields.join(', ')}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <button type="button" disabled={!preview.canCommit || busy} onClick={commit} className="brand-gradient h-14 rounded-2xl px-8 text-lg font-bold text-white disabled:opacity-40">
            {preview.canCommit ? 'تأكيد الاستيراد' : 'صلّح الأخطاء وارفع الملف من جديد'}
          </button>
        </section>
      )}

      {done && (
        <p data-testid="import-done" className="rounded-2xl bg-green-50 p-4 text-green-800">
          تم الاستيراد: {done.products.create} منتج جديد، {done.products.update} منتج معدّل، {done.customerPrices} سعر خاص، {done.tiers} شريحة خصم.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'ok' }: { label: string; value: number | string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : '';
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-ink">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function DevicesPanel({ auth, onError }: { auth: () => Record<string, string>; onError: (e: unknown) => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices((await api<{ devices: Device[] }>('/admin/kiosk-devices', { headers: auth() })).devices);
    } catch (e) {
      onError(e);
    }
  }, [auth, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/5">
        <h2 className="text-lg font-bold">تسجيل تابلت جديد</h2>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الجهاز، مثلاً: تابلت المدخل" className="h-11 flex-1 rounded-xl px-3 ring-1 ring-black/10" />
          <button
            type="button"
            disabled={!name.trim()}
            className="rounded-xl bg-navy px-5 text-white disabled:opacity-40"
            onClick={async () => {
              try {
                const r = await api<{ name: string; token: string }>('/admin/kiosk-devices', { method: 'POST', headers: auth(), body: JSON.stringify({ name }) });
                setCreated(r);
                setName('');
                void load();
              } catch (e) {
                onError(e);
              }
            }}
          >
            إنشاء رمز
          </button>
        </div>
        {created && (
          <div className="rounded-xl bg-amber-50 p-4">
            <p className="font-bold">رمز «{created.name}». انسخه الآن وأدخله على التابلت في /kiosk. لن يظهر مرة ثانية.</p>
            <code className="mt-2 block break-all rounded bg-white p-2" dir="ltr">
              {created.token}
            </code>
          </div>
        )}
      </section>
      <ul className="divide-y rounded-2xl bg-white ring-1 ring-black/5">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between p-4">
            <div>
              <div className="font-bold">{d.name}</div>
              <div className="text-xs text-slate-ink">آخر ظهور: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('he-IL') : '—'}</div>
            </div>
            {d.active ? (
              <button
                type="button"
                className="rounded-lg bg-red-50 px-4 py-2 text-red-700"
                onClick={async () => {
                  if (!window.confirm(`إيقاف «${d.name}»؟ أي جلسة مفتوحة عليه ستنتهي.`)) return;
                  try {
                    await api(`/admin/kiosk-devices/${d.id}/deactivate`, { method: 'POST', headers: auth() });
                    void load();
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                إيقاف
              </button>
            ) : (
              <span className="text-slate-ink">موقوف</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
