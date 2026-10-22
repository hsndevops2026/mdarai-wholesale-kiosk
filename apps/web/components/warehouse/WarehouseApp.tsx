'use client';

import { ORDER_STATUS_TRANSITIONS, WS_EVENTS, type OrderStatus } from '@mdarai/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { StaffLogin } from '@/components/StaffLogin';
import { api, API_URL, ApiError, money } from '@/lib/api';

const TOKEN_KEY = 'mdarai.staff.token';

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'جديد',
  PREPARING: 'قيد التحضير',
  READY: 'جاهز',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
};
const STATUS_COLOR: Record<OrderStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  PREPARING: 'bg-amber-100 text-amber-800',
  READY: 'bg-green-100 text-green-800',
  DELIVERED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-red-100 text-red-700',
};
const PRINT_LABEL: Record<string, string> = { PENDING: 'بانتظار الطباعة', PRINTING: 'يطبع…', PRINTED: 'مطبوع', FAILED: 'فشلت الطباعة' };

interface OrderRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  printStatus: string;
  customer: { code: string; name: string; businessName: string };
  total: string;
  itemCount: number;
  createdAt: string;
}

interface OrderDetail extends Omit<OrderRow, 'itemCount'> {
  subtotal: string;
  vat: string;
  discountTotal: string;
  items: Array<{ id: string; sku: string; aisle: string | null; shelf: string | null; nameAr: string; nameHe: string | null; unit: 'piece' | 'carton'; quantity: number; piecesPerCarton: number; unitPrice: string; lineTotal: string }>;
  printJobs: Array<{ id: string; kind: string; status: string; attempts: number; lastError: string | null; printedAt: string | null; createdAt: string }>;
  statusEvents: Array<{ from: string; to: string; at: string }>;
}

const VIEWS: Array<{ key: string; label: string; statuses: OrderStatus[] }> = [
  { key: 'active', label: 'الطلبيات المفتوحة', statuses: ['NEW', 'PREPARING', 'READY'] },
  { key: 'history', label: 'السجل', statuses: ['DELIVERED', 'CANCELLED'] },
];

