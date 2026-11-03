// Значення локального .env.example явні; пропущений параметр не підміняємо
// публічним секретом. Повідомлення містять лише назви параметрів.
export function validateRequiredConfig(config: Record<string, unknown>, required: string[]) {
  for (const name of required) {
    if (typeof config[name] !== 'string' || !(config[name] as string).trim())
      throw new Error(`${name}: required non-blank value`);
  }
  if (config.NODE_ENV !== undefined && !['development', 'test', 'production'].includes(String(config.NODE_ENV)))
    throw new Error('NODE_ENV: expected development, test or production');
  if (config.NODE_ENV === 'production') {
    for (const name of required.filter(name => name.endsWith('_SECRET') || name === 'INTERNAL_API_TOKEN')) {
      const value = config[name] as string;
      if (value.startsWith('change-me-') || value.length < 32)
        throw new Error(`${name}: production requires a non-placeholder secret of at least 32 characters`);
    }
    if (required.includes('ADMIN_PASSWORD')) {
      const value = config.ADMIN_PASSWORD as string;
      if (value.startsWith('change-me-') || value.length < 12)
        throw new Error('ADMIN_PASSWORD: production requires a non-placeholder password of at least 12 characters');
    }
  }
}
