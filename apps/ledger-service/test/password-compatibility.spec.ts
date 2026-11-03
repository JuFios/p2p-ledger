import * as bcrypt from 'bcrypt';

// Фікстура створена bcrypt 5.1.1 до переходу на нові native binaries.
it('preserves existing password hashes across the native dependency update', async () => {
  const hash = "$2b$10$uQw4PSdY3o1rWZSDCO6BKuShTGTZmfOusBkY7xlg6nKjchjRo1gz2";
  await expect(bcrypt.compare("Пароль-compatibility-123", hash)).resolves.toBe(true);
  await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);
});
