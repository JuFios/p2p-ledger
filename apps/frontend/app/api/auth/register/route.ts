import { NextRequest, NextResponse } from 'next/server';
import { ApiError, bffFetch } from '@/lib/api';
import { tokenCookies } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tokens = await bffFetch<{ accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set('accessToken', tokens.accessToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    res.cookies.set('refreshToken', tokens.refreshToken, tokenCookies(req.nextUrl.protocol === 'https:'));
    return res;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: err instanceof ApiError ? err.status : 400 });
  }
}
