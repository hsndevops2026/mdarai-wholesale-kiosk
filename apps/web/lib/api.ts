export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: { ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'انقطع الاتصال بالخادم. حاول مرة ثانية');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'صار خطأ');
  return body as T;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function money(v: string | null | undefined): string {
  return v == null ? '—' : `${Number(v).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
}

/** Authenticated file download (used for Excel templates/exports). */
export async function download(path: string, headers: Record<string, string>, fileName: string): Promise<void> {
  const res = await fetch(`${API_URL}/api${path}`, { headers, cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'فشل التنزيل');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
