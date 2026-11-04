'use client';

import { useState } from 'react';
import { Alert, Brand, Card } from '@/components/ui/index';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 429) {
        const wait = res.headers.get('Retry-After');
        throw new Error(
          `Забагато спроб входу. Спробуйте ${wait ? `через ${wait} с` : 'пізніше'}.`,
        );
      }
      if (!res.ok) throw new Error('Невірний email або пароль');
      router.push('/wallets');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <Card>
          <h1 className="text-2xl">Вхід</h1>
          <p className="muted mb-7 mt-2">
            Раді бачити вас знову. Увійдіть до своїх гаманців.
          </p>
          <form onSubmit={onSubmit} className="grid gap-5">
            <label className="block text-sm font-medium">
              Email
              <input
                className="control mt-2"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Пароль
              <input
                className="control mt-2"
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <Alert>{error}</Alert>}
            <button className="button-primary w-full" type="submit">
              Увійти
            </button>
          </form>
        </Card>
        <p className="muted mt-6 text-center">
          Немає акаунта?{' '}
          <a className="text-link" href="/register">
            Зареєструватись
          </a>
        </p>
        <p className="mt-8 text-center text-xs text-muted">
          Ваші гроші. Зрозумілий рух коштів.
        </p>
      </div>
    </main>
  );
}
