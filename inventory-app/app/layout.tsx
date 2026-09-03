import type { Metadata } from 'next';
import { Inter, Oswald } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: '24/7 Inventory Operations',
  description: 'Inventory and purchasing operations for 24/7 Truck Tyre Services.',
};

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const oswald = Oswald({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-oswald', display: 'swap' });

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-AU" className={`${inter.variable} ${oswald.variable}`}>
      <body>{children}</body>
    </html>
  );
}
