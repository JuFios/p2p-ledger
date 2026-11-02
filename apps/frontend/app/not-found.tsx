import { EmptyState } from '@/components/ui/index';
export default function NotFound() {
  return (
    <main className="page">
      <EmptyState
        level={1}
        title="Рахунок не знайдено"
        description="Перевірте посилання та доступ до рахунку."
        action={
          <a className="button-primary" href="/split-bills">
            До спільних рахунків
          </a>
        }
      />
    </main>
  );
}
