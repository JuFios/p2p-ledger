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
      <body>{children}</body>
    </html>
  );
}
