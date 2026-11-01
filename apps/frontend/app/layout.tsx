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
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <nav aria-label="Головна навігація" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <a href="/wallets">Гаманці</a>
          <a href="/transfers/new">Переказ</a>
          <a href="/split-bills">Спільні рахунки</a>
          <a href="/activity">Активність</a>
          <a href="/admin">Адміністрування</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
