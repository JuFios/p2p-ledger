import { NextRequest, NextResponse } from 'next/server';
import { ApiError, bffFetch } from '@/lib/api';
import { crossOriginRejected, isSameOrigin } from '@/lib/same-origin';
import { isTokenPair, tokenCookies } from '@/lib/session';

// Проксі до BFF, щоб зберігати токени в httpOnly cookie,
// а не в localStorage на клієнті.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return crossOriginRejected();
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
    const tokens = await bffFetch<unknown>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : undefined,
    });
    if (!isTokenPair(tokens)) {
      return NextResponse.json({ error: 'Некоректна відповідь сервісу.' }, { status: 502 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set('accessToken', tokens.accessToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    res.cookies.set('refreshToken', tokens.refreshToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    return res;
  } catch (err) {
    // Відповідь BFF (зокрема 401 за невірних даних) передаємо як є. Інший збій —
    // далі: Next.js відповість 500 без подробиць і запише помилку в лог.
    if (!(err instanceof ApiError)) throw err;
    const res = NextResponse.json({ error: err.message }, { status: err.status });
    // Клієнт має знати, скільки чекати після ліміту спроб.
    if (err.retryAfter) res.headers.set('Retry-After', err.retryAfter);
    return res;
  }
}
