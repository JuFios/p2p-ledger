import { parseList, parseWallet, Wallet } from '@/lib/types';
import { sessionClaims } from '@/lib/session';
import { cookies } from 'next/headers';
import { PageHeading } from '@/components/ui/index';
import { bffFetch } from '@/lib/api';
import { Wallets } from '@/app/wallets/wallets';

export default async function WalletsPage() {
  const userId = sessionClaims(cookies().get('accessToken')?.value)?.sub ?? '';
  let wallets: Wallet[] = [];
  let error: string | null = null;
  try {
    wallets = await bffFetch<Wallet[]>('/wallets', undefined, parseList(parseWallet));
  } catch (err) {
    error = (err as Error).message;
  }
  return (
    <main className="page">
      <PageHeading
        title="Мої гаманці"
        description="Усі валюти в одному місці. Баланс оновлюється наживо."
      />
      <Wallets
        key={userId}
        userId={userId}
        initial={wallets}
        initialError={error}
      />
    </main>
  );
}
