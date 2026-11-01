import { bffFetch } from '@/lib/api';
import { Wallet } from '@/lib/types';
import { Wallets } from './wallets';

export default async function WalletsPage() {
  let wallets: Wallet[] = [];
  let error: string | null = null;
  try {
    wallets = await bffFetch<Wallet[]>('/wallets');
  } catch (err) {
    error = (err as Error).message;
  }
  return (
    <main style={{ maxWidth: 600, margin: '48px auto', padding: 16 }}>
      <h1>Мої гаманці</h1>
      <Wallets initial={wallets} initialError={error} />
    </main>
  );
}
