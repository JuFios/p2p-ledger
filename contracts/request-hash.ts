import { createHash } from 'crypto';

// Канонічний JSON (ключі відсортовано): хеш не залежить від порядку полів,
// у якому клієнт серіалізував тіло запиту.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

export function hashRequest(request: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(request)))
    .digest('hex');
}
