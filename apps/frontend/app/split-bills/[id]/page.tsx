import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ApiError, bffFetch } from '@/lib/api';
import { sessionClaims } from '@/lib/session';
import { SplitBill, Wallet } from '@/lib/types';
import { uuid } from '@/lib/validation';
import { BillDetails } from './bill-details';

export default async function BillPage({ params }: { params: { id: string } }) {
  if (!uuid(params.id)) notFound();
  let bill: SplitBill;
  try {
    bill = await bffFetch<SplitBill>(`/split-bills/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  let wallets: Wallet[] = [];
  let error: string | null = null;
  try {
    wallets = await bffFetch<Wallet[]>('/wallets');
  } catch (err) {
    error = (err as Error).message;
  }
  const email = sessionClaims(cookies().get('accessToken')?.value)?.email ?? '';
  return (
    <main style={{ maxWidth: 680, margin: '48px auto', padding: 16 }}>
      <BillDetails
        initial={bill}
        initialWallets={wallets}
        email={email}
        initialError={error}
      />
    </main>
  );
}
