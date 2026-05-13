'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Cloud, Lock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Animation variants ───────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
};

function withDelay(index: number) {
  return {
    hidden: { opacity: 0, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.2, ease: 'easeOut', delay: 0.1 * index },
    },
  };
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const features = [
  {
    icon: Cloud,
    title: 'Walrus-Native Storage',
    description:
      'Every submission, form schema, and file upload is stored on Walrus. Decentralized, censorship-resistant, append-only.',
  },
  {
    icon: Lock,
    title: 'Seal Encryption',
    description:
      'Field-level and full-submission encryption via Seal. Only authorized admins can decrypt sensitive data.',
  },
  {
    icon: Zap,
    title: 'Web2 UX',
    description:
      'Submitters need no wallet, no gas, no crypto knowledge. Just a link. The infrastructure complexity is yours to manage.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create a Form',
    description:
      'Build your form with our drag-and-drop builder. Choose conversational or table mode.',
  },
  {
    number: '02',
    title: 'Share the Link',
    description: 'Get a public URL. Anyone can submit — no account or wallet needed.',
  },
  {
    number: '03',
    title: 'Review Submissions',
    description:
      'All submissions are stored on Walrus. Filter, search, and export from your dashboard.',
  },
];

// ─── Sections ─────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <span className="text-h3 font-bold tracking-tight text-text-primary">SEALBASE</span>
        <nav className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/login">Get Started</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <motion.p
            variants={withDelay(0)}
            initial="hidden"
            animate="visible"
            className="text-small font-medium uppercase tracking-widest text-walrus-brand"
          >
            Walrus-native form infrastructure
          </motion.p>

          <motion.h1
            variants={withDelay(1)}
            initial="hidden"
            animate="visible"
            className="mt-4 text-display font-bold text-text-primary"
          >
            The feedback layer for Web3 teams
          </motion.h1>

          <motion.p
            variants={withDelay(2)}
            initial="hidden"
            animate="visible"
            className="mx-auto mt-6 max-w-2xl text-body text-text-secondary"
          >
            Collect feedback, bug reports, and surveys. All data stored on Walrus. No wallet
            required for submitters.
          </motion.p>

          <motion.div
            variants={withDelay(3)}
            initial="hidden"
            animate="visible"
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button size="lg" asChild>
              <Link href="/login">Get Started</Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <Link href="/dashboard">View Demo</Link>
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="bg-muted/40 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="mb-12 text-center"
        >
          <h2 className="text-h2 font-semibold text-text-primary">
            Built different. By design.
          </h2>
          <p className="mt-3 text-body text-text-secondary">
            Infrastructure-grade primitives with a product-grade experience.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                variants={withDelay(index)}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="rounded-lg border border-border bg-white p-6 shadow-sm"
              >
                <Icon className="mb-4 h-8 w-8 text-accent" aria-hidden="true" />
                <h3 className="mb-2 text-h3 font-semibold text-text-primary">{feature.title}</h3>
                <p className="text-body text-text-secondary">{feature.description}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="mb-12 text-center"
        >
          <h2 className="text-h2 font-semibold text-text-primary">How it works</h2>
          <p className="mt-3 text-body text-text-secondary">
            From form creation to decentralized storage in three steps.
          </p>
        </motion.div>

        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              variants={withDelay(index)}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="text-center"
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-light">
                <span className="text-small font-bold text-accent">{step.number}</span>
              </div>
              <h3 className="mb-2 text-h3 font-semibold text-text-primary">{step.title}</h3>
              <p className="text-body text-text-secondary">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-background py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div>
            <p className="text-h3 font-bold text-text-primary">SEALBASE</p>
            <p className="mt-1 text-small text-text-secondary">
              Built on Walrus. Encrypted with Seal.
            </p>
          </div>
          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            <Link
              href="/dashboard"
              className="text-small text-text-secondary transition-colors hover:text-text-primary"
            >
              Dashboard
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-small text-text-secondary transition-colors hover:text-text-primary"
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
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
      </main>
      <Footer />
    </div>
  );
}
