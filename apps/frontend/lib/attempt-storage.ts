export interface StoredAttempt<T = string> {
  key: string;
  body: T;
}
const prefix = 'p2p-ledger:';

export function readAttempt<T extends StoredAttempt<unknown>>(
  scope: string,
): T | null {
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
export function writeAttempt(scope: string, value: StoredAttempt<unknown>) {
  try {
    window.sessionStorage.setItem(prefix + scope, JSON.stringify(value));
  } catch {}
}
export function clearAttempt(scope: string) {
  try {
    window.sessionStorage.removeItem(prefix + scope);
  } catch {}
}
