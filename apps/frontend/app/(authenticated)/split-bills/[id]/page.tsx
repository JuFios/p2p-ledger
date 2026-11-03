import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ApiError, bffFetch } from '@/lib/api';
import { sessionClaims } from '@/lib/session';
import { parseBill, parseList, parseWallet, SplitBill, Wallet } from '@/lib/types';
import { uuid } from '@/lib/validation';
import { BillDetails } from '@/app/split-bills/[id]/bill-details';

export default async function BillPage({ params }: { params: { id: string } }) {
  const userId = sessionClaims(cookies().get('accessToken')?.value)?.sub ?? '';
  if (!uuid(params.id)) notFound();
  let bill: SplitBill;
  try {
    bill = await bffFetch<SplitBill>(`/split-bills/${params.id}`, undefined, parseBill);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  let wallets: Wallet[] = [];
  let error: string | null = null;
  try {
    wallets = await bffFetch<Wallet[]>('/wallets', undefined, parseList(parseWallet));
  } catch (err) {
    error = (err as Error).message;
  }
  const email = sessionClaims(cookies().get('accessToken')?.value)?.email ?? '';
  return (
    <main className="page">
      <BillDetails
        key={userId}
        userId={userId}
        initial={bill}
        initialWallets={wallets}
        email={email}
        initialError={error}
      />
    </main>
  );
}
