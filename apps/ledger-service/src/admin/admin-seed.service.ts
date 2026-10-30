import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

// Адмін створюється з ADMIN_EMAIL / ADMIN_PASSWORD на старті (AuthService
// не змінюємо). Env — джерело істини: якщо такий email уже зареєстровано,
// пароль перезаписується, а refresh-токени відкликаються, — інакше той, хто
// встиг зареєструвати цей email, отримав би роль admin. Роль admin у будь-якого
// іншого акаунта знімається (наприклад, після зміни ADMIN_EMAIL).
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD не задані — адміна не створено');
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE users SET role = 'user', "refreshTokenHash" = NULL
         WHERE role = 'admin' AND email <> $1`,
        [email],
      );
      const [existing]: { role: string; passwordHash: string }[] =
        await manager.query(
          `SELECT role, "passwordHash" FROM users WHERE email = $1`,
          [email],
        );
      // Адмін з тим самим паролем: нічого не змінюємо, сесії лишаються.
      if (
        existing?.role === 'admin' &&
        (await bcrypt.compare(password, existing.passwordHash))
      ) {
        return;
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await manager.query(
        `INSERT INTO users (email, "passwordHash", role) VALUES ($1, $2, 'admin')
         ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash",
           role = 'admin', "refreshTokenHash" = NULL`,
        [email, passwordHash],
      );
    });
  }
}
