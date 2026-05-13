import { signIn } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In — SEALBASE',
};

// ─── Error Message Map ────────────────────────────────────────────────────────

const AUTH_ERRORS: Record<string, string> = {
  OAuthSignin: 'Could not start the Google sign-in flow. Please try again.',
  OAuthCallback: 'Google returned an error during sign-in. Please try again.',
  OAuthCreateAccount: 'Could not create your account. Please try again.',
  EmailCreateAccount: 'Could not create your account. Please try again.',
  Callback: 'An error occurred during sign-in. Please try again.',
  OAuthAccountNotLinked:
    'This email is already associated with a different sign-in method.',
  SessionRequired: 'Your session has expired. Please sign in again.',
  CredentialsSignin: 'Sign-in failed. Please try again.',
  Default: 'An unexpected error occurred. Please try again.',
};

function getErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  return AUTH_ERRORS[error] ?? AUTH_ERRORS.Default;
}

// ─── Login Page ───────────────────────────────────────────────────────────────

interface LoginPageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMessage = getErrorMessage(params.error);

  return (
    <div className="w-full max-w-sm">
      {/* Card */}
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">
        {/* Wordmark */}
        <div className="mb-6 text-center">
          <h1 className="text-h2 font-semibold tracking-tight text-text-primary">SEALBASE</h1>
          <p className="mt-1 text-small text-text-secondary">
            Walrus-native form infrastructure
          </p>
        </div>

        {/* Divider */}
        <div className="mb-6 border-t border-border" />

        {/* Server-side error message (from NextAuth redirect) */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-error/20 bg-error/5 px-4 py-3 text-small text-error"
          >
            {errorMessage}
          </div>
        )}

        {/* Firebase Google Sign-In (client-side popup) */}
        <GoogleSignInButton callbackUrl={params.callbackUrl ?? '/dashboard'} />

        {/* Dev login — only shown in development */}
        {process.env.NODE_ENV === 'development' && (
          <>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-small text-text-muted">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <form
              action={async (formData: FormData) => {
                'use server';
                const email = formData.get('email') as string;
                await signIn('dev-login', {
                  email,
                  redirectTo: params.callbackUrl ?? '/dashboard',
                });
              }}
            >
              <div className="mb-3">
                <input
                  type="email"
                  name="email"
                  defaultValue="dev@sealbase.local"
                  placeholder="dev@sealbase.local"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="w-full font-medium"
              >
                Dev Login (local only)
              </Button>
            </form>
          </>
        )}

        {/* Footer note */}
        <p className="mt-6 text-center text-small text-text-muted">
          No wallet required. No crypto knowledge needed.
        </p>
      </div>
    </div>
  );
}
