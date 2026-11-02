import '@fontsource-variable/inter';
import './globals.css';
import { cookies } from 'next/headers';
import { sessionClaims } from '@/lib/session';
import { AppHeader } from '@/components/app-header';

export const metadata = {
  title: 'P2P Ledger',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = sessionClaims(cookies().get('accessToken')?.value);
  const links = [
    { href: '/wallets', label: 'Гаманці' },
    { href: '/transfers/new', label: 'Переказ' },
    { href: '/split-bills', label: 'Спільні рахунки' },
    { href: '/activity', label: 'Активність' },
    ...(user?.role === 'admin' ? [{ href: '/admin', label: 'Адміністрування' }] : []),
  ];
  return (
    <html lang="uk">
      <body>
        <AppHeader email={user?.email ?? ''} role={user?.role} links={links}/>
        {children}
      </body>
    </html>
  );
}
