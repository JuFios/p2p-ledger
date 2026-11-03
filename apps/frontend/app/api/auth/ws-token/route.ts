import { WS_PUBLIC_URL } from '@/lib/server-config';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const token = cookies().get('accessToken')?.value;
  if (!token)
    return NextResponse.json({ message: 'Потрібен вхід.' }, { status: 401 });
  return NextResponse.json(
    { token, url: WS_PUBLIC_URL },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
