'use client';

import Link from 'next/link';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import {
  FileText,
  Lock,
  Upload,
  Share2,
  Eye,
  Download,
  Zap,
  Shield,
  Database,
  ArrowRight,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Animation helpers ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.2, 0, 0, 1] } },
};

function stagger(index: number, base = 0.08) {
  return {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.2, 0, 0, 1], delay: index * base },
    },
  };
}

function InViewSection({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.div
      ref={ref}
      variants={fadeUp}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const trustPills = [
  'Rich media submissions',
  'Seal encrypted',
  'Built on Walrus',
  'Shareable forms',
  'CSV export',
  'zkLogin onboarding',
];

const features = [
  {
    icon: FileText,
    title: 'Custom form builder',
    description: 'Build forms with text, dropdowns, file uploads, ratings, and more.',
  },
  {
    icon: Upload,
    title: 'Rich submissions',
    description: 'Accept screenshots, videos, URLs, and structured data in a single response.',
  },
  {
    icon: Share2,
    title: 'Shareable forms',
    description: 'Get a public link. Anyone can submit — no account or wallet required.',
  },
  {
    icon: Lock,
    title: 'Private access',
    description: 'Seal-encrypted responses. Only authorized admins can read submissions.',
  },
  {
    icon: Eye,
    title: 'Review workflows',
    description: 'Filter, tag, prioritize, and resolve submissions from a clean dashboard.',
  },
  {
    icon: Download,
    title: 'CSV export',
    description: 'Export all submissions to CSV for analysis or reporting.',
  },
  {
    icon: Zap,
    title: 'zkLogin onboarding',
    description: 'Sign in with Google. No wallet setup, no seed phrases, no friction.',
  },
  {
    icon: Shield,
    title: 'Seal encryption',
    description: 'Field-level and full-submission encryption. Sensitive data stays private.',
  },
  {
    icon: Database,
    title: 'Walrus storage',
    description: 'Every submission stored on Walrus. Decentralized, append-only, permanent.',
  },
];

const infraSteps = [
  { label: 'User submits', sub: 'No wallet needed' },
  { label: 'Swrap processes', sub: 'Encrypted in transit' },
  { label: 'Walrus stores', sub: 'Decentralized storage' },
  { label: 'Seal protects', sub: 'Admin-only access' },
];

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#0A0A0A]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-base font-semibold tracking-tight text-[#FAFAFA]">Swrap</span>
        <nav className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/[0.06]"
          >
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button
            size="sm"
            asChild
            className="bg-[#FAFAFA] text-[#0A0A0A] hover:bg-white/90 font-medium"
          >
            <Link href="/login">Get started</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative min-h-screen bg-[#0A0A0A] pt-32 pb-24 overflow-hidden">
      {/* Subtle radial gradient */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,255,255,0.04) 0%, transparent 70%)',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left — copy */}
          <div>
            <motion.p
              variants={stagger(0)}
              initial="hidden"
              animate="visible"
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-medium text-[#A1A1AA] tracking-wide"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#A1A1AA]" />
              Walrus-native · Seal-encrypted
            </motion.p>

            <motion.h1
              variants={stagger(1)}
              initial="hidden"
              animate="visible"
              className="text-[3.25rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[#FAFAFA] lg:text-[4rem]"
            >
              Structured
              <br />
              communication
              <br />
              <span className="text-[#A1A1AA]">for modern</span>
              <br />
              communities.
            </motion.h1>

            <motion.p
              variants={stagger(2)}
              initial="hidden"
              animate="visible"
              className="mt-6 max-w-md text-base leading-relaxed text-[#A1A1AA]"
            >
              Create forms, collect submissions, and manage feedback with Walrus-native storage
              and private access control.
            </motion.p>

            <motion.div
              variants={stagger(3)}
              initial="hidden"
              animate="visible"
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Button
                size="lg"
                asChild
                className="bg-[#FAFAFA] text-[#0A0A0A] hover:bg-white/90 font-medium px-6"
              >
                <Link href="/login">
                  Start building
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="lg"
                asChild
                className="text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/[0.06] border border-white/[0.08] px-6"
              >
                <Link href="/dashboard">View demo</Link>
              </Button>
            </motion.div>
          </div>

          {/* Right — UI preview cards */}
          <motion.div
            variants={stagger(2)}
            initial="hidden"
            animate="visible"
            className="relative hidden lg:block"
          >
            <div className="relative h-[480px]">
              {/* Background card */}
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                className="absolute right-0 top-8 w-72 rounded-xl border border-white/[0.08] bg-[#111111] p-5 shadow-2xl"
              >
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#A1A1AA]" />
                  <span className="text-xs font-medium text-[#A1A1AA]">New submission</span>
                </div>
                <p className="text-sm font-medium text-[#FAFAFA]">Bug Report — v2.4.1</p>
                <p className="mt-1 text-xs text-[#A1A1AA]">Reproducible on Safari 17.2</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-[#A1A1AA]">
                    high priority
                  </span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-[#A1A1AA]">
                    encrypted
                  </span>
                </div>
              </motion.div>

              {/* Main card */}
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-0 top-24 w-80 rounded-xl border border-white/[0.08] bg-[#111111] p-6 shadow-2xl"
              >
                <p className="mb-4 text-sm font-semibold text-[#FAFAFA]">Feature Request</p>
                <div className="space-y-3">
                  {['What feature do you need?', 'How urgent is this?', 'Attach a screenshot'].map(
                    (label, i) => (
                      <div key={i} className="rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                        <p className="text-xs text-[#A1A1AA]">{label}</p>
                      </div>
                    ),
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="h-1 flex-1 rounded-full bg-white/[0.06]">
                    <div className="h-1 w-2/3 rounded-full bg-[#FAFAFA]/30" />
                  </div>
                  <span className="ml-3 text-xs text-[#A1A1AA]">2 / 3</span>
                </div>
              </motion.div>

              {/* Bottom card */}
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                className="absolute bottom-0 right-4 w-64 rounded-xl border border-white/[0.08] bg-[#111111] p-4 shadow-2xl"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-3.5 w-3.5 text-[#A1A1AA]" />
                  <span className="text-xs font-medium text-[#A1A1AA]">Stored on Walrus</span>
                </div>
                <p className="font-mono text-xs text-[#A1A1AA]/60 truncate">
                  blob_id: 7f3a9c2e…
                </p>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Trust Strip ──────────────────────────────────────────────────────────────

function TrustStrip() {
  return (
    <section className="border-y border-white/[0.06] bg-[#0A0A0A] py-5">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {trustPills.map((pill) => (
            <span
              key={pill}
              className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-[#A1A1AA]"
            >
              {pill}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Interactive Form Experience ──────────────────────────────────────────────

function FormExperienceSection() {
  const steps = [
    {
      step: '01',
      question: 'What type of feedback are you sharing?',
      options: ['Bug report', 'Feature request', 'General feedback', 'Other'],
    },
    {
      step: '02',
      question: 'How would you rate the severity?',
      options: ['Critical', 'High', 'Medium', 'Low'],
    },
    {
      step: '03',
      question: 'Attach a screenshot or recording',
      options: null,
    },
  ];

  return (
    <section className="bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <InViewSection className="mb-16 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]">
            Form experience
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Forms that feel good to fill.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-[#A1A1AA]">
            Multi-step, animated, and intuitive. Submitters get a polished experience.
            You get structured data.
          </p>
        </InViewSection>

        <div className="grid gap-4 lg:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div
              key={s.step}
              variants={stagger(i, 0.1)}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              className="group rounded-xl border border-white/[0.08] bg-[#111111] p-6 transition-colors hover:border-white/[0.14]"
            >
              <span className="mb-4 block text-xs font-medium text-[#A1A1AA]">{s.step}</span>
              <p className="mb-5 text-sm font-medium leading-snug text-[#FAFAFA]">{s.question}</p>
              {s.options ? (
                <div className="space-y-2">
                  {s.options.map((opt, j) => (
                    <div
                      key={opt}
                      className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                        j === 0
                          ? 'border-white/20 bg-white/[0.06] text-[#FAFAFA]'
                          : 'border-white/[0.06] bg-transparent text-[#A1A1AA]'
                      }`}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-white/[0.12] bg-white/[0.02]">
                  <div className="text-center">
                    <Upload className="mx-auto mb-1 h-4 w-4 text-[#A1A1AA]" />
                    <p className="text-xs text-[#A1A1AA]">Drop files here</p>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Dashboard Preview ────────────────────────────────────────────────────────

function DashboardPreviewSection() {
  const rows = [
    { title: 'Bug Report — Safari crash', status: 'open', priority: 'high', encrypted: true, time: '2m ago' },
    { title: 'Feature: Dark mode toggle', status: 'reviewing', priority: 'medium', encrypted: false, time: '1h ago' },
    { title: 'Onboarding feedback', status: 'resolved', priority: 'low', encrypted: true, time: '3h ago' },
    { title: 'API rate limit issue', status: 'open', priority: 'high', encrypted: true, time: '5h ago' },
  ];

  const statusColors: Record<string, string> = {
    open: 'bg-blue-50 text-blue-700',
    reviewing: 'bg-amber-50 text-amber-700',
    resolved: 'bg-green-50 text-green-700',
  };

  const priorityColors: Record<string, string> = {
    high: 'text-red-600',
    medium: 'text-amber-600',
    low: 'text-gray-400',
  };

  return (
    <section className="bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <InViewSection className="mb-16 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]">
            Admin dashboard
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Review everything in one place.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-[#A1A1AA]">
            Filter, prioritize, and resolve submissions. Export to CSV. Decrypt private responses.
          </p>
        </InViewSection>

        {/* Light mode dashboard preview */}
        <InViewSection>
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white shadow-2xl">
            {/* Dashboard header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-900">Submissions</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {rows.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Filter
                </button>
                <button className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Export CSV
                </button>
              </div>
            </div>

            {/* Table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  {['Title', 'Status', 'Priority', 'Encrypted', 'Time'].map((col) => (
                    <th
                      key={col}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-6 py-3.5 font-medium text-gray-900">{row.title}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[row.status]}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className={`px-6 py-3.5 text-xs font-medium capitalize ${priorityColors[row.priority]}`}>
                      {row.priority}
                    </td>
                    <td className="px-6 py-3.5">
                      {row.encrypted ? (
                        <Lock className="h-3.5 w-3.5 text-gray-400" />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-gray-400">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InViewSection>
      </div>
    </section>
  );
}

// ─── Infrastructure ───────────────────────────────────────────────────────────

function InfrastructureSection() {
  return (
    <section className="bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <InViewSection className="mb-16 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]">
            Infrastructure
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Stored on Walrus.
            <br />
            Protected with Seal.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-[#A1A1AA]">
            The infrastructure is invisible to your users. They fill out a form.
            You get encrypted, permanent, decentralized storage.
          </p>
        </InViewSection>

        {/* Flow diagram */}
        <InViewSection>
          <div className="flex flex-col items-center gap-0 sm:flex-row sm:justify-center">
            {infraSteps.map((step, i) => (
              <div key={step.label} className="flex flex-col items-center sm:flex-row">
                <div className="flex flex-col items-center">
                  <div className="rounded-xl border border-white/[0.08] bg-[#111111] px-5 py-4 text-center">
                    <p className="text-sm font-medium text-[#FAFAFA]">{step.label}</p>
                    <p className="mt-0.5 text-xs text-[#A1A1AA]">{step.sub}</p>
                  </div>
                </div>
                {i < infraSteps.length - 1 && (
                  <div className="my-2 h-6 w-px bg-white/[0.08] sm:mx-3 sm:my-0 sm:h-px sm:w-8" />
                )}
              </div>
            ))}
          </div>
        </InViewSection>
      </div>
    </section>
  );
}

// ─── Feature Grid ─────────────────────────────────────────────────────────────

function FeatureGridSection() {
  return (
    <section className="bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <InViewSection className="mb-16 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#A1A1AA]">
            Everything you need
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Built for serious teams.
          </h2>
        </InViewSection>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                variants={stagger(i % 3, 0.07)}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                className="group rounded-xl border border-white/[0.08] bg-[#111111] p-5 transition-colors hover:border-white/[0.14]"
              >
                <Icon className="mb-3 h-4 w-4 text-[#A1A1AA]" aria-hidden="true" />
                <p className="mb-1.5 text-sm font-medium text-[#FAFAFA]">{feature.title}</p>
                <p className="text-xs leading-relaxed text-[#A1A1AA]">{feature.description}</p>
              </motion.div>
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
    <section className="border-t border-white/[0.06] bg-[#0A0A0A] py-32">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <InViewSection>
          <h2 className="text-3xl font-semibold tracking-tight text-[#FAFAFA] lg:text-4xl">
            Start collecting better feedback.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-[#A1A1AA]">
            No wallet required. No blockchain knowledge needed. Just a form and a link.
          </p>
          <div className="mt-8">
            <Button
              size="lg"
              asChild
              className="bg-[#FAFAFA] text-[#0A0A0A] hover:bg-white/90 font-medium px-8"
            >
              <Link href="/login">
                Create your first form
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </InViewSection>
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
            <p className="mt-0.5 text-xs text-[#A1A1AA]">Stored on Walrus. Protected with Seal.</p>
          </div>
          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            <Link
              href="/dashboard"
              className="text-xs text-[#A1A1AA] transition-colors hover:text-[#FAFAFA]"
            >
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
        <TrustStrip />
        <FormExperienceSection />
        <DashboardPreviewSection />
        <InfrastructureSection />
        <FeatureGridSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
