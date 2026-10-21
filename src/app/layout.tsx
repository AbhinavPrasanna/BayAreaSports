import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Bayline — Your Bay, together', description: 'A local MVP for following the Warriors, 49ers, and Golden State Valkyries.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
