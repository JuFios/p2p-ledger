import { NextRequest, NextResponse } from 'next/server';
import { ApiError, bffFetch } from '@/lib/api';
import { tokenCookies } from '@/lib/session';

// Проксі до BFF, щоб зберігати токени в httpOnly cookie,
// а не в localStorage на клієнті.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Некоректне тіло запиту.' }, { status: 400 });
  }
  try {
    // IP клієнта для ліміту логіну в ledger; next start заповнює x-forwarded-for
    // адресою з'єднання, якщо його не задав proxy попереду.
    const forwardedFor = req.headers.get('x-forwarded-for');
    const tokens = await bffFetch<{ accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : undefined,
    });
    if (!tokens?.accessToken || !tokens.refreshToken) {
      return NextResponse.json({ error: 'Некоректна відповідь сервісу.' }, { status: 502 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set('accessToken', tokens.accessToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    res.cookies.set('refreshToken', tokens.refreshToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    return res;
  } catch (err) {
    const res = NextResponse.json({ error: (err as Error).message }, { status: err instanceof ApiError ? err.status : 401 });
    // Клієнт має знати, скільки чекати після ліміту спроб.
    if (err instanceof ApiError && err.retryAfter) res.headers.set('Retry-After', err.retryAfter);
    return res;
  }
}
