'use client';

/**
 * AirtableImportHero — hero import section on the landing page.
 *
 * Paste an Airtable public share link → we scrape it → your form is ready
 * in the builder instantly.
 *
 * Unauthenticated users: redirected to /login?next=/dashboard/forms/new?draft=:id
 * Authenticated users: sent directly to /dashboard/forms/new?draft=:id
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';

// ─── Inline minimal button to avoid import issues ─────────────────────────────

function Btn({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Example links shown as pills ─────────────────────────────────────────────

const EXAMPLE_FIELDS = [
  'Name',
  'Email',
  'Topic',
  'Description',
  'Attachments',
  '+ more',
];

// ─── Main component ───────────────────────────────────────────────────────────

export function AirtableImportHero() {
  const router = useRouter();
  const [url, setUrl] = React.useState('');
  const [status, setStatus] = React.useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = React.useState('');
  const [importedTitle, setImportedTitle] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleImport() {
    const trimmed = url.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        data?: { redirectUrl?: string; title?: string; fieldCount?: number };
        error?: { code?: string; message?: string };
      };

      if (res.status === 401) {
        // Not signed in — send to login with return URL
        // Store the import URL in sessionStorage so after login we can re-import
        sessionStorage.setItem('swrap-pending-import-url', trimmed);
        router.push('/login?reason=import');
        return;
      }

      if (!res.ok || !data.success) {
        setErrorMsg(
          data?.error?.message ?? 'Could not import this Airtable form yet.',
        );
        setStatus('error');
        return;
      }

      const redirectUrl = data.data?.redirectUrl;
      const title = data.data?.title ?? 'Imported Form';

      setImportedTitle(title);
      setStatus('success');

      // Brief success flash then navigate
      setTimeout(() => {
        router.push(redirectUrl ?? '/dashboard/forms');
      }, 900);
    } catch {
      setErrorMsg('Could not reach the server. Check your connection and try again.');
      setStatus('error');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleImport();
  }

  const isLoading = status === 'loading';
  const isSuccess = status === 'success';

  return (
    <section className="bg-[#0A0A0A] py-24 border-b border-white/[0.06]">
      <div className="mx-auto max-w-4xl px-6">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="mb-6 flex justify-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-xs font-medium text-[#A1A1AA]">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Instant import
          </span>
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-[2.75rem] lg:leading-[1.1]">
            Migrate from Airtable
            <br />
            <span className="text-[#A1A1AA]">in seconds.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-[#A1A1AA]">
            Paste any public Airtable share link. We import the structure
            and open it in the builder — ready to encrypt, store on Walrus,
            and publish.
          </p>
        </motion.div>

        {/* Import input */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto max-w-2xl"
        >
          <div
            className={`relative flex items-center gap-2 rounded-xl border p-1.5 transition-colors ${
              status === 'error'
                ? 'border-red-500/40 bg-red-500/[0.04]'
                : 'border-white/[0.12] bg-white/[0.04] focus-within:border-white/30'
            }`}
          >
            <input
              ref={inputRef}
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (status === 'error') setStatus('idle');
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://airtable.com/appXxx/shrXxx"
              aria-label="Airtable shared form URL"
              disabled={isLoading || isSuccess}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-[#FAFAFA] placeholder-[#A1A1AA]/60 outline-none disabled:opacity-50"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />

            <Btn
              onClick={handleImport}
              disabled={isLoading || isSuccess || !url.trim()}
              className={`shrink-0 px-4 py-2.5 text-sm ${
                isSuccess
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-[#FAFAFA] text-[#0A0A0A] hover:bg-white/90'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Importing…
                </>
              ) : isSuccess ? (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Done
                </>
              ) : (
                <>
                  Import Form
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Btn>
          </div>

          {/* Error */}
          {status === 'error' && errorMsg && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 text-center text-sm text-red-400"
              role="alert"
            >
              {errorMsg}
            </motion.p>
          )}

          {/* Success */}
          {status === 'success' && importedTitle && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 text-center text-sm text-green-400"
            >
              ✓ &ldquo;{importedTitle}&rdquo; imported — opening builder…
            </motion.p>
          )}

          {/* Loading hint */}
          {status === 'loading' && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-2.5 text-center text-xs text-[#A1A1AA]"
            >
              Fetching form structure from Airtable…
            </motion.p>
          )}
        </motion.div>

        {/* What gets imported */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45, delay: 0.15 }}
          className="mx-auto mt-10 max-w-2xl"
        >
          <p className="mb-3 text-center text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/60">
            What gets imported
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              'Form title',
              'Field labels',
              'Field types',
              'Dropdown options',
              'Required fields',
              'Help text',
            ].map((item) => (
              <span
                key={item}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs text-[#A1A1AA]"
              >
                <CheckCircle2 className="h-3 w-3 text-[#A1A1AA]/70" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Preview of field pills */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-8 max-w-2xl overflow-hidden rounded-xl border border-white/[0.08] bg-[#111111]"
          aria-hidden="true"
        >
          {/* Fake browser bar */}
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3">
            <div className="h-2 w-2 rounded-full bg-white/10" />
            <div className="h-2 w-2 rounded-full bg-white/10" />
            <div className="h-2 w-2 rounded-full bg-white/10" />
            <div className="ml-2 h-4 flex-1 rounded bg-white/[0.04] text-center text-[10px] leading-4 text-[#A1A1AA]/40">
              airtable.com/app.../shr…
            </div>
          </div>
          {/* Preview fields */}
          <div className="p-5">
            <p className="mb-4 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/50">
              Detected fields
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_FIELDS.map((f, i) => (
                <motion.span
                  key={f}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.25 + i * 0.06 }}
                  className="rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs text-[#A1A1AA]"
                >
                  {f}
                </motion.span>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="h-px flex-1 bg-white/[0.06]" />
              <span className="text-[10px] text-[#A1A1AA]/40">→ Swrap builder</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
