import { NextRequest, NextResponse } from 'next/server';
import { ApiError, bffFetch } from '@/lib/api';
import { crossOriginRejected, isSameOrigin } from '@/lib/same-origin';
import { isTokenPair, tokenCookies } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return crossOriginRejected();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Некоректне тіло запиту.' }, { status: 400 });
  }
  try {
    const tokens = await bffFetch<unknown>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!isTokenPair(tokens)) {
      return NextResponse.json({ error: 'Некоректна відповідь сервісу.' }, { status: 502 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set('accessToken', tokens.accessToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    res.cookies.set('refreshToken', tokens.refreshToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    return res;
  } catch (err) {
    // Відповідь BFF передаємо як є; інший збій — далі, Next.js відповість 500.
    if (!(err instanceof ApiError)) throw err;
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