export function WarehouseApp() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [view, setView] = useState('active');
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [printerOnline, setPrinterOnline] = useState<boolean | null>(null);

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

  const loadPrinters = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api<{ agents: Array<{ online: boolean }> }>('/warehouse/orders/printers/status', { headers: auth() });
      setPrinterOnline(r.agents.some((a) => a.online));
    } catch {
      setPrinterOnline(null);
    }
  }, [token, auth]);

  useEffect(() => {
    void loadPrinters();
    const t = setInterval(() => void loadPrinters(), 20_000);
    return () => clearInterval(t);
  }, [loadPrinters]);

  const load = useCallback(async () => {
    if (!token) return;
    const statuses = VIEWS.find((v) => v.key === view)!.statuses.join(',');
    try {
      const r = await api<{ orders: OrderRow[] }>(`/warehouse/orders?status=${statuses}&take=100`, { headers: auth() });
      setOrders(r.orders);
      setError(null);
    } catch (e) {
      onError(e);
    }
  }, [token, view, auth, onError]);

  const open = useCallback(
    async (id: string) => {
      try {
        setSelected(await api<OrderDetail>(`/warehouse/orders/${id}`, { headers: auth() }));
      } catch (e) {
        onError(e);
      }
    },
    [auth, onError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates; a 30s poll covers missed websocket events.
  useEffect(() => {
    if (!token) return;
    const socket = io(`${API_URL}/warehouse`, { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    const refresh = (p: { orderId?: string; orderNumber?: string }) => {
      void load();
      setSelected((cur) => {
        if (cur && p.orderId === cur.id) void open(cur.id);
        return cur;
      });
    };
    socket.on(WS_EVENTS.ORDER_CREATED, (p: { orderNumber?: string }) => {
      setFlash(`طلبية جديدة ${p.orderNumber ?? ''}`);
      refresh(p);
    });
    socket.on(WS_EVENTS.ORDER_UPDATED, refresh);
    socket.on(WS_EVENTS.PRINT_UPDATED, refresh);
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      socket.disconnect();
      clearInterval(poll);
    };
  }, [token, load, open]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const setStatus = async (status: OrderStatus) => {
    if (!selected) return;
    if (status === 'CANCELLED' && !window.confirm('إلغاء الطلبية؟')) return;
    try {
      setSelected(await api<OrderDetail>(`/warehouse/orders/${selected.id}/status`, { method: 'POST', headers: auth(), body: JSON.stringify({ status }) }));
      void load();
    } catch (e) {
      onError(e);
    }
  };

  const reprint = async () => {
    if (!selected || !window.confirm('إعادة طباعة ورقة التحضير؟')) return;
    try {
      await api(`/warehouse/orders/${selected.id}/reprint`, { method: 'POST', headers: auth() });
      await open(selected.id);
    } catch (e) {
      onError(e);
    }
  };

  if (!ready) return null;
  if (!token)
    return (
      <StaffLogin
        onLogin={(t) => {
          try {
            sessionStorage.setItem(TOKEN_KEY, t);
          } catch {}
          setToken(t);
        }}
      />
    );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b bg-white px-5 py-3">
        <h1 className="text-xl font-bold">لوحة المستودع</h1>
        <span className={`rounded-full px-3 py-1 text-sm ${live ? 'bg-green-100 text-green-800' : 'bg-slate-200'}`}>{live ? 'متصل مباشر' : 'غير متصل'}</span>
        <span data-testid="printer-status" className={`rounded-full px-3 py-1 text-sm ${printerOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
          {printerOnline ? 'الطابعة شغّالة' : printerOnline === false ? 'الطابعة مش متصلة' : 'الطابعة: غير معروف'}
        </span>
        {VIEWS.map((v) => (
          <button key={v.key} type="button" onClick={() => setView(v.key)} className={`rounded-lg px-4 py-2 ${view === v.key ? 'bg-navy text-white' : 'ring-1 ring-black/10'}`}>
            {v.label}
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
      {flash && <div className="bg-blue-600 p-3 text-center text-lg font-bold text-white">{flash}</div>}
      {error && <div className="bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[420px_1fr]">
        <ul data-testid="order-list" className="min-h-0 divide-y overflow-y-auto border-e bg-white">
          {orders.length === 0 && <li className="p-6 text-center text-slate-ink">لا توجد طلبيات</li>}
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => open(o.id)} className={`w-full p-4 text-start ${selected?.id === o.id ? 'bg-lavender/50' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold" dir="ltr">{o.orderNumber}</span>
                  <span className={`rounded-full px-2 py-0.5 text-sm ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                </div>
                <div className="text-sm text-slate-ink">
                  {o.customer.code} · {o.customer.businessName} · {o.itemCount} أصناف · {money(o.total)}
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(o.createdAt).toLocaleString('he-IL')} · {PRINT_LABEL[o.printStatus] ?? o.printStatus}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <section className="min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <p className="text-slate-ink">اختر طلبية من القائمة</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold" dir="ltr">{selected.orderNumber}</h2>
                <span className={`rounded-full px-3 py-1 ${STATUS_COLOR[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                <span data-testid="print-status" className={`rounded-full px-3 py-1 ${selected.printStatus === 'FAILED' ? 'bg-red-100 text-red-700' : selected.printStatus === 'PRINTED' ? 'bg-green-100 text-green-800' : 'bg-slate-100'}`}>{PRINT_LABEL[selected.printStatus] ?? selected.printStatus}</span>
              </div>
              <div className="text-slate-ink">
                {selected.customer.code} — {selected.customer.name} — {selected.customer.businessName} · {new Date(selected.createdAt).toLocaleString('he-IL')}
              </div>
              <div className="flex flex-wrap gap-2">
                {ORDER_STATUS_TRANSITIONS[selected.status].map((s) => (
                  <button key={s} type="button" onClick={() => setStatus(s)} className={`h-12 rounded-xl px-5 font-bold ${s === 'CANCELLED' ? 'bg-red-50 text-red-700' : 'bg-navy text-white'}`}>
                    {s === 'CANCELLED' ? 'إلغاء' : `← ${STATUS_LABEL[s]}`}
                  </button>
                ))}
                <button type="button" onClick={reprint} className="h-12 rounded-xl px-5 ring-1 ring-black/20">
                  إعادة طباعة
                </button>
              </div>
              <table className="w-full overflow-hidden rounded-xl bg-white text-start ring-1 ring-black/5">
                <thead className="bg-slate-50 text-sm">
                  <tr>
                    <th className="p-2 text-start">المكان</th>
                    <th className="p-2 text-start">SKU</th>
                    <th className="p-2 text-start">المنتج</th>
                    <th className="p-2 text-start">الكمية</th>
                    <th className="p-2 text-start">السعر</th>
                    <th className="p-2 text-start">المجموع</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selected.items.map((i) => (
                    <tr key={i.id}>
                      <td className="p-2 font-mono text-sm" dir="ltr">{[i.aisle, i.shelf].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="p-2 font-mono text-sm" dir="ltr">{i.sku}</td>
                      <td className="p-2">
                        <div className="font-bold">{i.nameAr}</div>
                        {i.nameHe && <div className="text-sm text-slate-ink">{i.nameHe}</div>}
                      </td>
                      <td className="p-2 text-lg font-bold">
                        {i.quantity} {i.unit === 'carton' ? `كرتونة (×${i.piecesPerCarton})` : 'قطعة'}
                      </td>
                      <td className="p-2">{money(i.unitPrice)}</td>
                      <td className="p-2">{money(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="w-72 space-y-1 rounded-xl bg-white p-3 ring-1 ring-black/5">
                <div className="flex justify-between"><span>المجموع</span><span>{money(selected.subtotal)}</span></div>
                <div className="flex justify-between"><span>ضريبة</span><span>{money(selected.vat)}</span></div>
                <div className="flex justify-between font-bold"><span>الإجمالي</span><span>{money(selected.total)}</span></div>
              </div>
              <div>
                <h3 className="font-bold">الطباعة</h3>
                <ul className="text-sm">
                  {selected.printJobs.map((j) => (
                    <li key={j.id}>
                      {j.kind === 'AUTO' ? 'تلقائي' : 'إعادة'} · {PRINT_LABEL[j.status] ?? j.status} · محاولات {j.attempts}
                      {j.lastError ? ` · ${j.lastError}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
