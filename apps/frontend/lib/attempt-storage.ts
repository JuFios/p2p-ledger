export interface StoredAttempt<T = string> {
  key: string;
  body: T;
}
const prefix = 'p2p-ledger:';

export function attemptScope(userId: string, scope: string): string | null {
  return userId ? `v2:${userId}:${scope}` : null;
}

export function readAttempt<T extends StoredAttempt<unknown>>(
  scope: string | null,
): T | null {
  if (!scope) return null;
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(prefix + scope) ?? 'null',
    );
    if (
      !value ||
      typeof value.key !== 'string' ||
      !value.key.length ||
      value.key.length > 128 ||
      !Object.hasOwn(value, 'body')
    )
      return null;
    return value as T;
  } catch {
    return null;
  }
}
export function writeAttempt(scope: string | null, value: StoredAttempt<unknown>) {
  if (!scope) return;
  try {
    window.sessionStorage.setItem(prefix + scope, JSON.stringify(value));
  } catch {}
}
export function clearAttempt(scope: string | null) {
  if (!scope) return;
  try {
    window.sessionStorage.removeItem(prefix + scope);
  } catch {}
}
