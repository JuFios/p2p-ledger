import { cookies } from 'next/headers';

import { ApiError, readResponse } from './http';
export { ApiError } from './http';

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:3004';

export async function bffFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  // Токен лежить у httpOnly-куці (див. api/auth/login), тож додаємо його тут.
  const token = cookies().get('accessToken')?.value;
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${BFF_URL}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(8000),
      redirect: 'manual',
    });
  } catch {
    throw new ApiError(503, 'Сервіс тимчасово недоступний. Спробуйте ще раз.');
  }
  return readResponse<T>(res);
}
