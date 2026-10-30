import { cookies } from 'next/headers';

const LEDGER_URL = process.env.LEDGER_SERVICE_URL ?? 'http://localhost:3001';

export async function ledgerFetch(path: string, init?: RequestInit) {
  // Токен лежить у httpOnly-куці (див. api/auth/login), тож додаємо його тут.
  const token = cookies().get('accessToken')?.value;
  const res = await fetch(`${LEDGER_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ledger API ${res.status}: ${body}`);
  }
  return res.json();
}
