export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isDefinitiveRejection(status: number) {
  return (
    status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)
  );
}

export async function readResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body?.message ?? body?.error ?? `Помилка запиту (${res.status})`;
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join(', ') : String(message),
    );
  }
  return body as T;
}

export async function clientFetch<T>(
  path: string,
  init?: RequestInit,
  parse?: (value: unknown) => T,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api/bff${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const value = await readResponse<T>(res);
  return parse ? parse(value) : value;
}
