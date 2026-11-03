import { LocalTime } from '@/components/local-time';
import { sessionClaims } from '@/lib/session';
import { cookies } from 'next/headers';
import { bffFetch } from '@/lib/api';
import { parseBill, parseList, SplitBill } from '@/lib/types';
import { money, statusLabels } from '@/lib/format';
import { Badge, Card, EmptyState, PageHeading } from '@/components/ui/index';
import { CreateBillForm } from '@/app/split-bills/create-form';
export default async function SplitBillsPage() {
  const userId = sessionClaims(cookies().get('accessToken')?.value)?.sub ?? '';
  const bills = await bffFetch<SplitBill[]>('/split-bills', undefined, parseList(parseBill));
  return (
    <main className="page">
      <PageHeading
        title="Спільні рахунки"
        description="Діліть витрати з друзями та стежте за оплатою кожної частки."
        action={
          <a className="button-primary" href="#create-bill">
            Створити рахунок
          </a>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          {!bills.length && (
            <EmptyState
              title="Рахунків поки немає"
              description="Створіть перший рахунок, щоб розділити витрати з друзями."
              action={
                <a className="button-secondary" href="#create-bill">
                  Додати спільну витрату
                </a>
              }
            />
          )}
          {bills.map((bill) => {
            const paid = bill.shares.filter((s) => s.status === 'PAID').length;
            const overdue =
              !!bill.dueAt &&
              new Date(bill.dueAt).getTime() < Date.now() &&
              bill.status !== 'SETTLED';
            return (
              <Card key={bill.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a
                      className="text-link break-words text-lg"
                      href={`/split-bills/${bill.id}`}
                    >
                      {bill.title}
                    </a>
                    <p className="muted mt-1 break-all">
                      Ініціатор: {bill.creatorEmail}
                    </p>
                  </div>
                  <Badge tone={bill.status === 'SETTLED' ? 'positive' : 'info'}>
                    {statusLabels[bill.status] ?? bill.status}
                  </Badge>
                </div>
                <p className="amount my-5 text-2xl font-semibold">
                  {money(bill.totalAmount)}{' '}
                  <span className="text-sm text-muted">{bill.currency}</span>
                </p>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-label="Сплачені частки"
                  aria-valuenow={paid}
                  aria-valuemin={0}
                  aria-valuemax={bill.shares.length}
                >
                  <div
                    className="h-full rounded-full bg-positive"
                    style={{
                      width: `${bill.shares.length ? (paid / bill.shares.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>
                    Сплачено {paid} із {bill.shares.length}
                  </span>
                  {bill.dueAt && (
                    <span
                      className={overdue ? 'font-medium text-negative' : ''}
                    >
                      {overdue ? 'Прострочено · ' : 'До '}
                      <LocalTime value={bill.dueAt} format="datetime" />
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        <div className="lg:col-span-5">
          <CreateBillForm key={userId} userId={userId} />
        </div>
      </div>
    </main>
  );
}
