import { ConfigService } from '@nestjs/config';

// Чорний список BLOCKED_EMAILS (через кому), без урахування регістру.
export function blockedEmails(config: ConfigService): Set<string> {
  return new Set(
    config
      .get<string>('BLOCKED_EMAILS', '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
