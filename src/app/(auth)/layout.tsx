import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
};

// Full-height centered layout for auth pages (login, error, etc.)
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {children}
    </div>
  );
}
