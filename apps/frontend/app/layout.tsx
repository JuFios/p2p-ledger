import '@fontsource-variable/inter';
import './globals.css';

export const metadata = {
  title: 'P2P Ledger',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body>
        <nav aria-label="Головна навігація" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <a href="/wallets">Гаманці</a>
          <a href="/transfers/new">Переказ</a>
          <a href="/split-bills">Спільні рахунки</a>
          <a href="/activity">Активність</a>
          <a href="/admin">Адміністрування</a>
          <form method="post" action="/api/auth/logout"><button type="submit">Вийти</button></form>
        </nav>
        {children}
      </body>
    </html>
  );
}
