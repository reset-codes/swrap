import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: {
    default: 'Swrap — Structured communication for modern communities',
    template: '%s | Swrap',
  },
  description:
    'Create forms, collect submissions, and manage feedback with Walrus-native storage and private access control.',
  keywords: ['forms', 'feedback', 'submissions', 'walrus', 'seal', 'structured communication'],
  authors: [{ name: 'Swrap' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL,
    siteName: 'Swrap',
    title: 'Swrap — Structured communication for modern communities',
    description:
      'Create forms, collect submissions, and manage feedback with Walrus-native storage and private access control.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Swrap — Structured communication for modern communities',
    description:
      'Create forms, collect submissions, and manage feedback with Walrus-native storage and private access control.',
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
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              color: '#111827',
              fontFamily: 'var(--font-geist)',
              fontSize: '0.875rem',
            },
            duration: 4000,
          }}
        />
      </body>
    </html>
  );
}
