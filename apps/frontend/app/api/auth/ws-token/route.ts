import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const token = cookies().get('accessToken')?.value;
  if (!token)
    return NextResponse.json({ message: 'Потрібен вхід.' }, { status: 401 });
  return NextResponse.json(
    { token, url: process.env.WS_PUBLIC_URL ?? 'http://localhost:3003' },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
