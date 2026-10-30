import { cookies } from 'next/headers';

const LEDGER_URL = process.env.LEDGER_SERVICE_URL ?? 'http://localhost:3001';

export async function ledgerFetch(path: string, init?: RequestInit) {
  // Токен лежить у httpOnly-куці (див. api/auth/login), тож додаємо його тут.
  const token = cookies().get('accessToken')?.value;
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${LEDGER_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ledger API ${res.status}: ${body}`);
  }
  return res.json();
}
