import { bffFetch } from '@/lib/api';
import { SplitBill } from '@/lib/types';
import { CreateBillForm } from './create-form';

export default async function SplitBillsPage() {
  const bills = await bffFetch<SplitBill[]>('/split-bills');
  return (
    <main style={{ maxWidth: 680, margin: '48px auto', padding: 16 }}>
      <h1>Спільні рахунки</h1>
      {bills.length === 0 && <p>Рахунків поки немає.</p>}
      <ul>
        {bills.map((bill) => (
          <li key={bill.id} style={{ marginBottom: 12 }}>
            <a href={`/split-bills/${bill.id}`}>{bill.title}</a> ·{' '}
            {bill.totalAmount} {bill.currency} · {bill.status}
          </li>
        ))}
      </ul>
      <CreateBillForm />
    </main>
  );
}
