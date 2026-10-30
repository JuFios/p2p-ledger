import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

// Адмін створюється з ADMIN_EMAIL / ADMIN_PASSWORD на старті (AuthService
// не змінюємо). Env — джерело істини: якщо такий email уже зареєстровано,
// пароль перезаписується, а refresh-токени відкликаються, — інакше той, хто
// встиг зареєструвати цей email, отримав би роль admin.
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
    const passwordHash = await bcrypt.hash(password, 10);
    await this.dataSource.query(
      `INSERT INTO users (email, "passwordHash", role) VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash",
         role = 'admin', "refreshTokenHash" = NULL`,
      [email, passwordHash],
    );
  }
}
