import { PageHeading } from '@/components/ui/index';
import { bffFetch } from '@/lib/api';
import { Wallet } from '@/lib/types';
import { Wallets } from '@/app/wallets/wallets';

export default async function WalletsPage() {
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
        title="Мої гаманці"
        description="Усі валюти в одному місці. Баланс оновлюється наживо."
      />
      <Wallets initial={wallets} initialError={error} />
    </main>
  );
}
