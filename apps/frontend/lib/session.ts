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
    const value = JSON.parse(atob(part));
    return typeof value.sub === 'string' && typeof value.exp === 'number'
      ? value
      : null;
  } catch {
    return null;
  }
}

export function tokenCookies(secure: boolean) {
  return { httpOnly: true, path: '/', sameSite: 'lax' as const, secure };
}
