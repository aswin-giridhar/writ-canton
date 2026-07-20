import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_Condensed } from 'next/font/google';
import './globals.css';

/**
 * One superfamily, two voices: condensed sans for institutional signage,
 * mono for the instrument and the transmission log. Plex was drawn for
 * technical and institutional settings, which is the register this needs.
 */
const sans = IBM_Plex_Sans_Condensed({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sans',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Writ — authority is a contract, not a prompt',
  description:
    'Ledger-enforced spending authority for autonomous agents on Canton. '
    + 'Bounds the agent cannot rewrite, invisible to the counterparty.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
