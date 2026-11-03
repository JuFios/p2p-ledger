// Значення локального .env.example явні; пропущений параметр не підміняємо
// публічним секретом. Повідомлення містять лише назви параметрів.
export function validateRequiredConfig(
  config: Record<string, unknown>,
  required: string[],
  passwordNames: readonly string[] = [],
) {
  for (const name of required) {
    if (typeof config[name] !== 'string' || !(config[name] as string).trim()) {
      throw new Error(`${name}: required non-blank value`);
    }
  }
  const validNodeEnv = config.NODE_ENV === undefined ||
    ['development', 'test', 'production'].includes(String(config.NODE_ENV));
  if (!validNodeEnv) {
    throw new Error('NODE_ENV: expected development, test or production');
  }
  if (config.NODE_ENV === 'production') {
    const secretNames = required.filter(name =>
      name.endsWith('_SECRET') || name === 'INTERNAL_API_TOKEN');
    for (const name of secretNames) {
      const value = config[name] as string;
      if (value.startsWith('change-me-') || value.length < 32) {
        throw new Error(
          `${name}: production requires a non-placeholder secret of at least 32 characters`,
        );
      }
    }
    for (const name of required.filter(name => passwordNames.includes(name))) {
      const value = config[name] as string;
      if (value.startsWith('change-me-') || value.length < 12) {
        throw new Error(
          `${name}: production requires a non-placeholder password of at least 12 characters`,
        );
      }
    }
  }
}
