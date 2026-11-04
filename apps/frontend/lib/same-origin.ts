import { NextRequest, NextResponse } from 'next/server';

// Мутації приймаються лише зі сторінок цього ж сайту: Origin має збігатися з
// Host і протоколом запиту. Інакше крос-сайтова форма могла б, наприклад,
// залогінити користувача в чужий акаунт.
export function isSameOrigin(req: NextRequest): boolean {
  try {
    const origin = new URL(req.headers.get('origin') ?? '');
    return (
      origin.host === req.headers.get('host') &&
      origin.protocol === req.nextUrl.protocol
    );
  } catch {
    return false;
  }
}

export function crossOriginRejected() {
  return NextResponse.json(
    { message: 'Недозволене джерело запиту.' },
    { status: 403 },
  );
}
