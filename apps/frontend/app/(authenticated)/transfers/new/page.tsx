import { sessionClaims } from '@/lib/session';
import { cookies } from 'next/headers';
import { PageHeading } from '@/components/ui/index';
import { bffFetch } from '@/lib/api';
import { Wallet } from '@/lib/types';
import { TransferForm } from '@/app/transfers/new/transfer-form';

export default async function NewTransferPage() {
  const userId = sessionClaims(cookies().get('accessToken')?.value)?.sub ?? '';
  let wallets: Wallet[] = [];
  let error: string | null = null;
  try {
    wallets = await bffFetch<Wallet[]>('/wallets');
  } catch (err) {
    error = (err as Error).message;
  }
  return (
    <main className="page">
      <PageHeading
        title="Новий переказ"
        description="Надсилайте кошти за email і стежте за кожним кроком."
      />
      <TransferForm
        key={userId}
        userId={userId}
        initialWallets={wallets}
        initialError={error}
      />
    </main>
  );
}
