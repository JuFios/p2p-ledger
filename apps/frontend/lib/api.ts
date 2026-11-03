import { BFF_URL, FRONTEND_TIMEOUT_MS } from './server-config';
import { cookies } from 'next/headers';

import { ApiError, readResponse } from './http';
export { ApiError } from './http';


export async function bffFetch<T>(
  path: string,
  init?: RequestInit,
  parse?: (value: unknown) => T,
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
      signal: init?.signal ?? AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch {
    throw new ApiError(503, 'Сервіс тимчасово недоступний. Спробуйте ще раз.');
  }
  const value = await readResponse<T>(res);
  return parse ? parse(value) : value;
}
