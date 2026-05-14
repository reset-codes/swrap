# Swrap

**Structured communication for modern communities.**

Swrap is a Walrus-native submission, feedback, and review platform. Create forms, collect submissions, and manage feedback with Walrus-native storage and private access control.

---

## What it is

Swrap abstracts Web3 complexity completely. Users interact with a polished SaaS product. The infrastructure — Walrus storage, Seal encryption, zkLogin onboarding — is invisible.

**Core capabilities:**
- Custom form builder
- Rich submissions (text, files, media, URLs)
- Shareable public forms — no wallet required for submitters
- Seal-encrypted private responses
- Admin review dashboard with filtering, tagging, and CSV export
- zkLogin onboarding (Google sign-in, no seed phrases)

**Underlying infrastructure:**
- [Walrus](https://walrus.xyz) — decentralized blob storage
- [Seal](https://github.com/MystenLabs/seal) — encryption and access control
- [Sui](https://sui.io) — on-chain metadata anchoring

---

## Design philosophy

> "Software-first. Blockchain underneath."

The product feels like Linear met Typeform. Minimal, premium, calm, structured. No crypto aesthetics, no neon gradients, no blockchain jargon in the UI.

---

## Getting started

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in the required values.

---

## Project structure

```
src/app/          — Next.js App Router (production platform)
apps/web/         — POC UI components and pages
apps/api/         — POC API route implementations
packages/shared/  — Design tokens, types, utilities
packages/seal/    — Seal encryption wrapper
packages/walrus/  — Walrus HTTP client
packages/sui/     — Sui signer and metadata anchor
docs/             — Architecture, design system, engineering rules
prisma/           — Database schema
```

---

## Available commands

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm test:run` | Run all tests |
| `pnpm type-check` | TypeScript type check |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm check:contrast` | WCAG contrast verification |

---

## Documentation

- [`docs/CORE_IDEOLOGY.md`](docs/CORE_IDEOLOGY.md) — product vision and principles
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/ENGINEERING_RULES.md`](docs/ENGINEERING_RULES.md) — engineering standards
- [`docs/design-system.md`](docs/design-system.md) — design tokens and component rules
- [`docs/UI_GUIDELINES.md`](docs/UI_GUIDELINES.md) — visual design guidelines
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — POC → Beta → Production roadmap

---

Built on Walrus. Protected with Seal.
