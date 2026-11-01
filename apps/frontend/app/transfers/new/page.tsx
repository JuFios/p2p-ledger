import { bffFetch } from '@/lib/api';
import { Wallet } from '@/lib/types';
import { TransferForm } from './transfer-form';

export default async function NewTransferPage() {
  let wallets: Wallet[] = [];
  let error: string | null = null;
  try {
    wallets = await bffFetch<Wallet[]>('/wallets');
  } catch (err) {
    error = (err as Error).message;
  }
  return (
    <main style={{ maxWidth: 600, margin: '48px auto', padding: 16 }}>
      <h1>Новий переказ</h1>
      <TransferForm initialWallets={wallets} initialError={error} />
    </main>
  );
}
