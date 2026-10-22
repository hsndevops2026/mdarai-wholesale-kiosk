import Link from 'next/link';

export default function Home() {
  const links = [
    { href: '/kiosk', title: 'كشك الطلبيات', desc: 'شاشة الزبون على التابلت' },
    { href: '/warehouse', title: 'لوحة المستودع', desc: 'الطلبيات الواردة والطباعة' },
    { href: '/admin', title: 'الإدارة', desc: 'استيراد المنتجات والأسعار من إكسل' },
  ];
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">MdarAi — نظام طلبيات الجملة</h1>
      <p className="text-slate-ink">نسخة تجريبية ببيانات وهمية.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 hover:ring-brand-indigo">
            <div className="text-xl font-bold">{l.title}</div>
            <div className="mt-1 text-sm text-slate-ink">{l.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
