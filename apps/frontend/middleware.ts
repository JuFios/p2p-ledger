import { NextRequest, NextResponse } from 'next/server';
import { sessionClaims, tokenCookies } from './lib/session';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
const refreshing = new Map<
  string,
  Promise<{ status: number; tokens?: Tokens }>
>();

function refresh(refreshToken: string) {
  const pending = refreshing.get(refreshToken);
  if (pending) return pending;
  const request = (async () => {
    const upstream = await fetch(
      `${process.env.BFF_URL ?? 'http://localhost:3004'}/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
      },
    );
    return {
      status: upstream.status,
      tokens: upstream.ok ? ((await upstream.json()) as Tokens) : undefined,
    };
  })();
  refreshing.set(refreshToken, request);
  // Запізнілі запити зі старою cookie отримують ту саму ротацію.
  void request.then(
    ({ tokens }) => {
      if (!tokens) {
        refreshing.delete(refreshToken);
        return;
      }
      const timer = setTimeout(() => refreshing.delete(refreshToken), 30000);
      (timer as unknown as { unref?: () => void }).unref?.();
    },
    () => refreshing.delete(refreshToken),
  );
  return request;
}

export async function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const reject = () => {
    const res = isApi
      ? NextResponse.json(
          { message: 'Увійдіть до облікового запису.' },
          { status: 401 },
        )
      : NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('accessToken');
    res.cookies.delete('refreshToken');
    return res;
  };
  const claims = sessionClaims(req.cookies.get('accessToken')?.value);
  if (claims && claims.exp * 1000 > Date.now() + 10000)
    return NextResponse.next();
  const refreshToken = req.cookies.get('refreshToken')?.value;
  if (!refreshToken) return reject();
  try {
    const { status, tokens } = await refresh(refreshToken);
    if (status === 401 || status === 403) return reject();
    if (
      status < 200 ||
      status >= 300 ||
      !tokens?.accessToken ||
      !tokens.refreshToken
    )
      throw new Error('invalid tokens');
    req.cookies.set('accessToken', tokens.accessToken);
    req.cookies.set('refreshToken', tokens.refreshToken);
    const res = NextResponse.next({
      request: { headers: new Headers(req.headers) },
    });
    const options = tokenCookies(req.nextUrl.protocol === 'https:');
    res.cookies.set('accessToken', tokens.accessToken, options);
    res.cookies.set('refreshToken', tokens.refreshToken, options);
    return res;
  } catch {
    return NextResponse.json(
      { message: 'Не вдалося оновити сесію. Спробуйте ще раз.' },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: [
    '/wallets/:path*',
    '/transfers/:path*',
    '/split-bills/:path*',
    '/activity/:path*',
    '/admin/:path*',
    '/api/bff/:path*',
    '/api/auth/ws-token',
  ],
};
