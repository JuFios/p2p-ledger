export interface SessionClaims {
  sub: string;
  email: string;
  role?: string;
  exp: number;
}

// Лише для строку сесії й UI; підпис і права перевіряє BFF та сервіс-власник.
export function sessionClaims(token?: string): SessionClaims | null {
  try {
    const part = token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(part), (byte) => byte.charCodeAt(0)),
    ));
    return typeof value.sub === 'string' && typeof value.exp === 'number'
      ? value
      : null;
  } catch {
    return null;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Відповідь BFF стає сесією, лише якщо обидва токени — непорожні рядки.
export function isTokenPair(value: unknown): value is TokenPair {
  const pair = value as Partial<Record<keyof TokenPair, unknown>> | null;
  return (
    typeof pair?.accessToken === 'string' &&
    pair.accessToken !== '' &&
    typeof pair.refreshToken === 'string' &&
    pair.refreshToken !== ''
  );
}

export function tokenCookies(secure: boolean) {
  return { httpOnly: true, path: '/', sameSite: 'lax' as const, secure };
}
