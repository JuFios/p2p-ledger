import { BFF_URL, FRONTEND_TIMEOUT_MS } from '@/lib/server-config';
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
      await fetch(`${BFF_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
      });
    } catch {}
  }
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  res.cookies.delete('accessToken');
  res.cookies.delete('refreshToken');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
