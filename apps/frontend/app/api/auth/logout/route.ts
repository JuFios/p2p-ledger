import { httpBudget } from '@/lib/http-budget';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  let sameOrigin = false;
  try {
    const origin = new URL(req.headers.get('origin') ?? '');
    sameOrigin = origin.host === req.headers.get('host') && origin.protocol === req.nextUrl.protocol;
  } catch {}
  if (!sameOrigin) return NextResponse.json({ message: 'Недозволене джерело запиту.' }, { status: 403 });
  const refreshToken = req.cookies.get('refreshToken')?.value;
  if (refreshToken) {
    try {
      await fetch(`${process.env.BFF_URL ?? 'http://localhost:3004'}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(httpBudget(Number(process.env.CB_TIMEOUT_MS ?? 3000)).frontend),
      });
    } catch {}
  }
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.cookies.delete('accessToken');
  res.cookies.delete('refreshToken');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
