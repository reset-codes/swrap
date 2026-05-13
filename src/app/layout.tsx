import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: {
    default: 'SEALBASE — Walrus-Native Form Infrastructure',
    template: '%s | SEALBASE',
  },
  description:
    'Decentralized feedback and form infrastructure for Web3 teams. Web2 UX, Web3 infrastructure.',
  keywords: ['forms', 'feedback', 'walrus', 'seal', 'web3', 'decentralized'],
  authors: [{ name: 'SEALBASE' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL,
    siteName: 'SEALBASE',
    title: 'SEALBASE — Walrus-Native Form Infrastructure',
    description:
      'Decentralized feedback and form infrastructure for Web3 teams. Web2 UX, Web3 infrastructure.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SEALBASE — Walrus-Native Form Infrastructure',
    description:
      'Decentralized feedback and form infrastructure for Web3 teams. Web2 UX, Web3 infrastructure.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              color: '#111827',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
            },
            duration: 4000,
          }}
          richColors
        />
      </body>
    </html>
  );
}
