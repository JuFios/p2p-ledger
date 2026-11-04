import { crossOriginRejected, isSameOrigin } from '@/lib/same-origin';
import { BFF_URL, FRONTEND_TIMEOUT_MS } from '@/lib/server-config';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return crossOriginRejected();
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
