'use client';

/**
 * Landing page — full overhaul.
 *
 * Sections:
 *   1. Nav
 *   2. Hero  — headline + Airtable import input + animated pipeline visual + background
 *   3. How It Works — 3-step
 *   4. Import Support — Airtable live, others coming soon
 *   5. Live Import Preview — real fields from the example form
 *   6. Why Swrap — feature cards
 *   7. Final CTA — import input again
 *   8. Footer
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useInView } from 'framer-motion';
import {
  ArrowRight,
  Loader2,
  CheckCircle2,
  FileText,
  Lock,
  Upload,
  Share2,
  Database,
  Zap,
  ArrowDown,
} from 'lucide-react';

// ─── Shared animation helpers ──────────────────────────────────────────────────

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1], delay } },
  };
}

function InView({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = React.useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Background grid + glow ────────────────────────────────────────────────────

function HeroBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Radial top glow */}
      <div
        className="absolute inset-x-0 top-0 h-[600px]"
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(255,255,255,0.055) 0%, transparent 70%)',
        }}
      />
      {/* Secondary off-center accent glow */}
      <div
        className="absolute top-[-80px] left-[30%] h-[400px] w-[500px] opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(120,120,255,0.12) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      {/* SVG grid */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.035]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      {/* Animated horizontal line sweep */}
      <motion.div
        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
        animate={{ top: ['15%', '65%', '15%'] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
        animate={{ top: ['50%', '20%', '50%'] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
      />
      {/* Animated vertical line */}
      <motion.div
        className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent"
        animate={{ left: ['20%', '80%', '20%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />
      {/* Noise texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'repeat',
          backgroundSize: '128px',
        }}
      />
    </div>
  );
}

// ─── Import input (reused in hero + final CTA) ─────────────────────────────────

function ImportInput({ size = 'lg', autoFocus = false }: { size?: 'sm' | 'lg'; autoFocus?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = React.useState('');
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [phase, setPhase] = React.useState(0);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [importedTitle, setImportedTitle] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const PHASES = [
    'Fetching Airtable schema…',
    'Mapping fields…',
    'Generating form…',
    'Opening builder…',
  ];

  // Validate URL pattern as user types
  const isValidUrl = /^https:\/\/airtable\.com\/[a-zA-Z0-9]+\/shr[a-zA-Z0-9]+/.test(url.trim());

  async function handleImport() {
    const trimmed = url.trim();
    if (!trimmed) { inputRef.current?.focus(); return; }

    setStatus('loading');
    setErrorMsg('');
    setPhase(0);

    // Animate through phases
    const phaseTimer = setInterval(() => {
      setPhase((p) => Math.min(p + 1, PHASES.length - 1));
    }, 700);

    try {
      const res = await fetch('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      clearInterval(phaseTimer);
      setPhase(3);

      const data = await res.json() as {
        success?: boolean;
        data?: {
          redirectUrl?: string;
          title?: string;
          fieldCount?: number;
          isGuest?: boolean;
          fields?: any[];
        };
        error?: { code?: string; message?: string };
      };

      if (!res.ok || !data.success) {
        setErrorMsg(data?.error?.message ?? 'Could not import this Airtable form yet.');
        setStatus('error');
        return;
      }

      // Guest flow: save fields to localStorage so builder can pick them up
      if (data.data?.isGuest && data.data.fields) {
        localStorage.setItem('swrap-builder-draft@1', JSON.stringify({
          title: data.data.title || 'Imported Form',
          fields: data.data.fields,
          savedAt: new Date().toISOString(),
        }));
      }

      setImportedTitle(data.data?.title ?? 'Imported Form');
      setStatus('success');
      setTimeout(() => router.push(data.data?.redirectUrl ?? '/dashboard/forms/new'), 900);
    } catch {
      clearInterval(phaseTimer);
      setErrorMsg('Could not reach the server. Check your connection and try again.');
      setStatus('error');
    }
  }

  const isLg = size === 'lg';
  const isLoading = status === 'loading';
  const isSuccess = status === 'success';

  return (
    <div className="w-full">
      <div
        className={`relative flex items-center gap-2 rounded-xl border transition-all duration-200 ${
          isValidUrl && status === 'idle'
            ? 'border-white/30 bg-white/[0.06] shadow-[0_0_24px_rgba(255,255,255,0.07)]'
            : status === 'error'
            ? 'border-red-500/40 bg-red-500/[0.04]'
            : 'border-white/[0.12] bg-white/[0.04]'
        } ${isLg ? 'p-1.5' : 'p-1'}`}
      >
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); if (status !== 'idle') setStatus('idle'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
          placeholder="Paste Airtable form link…"
          aria-label="Airtable shared form URL"
          disabled={isLoading || isSuccess}
          autoFocus={autoFocus}
          className={`min-w-0 flex-1 bg-transparent text-[#FAFAFA] placeholder-[#A1A1AA]/50 outline-none disabled:opacity-50 ${
            isLg ? 'px-4 py-3 text-sm' : 'px-3 py-2 text-sm'
          }`}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={handleImport}
          disabled={isLoading || isSuccess || !url.trim()}
          className={`shrink-0 inline-flex items-center gap-2 rounded-lg font-medium transition-all disabled:pointer-events-none disabled:opacity-50 ${
            isSuccess
              ? 'bg-green-500/20 text-green-400'
              : 'bg-[#FAFAFA] text-[#0A0A0A] hover:bg-white/90 active:scale-95'
          } ${isLg ? 'px-5 py-3 text-sm' : 'px-4 py-2 text-xs'}`}
        >
          {isLoading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Importing…</>
          ) : isSuccess ? (
            <><CheckCircle2 className="h-3.5 w-3.5" />Done</>
          ) : (
            <>Import Form<ArrowRight className="h-3.5 w-3.5" /></>
          )}
        </button>
      </div>

      {/* Phase indicator */}
      {isLoading && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2.5 flex items-center gap-2"
        >
          <div className="flex gap-1">
            {PHASES.map((_, i) => (
              <div
                key={i}
                className={`h-1 w-6 rounded-full transition-colors duration-500 ${
                  i <= phase ? 'bg-white/40' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-[#A1A1AA]">{PHASES[phase]}</span>
        </motion.div>
      )}

      {/* Success */}
      {isSuccess && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-xs text-green-400"
        >
          ✓ &ldquo;{importedTitle}&rdquo; imported — opening builder…
        </motion.p>
      )}

      {/* Error */}
      {status === 'error' && errorMsg && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-xs text-red-400"
          role="alert"
        >
          {errorMsg}
        </motion.p>
      )}

      {/* Coming-soon note */}
      {status === 'idle' && (
        <p className="mt-2.5 text-xs text-[#A1A1AA]/50">
          Airtable supported now&nbsp;·&nbsp;
          <span className="text-[#A1A1AA]/40">Typeform &amp; Notion coming soon</span>
        </p>
      )}
    </div>
  );
}

// ─── Pipeline visual (right side of hero) ─────────────────────────────────────

const PIPELINE_STEPS = [
  { label: 'Airtable Link', sub: 'Paste your share URL', icon: '🔗' },
  { label: 'Field Mapping', sub: 'Auto-detected & typed', icon: '⚡' },
  { label: 'Swrap Builder', sub: 'Customize visually', icon: '✏️' },
  { label: 'Published on Walrus', sub: 'Decentralized & live', icon: '🌊' },
];

function PipelineVisual() {
  return (
    <div className="relative flex flex-col gap-0 select-none" aria-hidden="true">
      {PIPELINE_STEPS.map((step, i) => (
        <React.Fragment key={step.label}>
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="group relative rounded-xl border border-white/[0.08] bg-[#111111] px-5 py-4 transition-colors hover:border-white/[0.16] hover:bg-[#161616]"
          >
            <div className="flex items-center gap-3">
              <span className="text-base">{step.icon}</span>
              <div>
                <p className="text-sm font-medium text-[#FAFAFA]">{step.label}</p>
                <p className="text-xs text-[#A1A1AA]">{step.sub}</p>
              </div>
              {i === PIPELINE_STEPS.length - 1 && (
                <span className="ml-auto rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400">
                  Live
                </span>
              )}
            </div>
          </motion.div>
          {i < PIPELINE_STEPS.length - 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              className="flex items-center justify-center py-1"
            >
              <ArrowDown className="h-3.5 w-3.5 text-white/20" />
            </motion.div>
          )}
        </React.Fragment>
      ))}
      {/* Timing badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5"
      >
        <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs text-[#A1A1AA]">Imported in&nbsp;</span>
        <span className="text-xs font-semibold text-[#FAFAFA]">1.1s</span>
        <span className="ml-auto text-xs text-[#A1A1AA]/50">23 fields detected</span>
      </motion.div>
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#0A0A0A]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="Swrap" className="h-6 w-6" />
          <span className="text-base font-semibold tracking-tight text-[#FAFAFA]">Swrap</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-md px-3 py-1.5 text-sm text-[#A1A1AA] transition-colors hover:text-[#FAFAFA] hover:bg-white/[0.06]"
          >
            Dashboard
          </Link>
          <Link
            href="/login"
            className="rounded-md bg-[#FAFAFA] px-3 py-1.5 text-sm font-medium text-[#0A0A0A] transition-colors hover:bg-white/90"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative min-h-[100svh] bg-[#0A0A0A] pt-28 pb-20 overflow-hidden flex items-center">
      <HeroBackground />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left — copy + input */}
          <div>
            {/* Badge */}
            <motion.p
              {...fadeUp(0)}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-medium text-[#A1A1AA] tracking-wide"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Walrus-native · Seal-encrypted
            </motion.p>

            {/* Headline */}
            <motion.h1
              {...fadeUp(0.07)}
              className="text-[3.5rem] font-semibold leading-[1.05] tracking-[-0.03em] text-[#FAFAFA] lg:text-[4.5rem]"
            >
              Frictionless
              <br />
              form creation.
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              {...fadeUp(0.14)}
              className="mt-5 max-w-md text-base leading-relaxed text-[#A1A1AA]"
            >
              Import Airtable forms instantly, customize them visually, and publish
              to Walrus in seconds.
            </motion.p>

            {/* Supporting */}
            <motion.p
              {...fadeUp(0.18)}
              className="mt-2 text-sm text-[#A1A1AA]/50"
            >
              No JSON. No setup. No wallet complexity.
            </motion.p>

            {/* Import input */}
            <motion.div {...fadeUp(0.24)} className="mt-8 max-w-lg">
              <ImportInput size="lg" />
            </motion.div>

            {/* Secondary CTA */}
            <motion.div {...fadeUp(0.3)} className="mt-5">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] px-5 py-2.5 text-sm font-medium text-[#FAFAFA] transition-colors hover:bg-white/[0.1]"
              >
                Start building from scratch
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>
          </div>

          {/* Right — pipeline visual */}
          <motion.div
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="hidden lg:block"
          >
            <PipelineVisual />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 2 — How It Works ─────────────────────────────────────────────────

const HOW_STEPS = [
  {
    n: '01',
    title: 'Paste your Airtable link',
    body: 'Drop any public Airtable shared form URL into the input. That\'s it.',
    icon: '🔗',
  },
  {
    n: '02',
    title: 'We map fields automatically',
    body: 'Field labels, types, dropdown options, required states — all extracted and mapped to Swrap.',
    icon: '⚡',
  },
  {
    n: '03',
    title: 'Publish instantly to Walrus',
    body: 'Customize in the builder, hit publish. Your form lives on decentralized storage permanently.',
    icon: '🌊',
  },
];

function HowItWorksSection() {
  return (
    <section className="bg-[#0A0A0A] py-24 border-t border-white/[0.05]">
      <div className="mx-auto max-w-6xl px-6">
        <InView className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/60">
            How it works
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Three steps. Done.
          </h2>
        </InView>

        <div className="grid gap-4 md:grid-cols-3">
          {HOW_STEPS.map((s, i) => (
            <InView key={s.n} delay={i * 0.08}>
              <div className="group h-full rounded-xl border border-white/[0.08] bg-[#111111] p-6 transition-colors hover:border-white/[0.16]">
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-xl">{s.icon}</span>
                  <span className="text-xs font-medium text-[#A1A1AA]/60">{s.n}</span>
                </div>
                <p className="mb-2 text-sm font-semibold text-[#FAFAFA]">{s.title}</p>
                <p className="text-xs leading-relaxed text-[#A1A1AA]">{s.body}</p>
              </div>
            </InView>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 3 — Import Support ───────────────────────────────────────────────

const IMPORT_SOURCES = [
  { name: 'Airtable', status: 'live' as const, note: 'Public shared forms' },
  { name: 'Typeform', status: 'soon' as const, note: 'Coming soon' },
  { name: 'Notion Forms', status: 'soon' as const, note: 'Coming soon' },
  { name: 'Google Forms', status: 'soon' as const, note: 'Coming soon' },
];

function ImportSupportSection() {
  return (
    <section className="bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <InView className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/60">
            Import support
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Migrate from anywhere.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-[#A1A1AA]">
            Start with Airtable now. More platforms landing soon.
          </p>
        </InView>

        <div className="mx-auto max-w-2xl grid gap-3 sm:grid-cols-2">
          {IMPORT_SOURCES.map((src, i) => (
            <InView key={src.name} delay={i * 0.07}>
              <div
                className={`flex items-center justify-between rounded-xl border px-5 py-4 ${
                  src.status === 'live'
                    ? 'border-white/[0.14] bg-white/[0.04]'
                    : 'border-white/[0.06] bg-[#111111] opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-base">
                    {src.status === 'live' ? '✅' : '🟡'}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[#FAFAFA]">{src.name}</p>
                    <p className="text-xs text-[#A1A1AA]/60">{src.note}</p>
                  </div>
                </div>
                {src.status === 'live' && (
                  <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-medium text-green-400">
                    Live
                  </span>
                )}
              </div>
            </InView>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 4 — Live Import Preview ─────────────────────────────────────────

const PREVIEW_FIELDS = [
  { label: 'Project name', type: 'text', req: true },
  { label: 'Please select the session', type: 'select', req: true, opts: ['Session 2: Form Tooling'] },
  { label: 'Team Leader Name', type: 'text', req: true },
  { label: 'Team Leader Email', type: 'email', req: true },
  { label: 'Discord handle', type: 'text', req: true },
  { label: 'Country', type: 'text', req: true },
  { label: 'DeepSurge project Link', type: 'url', req: true },
  { label: 'Share any visuals of your form', type: 'file', req: true },
  { label: 'Feedback (about building on Walrus)', type: 'textarea', req: true },
  { label: 'SUI address', type: 'text', req: true },
  { label: 'Session Feedback', type: 'textarea', req: false },
];

const TYPE_BADGE: Record<string, string> = {
  text: 'Text', textarea: 'Long text', email: 'Email',
  url: 'URL', select: 'Dropdown', file: 'File upload',
};

function LiveImportPreviewSection() {
  return (
    <section className="bg-[#0A0A0A] py-24 border-t border-white/[0.05]">
      <div className="mx-auto max-w-6xl px-6">
        <InView className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/60">
            Live import preview
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            This is a real Airtable form.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-[#A1A1AA]">
            Swrap imported it in 1.1 seconds. All 23 fields, mapped and ready.
          </p>
        </InView>

        <InView>
          <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-white/[0.08] bg-[#111111]">
            {/* Header bar */}
            <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0F0F0F] px-5 py-3.5">
              <div>
                <p className="text-sm font-semibold text-[#FAFAFA]">Walrus Session 2 — Form tooling</p>
                <p className="text-xs text-[#A1A1AA]/60">airtable.com/appoDAKpC74UOqoDa/shrN8UbJRdbkd5Lso</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-[#A1A1AA]">Imported in 1.1s</span>
              </div>
            </div>
            {/* Field list */}
            <div className="divide-y divide-white/[0.04]">
              {PREVIEW_FIELDS.map((f, i) => (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04, duration: 0.35 }}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 text-xs text-[#A1A1AA]/40">{String(i + 1).padStart(2, '0')}</span>
                    <p className="truncate text-sm text-[#FAFAFA]">{f.label}</p>
                    {f.req && <span className="shrink-0 text-[10px] text-[#A1A1AA]/40">✱</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.opts && (
                      <span className="hidden sm:block text-[10px] text-[#A1A1AA]/40 max-w-[120px] truncate">
                        {f.opts[0]}
                      </span>
                    )}
                    <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-[#A1A1AA]">
                      {TYPE_BADGE[f.type] ?? f.type}
                    </span>
                  </div>
                </motion.div>
              ))}
              <div className="px-5 py-3 text-xs text-[#A1A1AA]/40">
                + 12 more fields imported
              </div>
            </div>
            {/* Footer */}
            <div className="border-t border-white/[0.06] bg-[#0F0F0F] px-5 py-3.5 flex items-center justify-between">
              <span className="text-xs text-[#A1A1AA]/60">23 fields · 0 skipped · Draft saved</span>
              <span className="rounded-md bg-white/[0.06] px-3 py-1 text-xs font-medium text-[#FAFAFA]">
                Open in builder →
              </span>
            </div>
          </div>
        </InView>
      </div>
    </section>
  );
}

// ─── Section 5 — Why Swrap ────────────────────────────────────────────────────

const WHY_CARDS = [
  { icon: Zap, title: 'Frictionless creation', body: 'Import in seconds. Or build from scratch with a visual drag-and-drop builder.' },
  { icon: Database, title: 'Walrus publishing', body: 'Every form published to decentralized Walrus storage. Permanent, append-only, fast.' },
  { icon: Upload, title: 'Rich file uploads', body: 'Accept images, videos, PDFs. All stored on-chain through Walrus.' },
  { icon: FileText, title: 'Structured submissions', body: 'Every response is typed and structured. Export to CSV or review in-app.' },
  { icon: Lock, title: 'Seal encryption', body: 'Field-level encryption via Seal. Only you can read what you collect.' },
  { icon: Share2, title: 'Instant sharing', body: 'One link. Anyone can submit. No account or wallet required for responders.' },
];

function WhySwrapSection() {
  return (
    <section className="bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <InView className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/60">
            Why Swrap
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Forms, reimagined.
          </h2>
        </InView>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <InView key={card.title} delay={i * 0.06}>
                <div className="group h-full rounded-xl border border-white/[0.08] bg-[#111111] p-5 transition-colors hover:border-white/[0.16]">
                  <Icon className="mb-3 h-4 w-4 text-[#A1A1AA]" aria-hidden="true" />
                  <p className="mb-1.5 text-sm font-semibold text-[#FAFAFA]">{card.title}</p>
                  <p className="text-xs leading-relaxed text-[#A1A1AA]">{card.body}</p>
                </div>
              </InView>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="relative border-t border-white/[0.05] bg-[#0A0A0A] py-32 overflow-hidden">
      {/* Background glow */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 100%, rgba(255,255,255,0.035) 0%, transparent 70%)',
        }}
      />
      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <InView>
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]/60">
            Get started
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Import your first form.
          </h2>
          <p className="mx-auto mt-4 max-w-sm text-base text-[#A1A1AA]">
            Paste an Airtable link below. Your form will be ready in seconds.
          </p>
          <div className="mt-8 text-left">
            <ImportInput size="lg" />
          </div>
          <div className="mt-6">
            <Link
              href="/login"
              className="text-sm text-[#A1A1AA]/60 underline underline-offset-4 hover:text-[#A1A1AA] transition-colors"
            >
              Or start from scratch →
            </Link>
          </div>
        </InView>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#0A0A0A] py-10">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div>
            <p className="text-sm font-semibold text-[#FAFAFA]">Swrap</p>
            <p className="mt-0.5 text-xs text-[#A1A1AA]/60">Stored on Walrus. Protected with Seal.</p>
          </div>
          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            <Link href="/dashboard" className="text-xs text-[#A1A1AA] transition-colors hover:text-[#FAFAFA]">
              Dashboard
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#A1A1AA] transition-colors hover:text-[#FAFAFA]"
            >
              GitHub
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A]">
      <Nav />
      <main>
        <HeroSection />
        <HowItWorksSection />
        <ImportSupportSection />
        <LiveImportPreviewSection />
        <WhySwrapSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
