'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, money, newId } from '@/lib/api';
import { Cart } from './Cart';
import { ProductGrid } from './Catalog';
import { Clarifications } from './Clarifications';
import { Keypad } from './Keypad';
import { OrderInput } from './OrderInput';
import type { CartView, ClarificationView, CommandResult, ConfirmedOrder, CustomerInfo, ProductView } from './types';

const DEVICE_KEY = 'mdarai.kiosk.deviceToken';
const SESSION_KEY = 'mdarai.kiosk.session';
const IDLE_WARNING_SECONDS = 30;
const DONE_SCREEN_SECONDS = 20;

type Screen = 'loading' | 'setup' | 'identify' | 'shopping' | 'review' | 'done';

interface Feedback {
  id: string;
  transcript: string;
  messages: string[];
}

function readStorage(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function KioskApp() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [device, setDevice] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [idleTimeout, setIdleTimeout] = useState(180);
  const [cart, setCart] = useState<CartView | null>(null);
  const [clarifications, setClarifications] = useState<ClarificationView[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const lastHeartbeat = useRef(0);

  const headers = useCallback(
    (withSession = true): Record<string, string> => ({
      ...(device ? { 'x-kiosk-device': device } : {}),
      ...(withSession && session ? { 'x-kiosk-session': session } : {}),
    }),
    [device, session],
  );

  // ------------------------------------------------------------------ session lifecycle

  const resetToIdentify = useCallback((message: string | null = null) => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    setSession(null);
    setCustomer(null);
    setCart(null);
    setClarifications([]);
    setFeedback([]);
    setProducts([]);
    setSearch('');
    setCategory(null);
    setConfirmKey(null);
    setIdleLeft(null);
    setError(message);
    setScreen('identify');
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code.startsWith('SESSION')) return resetToIdentify(e.message);
      if (e instanceof ApiError && e.code.startsWith('DEVICE')) {
        setScreen('setup');
        return setError(e.message);
      }
      setError(e instanceof Error ? e.message : 'صار خطأ');
    },
    [resetToIdentify],
  );

  useEffect(() => {
    const d = readStorage(typeof window !== 'undefined' ? localStorage : undefined, DEVICE_KEY);
    const s = readStorage(typeof window !== 'undefined' ? sessionStorage : undefined, SESSION_KEY);
    setDevice(d);
    if (!d) return setScreen('setup');
    if (s) {
      setSession(s);
      setScreen('shopping');
    } else setScreen('identify');
  }, []);

  const logout = useCallback(async () => {
    if (session) await api('/kiosk/logout', { method: 'POST', headers: headers() }).catch(() => undefined);
    resetToIdentify();
  }, [session, headers, resetToIdentify]);

  const identify = async (nationalId: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sessionToken: string; idleTimeoutSeconds: number; customer: CustomerInfo }>('/kiosk/identify', {
        method: 'POST',
        headers: headers(false),
        body: JSON.stringify({ nationalId }),
      });
      try {
        sessionStorage.setItem(SESSION_KEY, r.sessionToken);
      } catch {}
      lastActivity.current = Date.now();
      setSession(r.sessionToken);
      setCustomer(r.customer);
      setIdleTimeout(r.idleTimeoutSeconds);
      setScreen('shopping');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  // Load session data whenever a session starts (also after a page reload).
  useEffect(() => {
    if (!session || !device) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api<{ customer: CustomerInfo; idleTimeoutSeconds: number; cart: CartView; clarifications: ClarificationView[] }>('/kiosk/session', { headers: headers() });
        const cats = await api<{ categories: string[] }>('/kiosk/categories', { headers: headers() });
        if (cancelled) return;
        setCustomer(s.customer);
        setIdleTimeout(s.idleTimeoutSeconds);
        setCart(s.cart);
        setClarifications(s.clarifications);
        setCategories(cats.categories);
      } catch (e) {
        if (!cancelled) handleError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, device, headers, handleError]);

  // Catalog browsing / touch search.
  useEffect(() => {
    if (!session || screen !== 'shopping') return;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ take: '60' });
        if (search.trim()) params.set('q', search.trim());
        if (category) params.set('category', category);
        const r = await api<{ products: ProductView[] }>(`/kiosk/catalog?${params}`, { headers: headers() });
        setProducts(r.products);
      } catch (e) {
        handleError(e);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [session, screen, search, category, headers, handleError]);

  // ------------------------------------------------------------------ inactivity

  useEffect(() => {
    if (!session || !['shopping', 'review'].includes(screen)) return;
    const onActivity = () => {
      lastActivity.current = Date.now();
      setIdleLeft(null);
      if (Date.now() - lastHeartbeat.current > 30_000) {
        lastHeartbeat.current = Date.now();
        api('/kiosk/heartbeat', { method: 'POST', headers: headers() }).catch(handleError);
      }
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    const timer = setInterval(() => {
      const idle = (Date.now() - lastActivity.current) / 1000;
      const left = Math.ceil(idleTimeout - 5 - idle); // end slightly before the server does
      if (left <= 0) {
        clearInterval(timer);
        void logout();
      } else if (left <= IDLE_WARNING_SECONDS) setIdleLeft(left);
    }, 1000);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      clearInterval(timer);
    };
  }, [session, screen, idleTimeout, headers, handleError, logout]);

  // ------------------------------------------------------------------ cart actions

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      handleError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const applyResult = (r: CommandResult) => {
    setCart(r.cart);
    setClarifications(r.clarifications);
    if (r.searchResults.length) {
      setProducts(r.searchResults);
      setCategory(null);
    }
    setFeedback((f) => [{ id: r.utteranceId, transcript: r.transcript, messages: r.messages }, ...f].slice(0, 4));
  };

  /** Send a FINAL transcript or typed text. Each call gets a fresh utteranceId. */
  const sendCommand = (text: string) =>
    run(async () => {
      const r = await api<CommandResult>('/kiosk/cart/commands', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ utteranceId: newId(), text, source: 'text' }),
      });
      applyResult(r);
    });

  const resolve = (id: string, value: string) =>
    run(async () => applyResult(await api<CommandResult>(`/kiosk/cart/clarifications/${id}/resolve`, { method: 'POST', headers: headers(), body: JSON.stringify({ value }) })));

  const dismiss = (id: string) =>
    run(async () => {
      const r = await api<{ clarifications: ClarificationView[] }>(`/kiosk/cart/clarifications/${id}/dismiss`, { method: 'POST', headers: headers() });
      setClarifications(r.clarifications);
    });

  const addProduct = (p: ProductView, unit: 'piece' | 'carton') =>
    run(async () => {
      const r = await api<{ cart: CartView }>('/kiosk/cart/items', { method: 'POST', headers: headers(), body: JSON.stringify({ productId: p.id, unit, quantity: 1 }) });
      setCart(r.cart);
    });

  const patchLine = (id: string, body: { quantity?: number; unit?: 'piece' | 'carton' }) =>
    run(async () => setCart((await api<{ cart: CartView }>(`/kiosk/cart/items/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) })).cart));

  const removeLine = (id: string) => run(async () => setCart((await api<{ cart: CartView }>(`/kiosk/cart/items/${id}`, { method: 'DELETE', headers: headers() })).cart));

  const openReview = () => {
    setConfirmKey((k) => k ?? newId());
    setScreen('review');
  };

  const confirm = () =>
    run(async () => {
      const key = confirmKey ?? newId();
      setConfirmKey(key);
      const r = await api<{ order: ConfirmedOrder }>('/kiosk/orders/confirm', { method: 'POST', headers: headers(), body: JSON.stringify({ idempotencyKey: key }) });
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {}
      setOrder(r.order);
      setScreen('done');
    });

  useEffect(() => {
    if (screen !== 'done') return;
    const t = setTimeout(() => {
      setOrder(null);
      resetToIdentify();
    }, DONE_SCREEN_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [screen, resetToIdentify]);

  // ------------------------------------------------------------------ render

  if (screen === 'loading') return <div className="p-10 text-center text-xl">…</div>;

  if (screen === 'setup') return <DeviceSetup error={error} onSave={(t) => { try { localStorage.setItem(DEVICE_KEY, t); } catch {} setDevice(t); setError(null); setScreen('identify'); }} />;

  if (screen === 'identify')
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center p-6">
          <Keypad onSubmit={identify} busy={busy} error={error} />
        </div>
      </Shell>
    );

  if (screen === 'done' && order)
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
          <div className="text-6xl">✓</div>
          <h1 className="text-4xl font-bold">تم استلام طلبيتك</h1>
          <p className="text-2xl">رقم الطلبية</p>
          <p data-testid="order-number" className="brand-gradient rounded-2xl px-8 py-4 text-5xl font-bold text-white" dir="ltr">
            {order.orderNumber}
          </p>
          <p className="text-xl">الإجمالي {money(order.total)}</p>
          <p className="text-slate-ink">الطلبية وصلت المستودع. بتقدر تستلمها من الكاونتر.</p>
          <button type="button" onClick={() => { setOrder(null); resetToIdentify(); }} className="h-16 rounded-2xl bg-navy px-10 text-xl text-white">
            إنهاء
          </button>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <header className="flex items-center gap-4 border-b bg-white px-5 py-3">
        <div>
          <div className="text-sm text-slate-ink">أهلاً</div>
          <div data-testid="customer-name" className="text-xl font-bold">
            {customer ? `${customer.name} — ${customer.businessName}` : '…'}
          </div>
        </div>
        <button type="button" onClick={logout} className="ms-auto h-12 rounded-xl px-5 ring-1 ring-black/10">
          خروج
        </button>
      </header>

      {error && (
        <div role="alert" className="mx-5 mt-3 rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      {screen === 'review' && cart ? (
        <Review cart={cart} clarifications={clarifications.length} busy={busy} onBack={() => setScreen('shopping')} onConfirm={confirm} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_460px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <OrderInput onSubmit={sendCommand} busy={busy} />
            {feedback.length > 0 && (
              <div data-testid="feedback" className="rounded-2xl bg-white p-3 ring-1 ring-black/5">
                {feedback.slice(0, 2).map((f) => (
                  <div key={f.id} className="py-1">
                    {f.transcript && <div className="text-sm text-slate-ink">«{f.transcript}»</div>}
                    {f.messages.map((m, i) => (
                      <div key={i} className="font-bold">
                        {m}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <Clarifications items={clarifications} onResolve={resolve} onDismiss={dismiss} busy={busy} />
            <div className="flex flex-wrap gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن منتج…"
                aria-label="بحث"
                className="h-14 min-w-0 flex-1 rounded-xl bg-white px-4 text-lg ring-1 ring-black/10"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <Chip active={!category} onClick={() => setCategory(null)} label="الكل" />
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)} label={c} />
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ProductGrid products={products} onAdd={addProduct} busy={busy} />
            </div>
          </div>
          {cart && (
            <div className="min-h-[60dvh] min-w-0 lg:min-h-0">
              <Cart cart={cart} busy={busy} onQuantity={(id, q) => patchLine(id, { quantity: q })} onUnit={(id, u) => patchLine(id, { unit: u })} onRemove={removeLine} onReview={openReview} />
            </div>
          )}
        </div>
      )}

      {idleLeft !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
          <div className="max-w-md rounded-3xl bg-white p-8 text-center">
            <p className="text-2xl font-bold">لسّا هون؟</p>
            <p className="mt-2 text-lg">رح ننهي الجلسة ونمسح السلة خلال {idleLeft} ثانية</p>
            <button type="button" className="brand-gradient mt-6 h-16 w-full rounded-2xl text-xl font-bold text-white">
              أنا هون، كمّل
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="touch-ui flex h-dvh flex-col">
      {children}
      <footer className="flex justify-center py-1 opacity-70">
        <Image src="/mdarai-lockup.png" alt="Powered by MdarAi" width={140} height={36} style={{ height: 'auto' }} />
      </footer>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-12 shrink-0 rounded-full px-5 ${active ? 'bg-navy text-white' : 'bg-white ring-1 ring-black/10'}`}>
      {label}
    </button>
  );
}

function Review({ cart, clarifications, busy, onBack, onConfirm }: { cart: CartView; clarifications: number; busy: boolean; onBack: () => void; onConfirm: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">راجع طلبيتك</h1>
      {clarifications > 0 && <p className="rounded-xl bg-amber-50 p-3 text-amber-800">في {clarifications} أسئلة ما انجاوبت. ارجع وجاوبها أو تجاهلها قبل التأكيد.</p>}
      <ul data-testid="review-lines" className="flex-1 divide-y overflow-y-auto rounded-2xl bg-white ring-1 ring-black/5">
        {cart.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 p-4 text-lg">
            <span>
              <b>{l.quantity}</b> {l.unit === 'carton' ? 'كرتونة' : 'قطعة'} — {l.nameAr}
            </span>
            <span className="font-bold">{money(l.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-white p-4 text-lg ring-1 ring-black/5">
        <div className="flex justify-between"><span>المجموع</span><span>{money(cart.subtotal)}</span></div>
        <div className="flex justify-between"><span>{cart.pricesIncludeVat ? 'منها ضريبة' : 'ضريبة'}</span><span>{money(cart.vat)}</span></div>
        <div className="flex justify-between text-2xl font-bold"><span>الإجمالي</span><span data-testid="review-total">{money(cart.total)}</span></div>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="h-20 flex-1 rounded-2xl bg-white text-xl ring-1 ring-black/10">
          رجوع للتعديل
        </button>
        <button type="button" disabled={busy || clarifications > 0 || cart.lines.length === 0} onClick={onConfirm} className="brand-gradient h-20 flex-[2] rounded-2xl text-2xl font-bold text-white disabled:opacity-40">
          {busy ? 'لحظة…' : 'تأكيد الطلبية'}
        </button>
      </div>
    </div>
  );
}

function DeviceSetup({ onSave, error }: { onSave: (token: string) => void; error: string | null }) {
  const [v, setV] = useState('');
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">تسجيل جهاز الكشك</h1>
      <p className="text-slate-ink">للموظف فقط: أدخل رمز الجهاز اللي أعطاك ياه المدير. الرمز بينحفظ على هذا التابلت.</p>
      {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
      <input value={v} onChange={(e) => setV(e.target.value.trim())} aria-label="رمز الجهاز" className="h-14 rounded-xl px-4 ring-1 ring-black/10" dir="ltr" />
      <button type="button" disabled={v.length < 8} onClick={() => onSave(v)} className="h-14 rounded-xl bg-navy text-white disabled:opacity-40">
        حفظ
      </button>
    </div>
  );
}
