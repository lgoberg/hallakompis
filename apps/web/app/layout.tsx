import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kompis · hallakompis',
  description: 'Goberg sin personlige assistent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
