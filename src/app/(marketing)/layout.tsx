import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEALBASE — Walrus-Native Form Infrastructure',
  description:
    'Collect feedback, bug reports, and surveys. All data stored on Walrus. No wallet required for submitters.',
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
