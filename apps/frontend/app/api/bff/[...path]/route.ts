import { BFF_URL, FRONTEND_TIMEOUT_MS } from '@/lib/server-config';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

async function proxy(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const origin = req.headers.get('origin');
  let sameOrigin = false;
  try {
    const source = new URL(origin ?? '');
    sameOrigin =
      source.host === req.headers.get('host') &&
      source.protocol === req.nextUrl.protocol;
  } catch {}
  if (req.method !== 'GET' && !sameOrigin) {
    return NextResponse.json(
      { message: 'Недозволене джерело запиту.' },
      { status: 403 },
    );
  }
  const allowed = [
    'wallets',
    'transfers',
    'split-bills',
    'activity',
    'dashboard',
    'admin',
  ];
  if (
    !allowed.includes(params.path[0]) ||
    params.path.some(
      (part) => part === '.' || part === '..' || part.includes('/'),
    )
  ) {
    return NextResponse.json(
      { message: 'Маршрут не знайдено.' },
      { status: 404 },
    );
  }
  const token = cookies().get('accessToken')?.value;
  if (!token)
    return NextResponse.json({ message: 'Потрібен вхід.' }, { status: 401 });
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  const key = req.headers.get('Idempotency-Key');
  if (key !== null) headers.set('Idempotency-Key', key);
  try {
    const res = await fetch(
      `${BFF_URL}/${params.path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`,
      {
        method: req.method,
        headers,
        body: req.method === 'GET' ? undefined : await req.text(),
        cache: 'no-store',
        signal: AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
        redirect: 'manual',
      },
    );
    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      {
        message:
          'Сервіс тимчасово недоступний. Повторіть запит із тим самим ключем.',
      },
      { status: 503 },
    );
  }
}

export { proxy as GET, proxy as POST };
