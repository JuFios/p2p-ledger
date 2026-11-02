'use client';

import { useState } from 'react';
import { Alert, Brand, Card } from '@/components/ui/index';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error('Не вдалося зареєструватись');
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
          <h1 className="text-2xl">Реєстрація</h1>
          <p className="muted mb-7 mt-2">
            Створіть акаунт і тримайте свої перекази під контролем.
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
                placeholder="Пароль (мін. 8 символів)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <Alert>{error}</Alert>}
            <button className="button-primary w-full" type="submit">
              Зареєструватись
            </button>
          </form>
        </Card>
        <p className="muted mt-6 text-center">
          Уже маєте акаунт?{' '}
          <a className="text-link" href="/login">
            Увійти
          </a>
        </p>
        <p className="mt-8 text-center text-xs text-muted">
          Ваші гроші. Зрозумілий рух коштів.
        </p>
      </div>
    </main>
  );
}
