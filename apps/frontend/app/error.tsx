'use client';
import { Alert, Button, EmptyState } from '@/components/ui/index';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <EmptyState
        level={1}
        title="Не вдалося завантажити сторінку"
        description="Перевірте підключення. Дані можна завантажити повторно."
        action={<Button onClick={reset}>Спробувати ще раз</Button>}
      />
      <div className="mt-5">
        <Alert>Спробуйте ще раз або перевірте підключення.</Alert>
      </div>
    </main>
  );
}
