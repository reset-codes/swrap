import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Swrap — Structured communication for modern communities',
  description:
    'Create forms, collect submissions, and manage feedback with Walrus-native storage and private access control.',
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
