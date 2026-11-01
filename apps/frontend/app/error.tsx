'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main style={{ maxWidth: 600, margin: '48px auto', padding: 16 }}>
      <h1>Не вдалося завантажити сторінку</h1>
      <p role="alert">Спробуйте ще раз або перевірте підключення.</p>
      <button onClick={reset}>Повторити</button>
    </main>
  );
}
