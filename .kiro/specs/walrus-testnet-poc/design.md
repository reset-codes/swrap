# Design Document — Walrus Testnet POC

## Overview

This document specifies the concrete design for the **Walrus Testnet Proof of Concept (POC)** as scoped by `requirements.md`. The goal is a single-machine, single-developer, testnet-connected implementation of the full SEALBASE data flow:

```
Form_Schema → Pretty_Printer → Seal_Encryptor → Walrus_Client (upload)
             → Sui_Client (anchor metadata)
             → Walrus_Client (retrieve) → Seal_Decryptor → Parser → render
Submission  → (same pipeline, keyed off form_blob_id)
```

The implementation lives on branch `walrus-poc`, forked from tag `v0-baseline` at commit `4008fca`. All POC code is additive: it does not edit the existing `src/lib/seal/*`, `src/lib/walrus/*`, `src/lib/wallet/*`, `src/app/api/forms/*`, `src/app/api/submissions/*`, or `src/app/api/upload/*` files on the default branch. The default branch must continue to build, and `v0-baseline` remains a clean rollback anchor.

### POC Boundary Statement (what this design does NOT do)

The POC intentionally excludes, and this design therefore excludes:

- **No NextAuth / OAuth / sessions.** The `/api/poc/*` routes and `/poc/*` pages bypass `auth.ts` entirely. The single actor is the developer running the local machine.
- **No RBAC.** No `owner`/`admin`/`viewer` roles. "Owner" means "the active Sui address returned by Signer_Detector". Decryption authorization = possession of the local Ed25519 secret.
- **No multi-tenant isolation.** No workspace, team, or user tables. The single Local_Signer identity is the entire tenancy boundary.
- **No billing, storage credits, deposit flows.** Walrus publisher-pays-fees model covers testnet upload cost; no credit accounting, no deduction ledger.
- **No production infrastructure.** No VPS, no managed DB, no KMS/HSM, no queue, no observability pipeline, no rate limiter, no CDN.
- **No PostgreSQL for POC paths.** Prisma and `DATABASE_URL` are irrelevant to `/api/poc/*`. The Local_Store is browser-side (Zustand + localStorage) plus an optional `.sealbase-poc/local-store.json` file for dev-only server helpers.
- **No Walrus writes on the default branch.** The production `src/app/api/forms/*` routes remain as-is and continue to require NextAuth.

These are **design invariants**, not aspirations. If a future requirement conflicts with them, that requirement belongs in `sealbase-platform`, not here.

---

## Architecture

### System diagram (component + deployment view)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Browser (single dev machine, trusted environment)                            │
│  ─────────────────────────────────────────────────────────────────────────    │
│  /poc                     Status dashboard (reads /api/poc/health)            │
│  /poc/forms/new           Form_Builder_UI  ──┐                                │
│  /poc/forms/[blob_id]     Owner preview      │                                │
│  /poc/forms/[blob_id]/fill  Form_Submission_UI                                │
│  /poc/submissions/[blob_id] Owner-only submission view                        │
│                                               │                                │
│  Zustand (persist) store: sealbase-poc@1      │                                │
│  localStorage (form & submission index)       │                                │
│                                               ▼                                │
└───────────────────────────────────────────────┼────────────────────────────────┘
                                                │ fetch (same-origin)
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Next.js 15 server (next dev / next start) — same process                     │
│  ─────────────────────────────────────────────────────────────────────────    │
│  src/app/api/poc/health/route.ts         ── apps/api/health                   │
│  src/app/api/poc/forms/route.ts          ── apps/api/forms (POST)             │
│  src/app/api/poc/forms/[blob_id]/route.ts                                     │
│  src/app/api/poc/submissions/route.ts    ── apps/api/submissions (POST)       │
│  src/app/api/poc/submissions/[blob_id]/route.ts                               │
│  src/app/api/poc/metadata/[address]/route.ts                                  │
│                                                                                │
│  (all bypass NextAuth middleware — see "Auth skip" below)                     │
│                                                                                │
│         ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           │
│         │ @poc/shared   │    │ @poc/seal     │    │ @poc/walrus   │           │
│         │  Env_Loader   │    │  Encryptor    │    │  Walrus_Client│           │
│         │  Pretty_Print │    │  Decryptor    │    │  (HTTP)       │           │
│         │  Parser       │    │  Encrypted_   │    └──────┬────────┘           │
│         │  Validator    │    │  Blob format  │           │                    │
│         │  types        │    └──────┬────────┘           │                    │
│         └───────┬───────┘           │                    │                    │
│                 │                   ▼                    │                    │
│                 │           ┌───────────────┐            │                    │
│                 └──────────▶│ @poc/sui      │            │                    │
│                             │  Signer_Detect│            │                    │
│                             │  Sui_Client   │            │                    │
│                             │  Metadata_    │            │                    │
│                             │  Anchor       │            │                    │
│                             └──────┬────────┘            │                    │
└────────────────────────────────────┼─────────────────────┼────────────────────┘
                                     │                     │
                                     ▼                     ▼
┌──────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐
│ Local Sui CLI    │  │ Sui testnet RPC        │  │ Walrus testnet           │
│ ~/.sui/sui_      │  │ https://fullnode.      │  │ publisher:               │
│   config/        │  │   testnet.sui.io:443   │  │ https://publisher.       │
│   client.yaml    │  │                        │  │   walrus-testnet.        │
│   sui.keystore   │  │ (read-only for POC     │  │   walrus.space           │
│                  │  │  except Metadata       │  │ aggregator:              │
│ (read once,      │  │  anchor tx)            │  │ https://aggregator.      │
│  at startup)     │  │                        │  │   walrus-testnet.        │
└──────────────────┘  └────────────────────────┘  │   walrus.space           │
                                                  └──────────────────────────┘
```

### Request flow — create form

```
Browser (Form_Builder_UI)
  │  POST /api/poc/forms  { form_schema }
  ▼
route handler (apps/api/forms.POST)
  │ [env]       Env_Loader.get() (cached)
  │ [signer]    Signer_Detector.load()                 — fails fast if missing
  │ [validate]  Validator.form_schema(body.form_schema)
  │ [parse]     Pretty_Printer.canonicalize(form_schema)  → bytes
  │ [hash]      sha256(bytes)                          → schema_hash
  │ [seal_encrypt] Seal_Encryptor.encrypt(bytes, signer, 'form')
  │                                                    → encrypted_blob
  │ [walrus_publisher] Walrus_Client.put(encrypted_blob, epochs=1)
  │                                                    → blob_id
  │ [sui_anchor] Metadata_Anchor.anchor(blob_id, schema_hash, 'form')
  │                                                    → tx_digest
  ▼
200 OK { blob_id, schema_hash, tx_digest, created_at }
```

Every stage is labeled; these labels are the `stage` field in the error envelope (see **Error Handling**).

---

## Monorepo Strategy

### Decision: Option (a) — path aliases, no workspaces

The repo stays a **single npm project with a single `package.json`**. We do **not** convert to npm workspaces, pnpm workspaces, or turborepo for this POC.

Physical layout on `walrus-poc`:

```
sealbase/
├── apps/
│   ├── web/                      # POC UI code (React components, page bodies)
│   │   ├── pages/
│   │   │   ├── StatusDashboardPage.tsx
│   │   │   ├── FormBuilderPage.tsx       # Form_Builder_UI
│   │   │   ├── FormPreviewPage.tsx
│   │   │   ├── FormFillPage.tsx          # Form_Submission_UI
│   │   │   └── SubmissionViewPage.tsx
│   │   ├── components/
│   │   ├── stores/local-store.ts         # Zustand persist
│   │   └── index.ts                      # re-exports
│   └── api/                      # POC route handler implementations
│       ├── health.ts
│       ├── forms.ts              # POST / GET
│       ├── submissions.ts
│       ├── metadata.ts
│       ├── error-envelope.ts
│       └── index.ts
├── packages/
│   ├── shared/                   # Env_Loader, Pretty_Printer, Parser, Validator, types
│   │   ├── src/
│   │   │   ├── env.ts
│   │   │   ├── types.ts
│   │   │   ├── pretty-printer.ts
│   │   │   ├── parser.ts
│   │   │   ├── validator.ts
│   │   │   ├── schema-hash.ts
│   │   │   └── index.ts
│   │   └── src/*.pbt.test.ts
│   ├── seal/                     # Seal_Encryptor, Seal_Decryptor, wire format
│   │   ├── src/
│   │   │   ├── encrypted-blob.ts  # wire format codec
│   │   │   ├── encryptor.ts
│   │   │   ├── decryptor.ts
│   │   │   └── index.ts
│   │   └── src/*.pbt.test.ts
│   ├── walrus/                   # Walrus_Client (HTTP)
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── health.ts
│   │   │   └── index.ts
│   │   └── src/*.pbt.test.ts
│   └── sui/                      # Signer_Detector, Sui_Client, Metadata_Anchor
│       ├── src/
│       │   ├── signer-detector.ts
│       │   ├── sui-client.ts
│       │   ├── metadata-anchor.ts
│       │   └── index.ts
│       ├── move/sealbase_poc/    # Move package source
│       │   ├── Move.toml
│       │   └── sources/metadata.move
│       └── src/*.pbt.test.ts
├── src/app/poc/                  # Thin Next.js page wrappers
│   ├── page.tsx                              → <StatusDashboardPage />
│   ├── forms/new/page.tsx                    → <FormBuilderPage />
│   ├── forms/[blob_id]/page.tsx              → <FormPreviewPage />
│   ├── forms/[blob_id]/fill/page.tsx         → <FormFillPage />
│   └── submissions/[blob_id]/page.tsx        → <SubmissionViewPage />
├── src/app/api/poc/              # Thin Next.js route wrappers
│   ├── health/route.ts                       → export GET = api.health.GET
│   ├── forms/route.ts                        → POST
│   ├── forms/[blob_id]/route.ts              → GET
│   ├── submissions/route.ts                  → POST
│   ├── submissions/[blob_id]/route.ts        → GET
│   └── metadata/[address]/route.ts           → GET
├── src/lib/...                   # UNCHANGED — existing production-spec code
└── (root package.json, tsconfig.json, next.config.ts updated additively)
```

### tsconfig path aliases

Add to root `tsconfig.json` (`compilerOptions.paths`):

```json
{
  "paths": {
    "@/*": ["./src/*"],
    "@poc/shared":        ["./packages/shared/src/index.ts"],
    "@poc/shared/*":      ["./packages/shared/src/*"],
    "@poc/seal":          ["./packages/seal/src/index.ts"],
    "@poc/seal/*":        ["./packages/seal/src/*"],
    "@poc/walrus":        ["./packages/walrus/src/index.ts"],
    "@poc/walrus/*":      ["./packages/walrus/src/*"],
    "@poc/sui":           ["./packages/sui/src/index.ts"],
    "@poc/sui/*":         ["./packages/sui/src/*"],
    "@poc/apps/web":      ["./apps/web/index.ts"],
    "@poc/apps/web/*":    ["./apps/web/*"],
    "@poc/apps/api":      ["./apps/api/index.ts"],
    "@poc/apps/api/*":    ["./apps/api/*"]
  }
}
```

And add `apps`, `packages` to `include`:

```json
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "apps/**/*", "packages/**/*"]
```

### How R14 is satisfied under option (a)

| Requirement 14 clause | How this design satisfies it |
|---|---|
| 14.1 literal dirs exist | `apps/web`, `apps/api`, `packages/seal`, `packages/walrus`, `packages/sui`, `packages/shared` all exist at `walrus-poc` HEAD as real TS folders with real source files. |
| 14.2 `packages/seal` contains encryptor/decryptor, no imports from `apps/*` | Enforced by an ESLint rule (`no-restricted-imports`) scoped to `packages/**/*.ts`: pattern `@poc/apps/**` → error. |
| 14.3 same for `packages/walrus` | Same ESLint rule. |
| 14.4 same for `packages/sui` | Same ESLint rule. |
| 14.5 same for `packages/shared` | Same ESLint rule. |
| 14.6 both `apps/web` and `apps/api` build cleanly | Root script `build:poc` runs `tsc --noEmit -p tsconfig.poc.json` (a config with `include` limited to `apps/web/**` + deps), `tsc --noEmit -p tsconfig.poc-api.json` (limited to `apps/api/**` + deps), and `next build`. Three exit-zero checks = R14.6 pass. |
| 14.7 POC changes confined to `apps/**`, `packages/**`, or flag-guarded paths | The only files touched outside `apps/` and `packages/` are: root `tsconfig.json` (additive paths), root `package.json` (additive deps + scripts), `next.config.ts` (additive `serverExternalPackages` entries), and the thin wrappers under `src/app/poc/**` and `src/app/api/poc/**`. The `/poc` route prefix is itself the flag guard. |
| 14.8 default branch still builds | No change to default branch. Default branch = `main` at `v0-baseline`; `walrus-poc` is a fork. Default-branch CI is untouched. |

### Trade-offs vs option (b) npm workspaces

| Dimension | (a) path aliases | (b) npm workspaces |
|---|---|---|
| Setup cost | low (tsconfig edit + dirs) | medium (restructure `package.json`, per-package `package.json` × 6, adjust CI) |
| Dependency hygiene | weaker — all deps in root `package.json` | stronger — each package declares its own deps |
| Next.js compat | trivial (Next already respects tsconfig paths) | requires Next.js `transpilePackages` config |
| Jest/vitest compat | works out-of-box with `vite-tsconfig-paths` | requires per-package test config |
| Risk of breaking default branch | zero (purely additive) | non-zero (touches root `package.json` shape, lockfile) |
| Migration to (b) later | easy — move files, add `package.json` per package | N/A |

**We pick (a).** The POC is a 2–3 week exercise; workspace hygiene is not worth the setup cost and the risk of disturbing the default-branch build (R14.8).

### Coexistence with existing `src/`

- `src/lib/seal/*`, `src/lib/walrus/*`, `src/lib/wallet/*`, `src/lib/forms/*`, `src/app/api/forms/*`, `src/app/api/submissions/*`, `src/app/api/upload/*` are **not imported by any POC code**. They continue to serve the default-branch production spec.
- `src/types/form.ts` types are **referenced** (not imported) by `packages/shared/src/types.ts` as the canonical shape to stay compatible with, but `packages/shared` defines its own Zod schemas so that R14.5 (no `apps/*` or `src/app/*` imports) is not violated. The POC schemas are a proper subset of the production schemas.
- `src/app/poc/**` and `src/app/api/poc/**` are the only new files under `src/`. They are one-line files that re-export from `@poc/apps/web` and `@poc/apps/api`.

Example `src/app/api/poc/health/route.ts`:

```typescript
export { GET } from '@poc/apps/api/health';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

---

## Components and Interfaces

### Env_Loader (`packages/shared/src/env.ts`)

Loads and validates the five POC flags plus a handful of endpoint variables. Called exactly once per process, cached in module-level state. **Never** invoked per-request.

```typescript
import { z } from 'zod';

const StrictBool = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((s) => s === 'true');

export const PocEnvSchema = z.object({
  // --- Five POC flags (Requirement 2.1) ---
  DEV_BYPASS_STORAGE:  StrictBool,
  DEV_LOCAL_SIGNER:    StrictBool,
  DEV_ALLOW_PLAINTEXT: StrictBool,
  USE_WALRUS_TESTNET:  StrictBool,
  USE_SUI_TESTNET:     StrictBool,

  // --- Endpoints (defaults supplied when USE_* are true) ---
  WALRUS_PUBLISHER_URL:  z.string().url().default('https://publisher.walrus-testnet.walrus.space'),
  WALRUS_AGGREGATOR_URL: z.string().url().default('https://aggregator.walrus-testnet.walrus.space'),
  SUI_RPC_URL:           z.string().url().default('https://fullnode.testnet.sui.io:443'),

  // --- Sui on-chain module (set after `sui client publish`) ---
  SUI_POC_PACKAGE_ID:    z.string().regex(/^0x[0-9a-f]{64}$/).optional(),

  // --- Safety fuses ---
  NODE_ENV:          z.enum(['development', 'production', 'test']).default('development'),
  POC_ALLOW_PROD:    StrictBool.optional().default('false' as unknown as string),
});

export type PocEnv = z.infer<typeof PocEnvSchema>;

export class EnvLoadError extends Error {
  constructor(public readonly field: string, public readonly reason: string) {
    super(`Env flag "${field}" is invalid: ${reason}`);
    this.name = 'EnvLoadError';
  }
}

let cached: PocEnv | null = null;

/**
 * Load and validate POC env. First call parses process.env; subsequent calls
 * return the cached value. Logs a redacted one-line summary on first success.
 */
export function loadPocEnv(source: NodeJS.ProcessEnv = process.env): PocEnv {
  if (cached) return cached;

  const result = PocEnvSchema.safeParse(source);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new EnvLoadError(issue.path.join('.'), issue.message);
  }

  // Production safety fuse (see Security section)
  if (result.data.NODE_ENV === 'production' && !result.data.POC_ALLOW_PROD) {
    throw new EnvLoadError(
      'NODE_ENV',
      'POC is disabled in production. Set POC_ALLOW_PROD=true to override (not recommended).',
    );
  }

  cached = result.data;
  logEnvOnce(cached); // ONE-TIME log
  return cached;
}

/** For tests only. */
export function _resetPocEnvForTesting(): void {
  cached = null;
}

function logEnvOnce(env: PocEnv): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'poc_env_loaded',
      flags: {
        DEV_BYPASS_STORAGE:  env.DEV_BYPASS_STORAGE,
        DEV_LOCAL_SIGNER:    env.DEV_LOCAL_SIGNER,
        DEV_ALLOW_PLAINTEXT: env.DEV_ALLOW_PLAINTEXT,
        USE_WALRUS_TESTNET:  env.USE_WALRUS_TESTNET,
        USE_SUI_TESTNET:     env.USE_SUI_TESTNET,
      },
      endpoints: {
        walrus_publisher:  env.WALRUS_PUBLISHER_URL,
        walrus_aggregator: env.WALRUS_AGGREGATOR_URL,
        sui_rpc:           env.SUI_RPC_URL,
      },
      sui_package_id_set: !!env.SUI_POC_PACKAGE_ID,
    }),
  );
}
```

**Abort-on-missing behavior:** if any of the five flags is absent or is not exactly `"true"` / `"false"` (case-insensitive), `loadPocEnv` throws `EnvLoadError` with the field name. Route handlers catch `EnvLoadError` and return HTTP 500 with `{ error: { code: 'ENV_INVALID', stage: 'env', message, details: { field } } }` (see **Error Handling**). The app process itself does **not** crash in `next dev`, but `/api/poc/*` is unusable until the env is corrected.

### Signer_Detector (`packages/sui/src/signer-detector.ts`)

Reads the local Sui CLI configuration, resolves the active keypair, returns a wrapped signer that exposes only public operations. The raw secret bytes stay inside a closure and are never returned, logged, or serialized.

```typescript
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'js-yaml';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { TransactionBlock } from '@mysten/sui/transactions';

export type SignerScheme = 'ed25519' | 'secp256k1' | 'secp256r1';

export interface PocSigner {
  readonly scheme: SignerScheme;
  readonly address: string;                 // 0x-prefixed 32-byte hex
  getPublicKey(): Uint8Array;               // raw 32 bytes (ed25519) or 33 bytes (compressed secp)
  signPersonalMessage(bytes: Uint8Array): Promise<{ signature: string; bytes: string }>;
  signTransaction(tx: TransactionBlock): Promise<{ signature: string; bytes: string }>;
  /** Seal-only: derive a 32-byte symmetric key from the secret + salt/info (HKDF). */
  deriveSymmetricKey(salt: Uint8Array, info: Uint8Array): Uint8Array;
}

export interface SignerDetectorResult {
  signer: PocSigner;
  activeNetwork: string;                    // e.g. "testnet"
  clientYamlPath: string;
  keystorePath: string;
}

export class SignerDetectorError extends Error {
  constructor(
    public readonly code:
      | 'MissingClientYaml'
      | 'MissingKeystore'
      | 'NoMatchingKey'
      | 'UnsupportedScheme'
      | 'MalformedClientYaml'
      | 'MalformedKeystore',
    public readonly path: string,
    public readonly field?: string,
    message?: string,
  ) {
    super(message ?? `${code} at ${path}${field ? ` (field: ${field})` : ''}`);
    this.name = 'SignerDetectorError';
  }
}

export async function detectLocalSigner(): Promise<SignerDetectorResult> {
  const clientYamlPath = join(homedir(), '.sui', 'sui_config', 'client.yaml');
  const defaultKeystorePath = join(homedir(), '.sui', 'sui_config', 'sui.keystore');

  // 1. Read client.yaml
  let yamlRaw: string;
  try {
    yamlRaw = await readFile(clientYamlPath, 'utf-8');
  } catch (err) {
    throw new SignerDetectorError('MissingClientYaml', clientYamlPath);
  }
  let yaml: any;
  try {
    yaml = parseYaml(yamlRaw);
  } catch (err) {
    throw new SignerDetectorError('MalformedClientYaml', clientYamlPath);
  }
  const activeAddress: string | undefined = yaml?.active_address;
  const activeEnv: string | undefined = yaml?.active_env;
  const keystorePath: string = yaml?.keystore?.File ?? defaultKeystorePath;

  if (!activeAddress) throw new SignerDetectorError('MalformedClientYaml', clientYamlPath, 'active_address');
  if (!activeEnv)     throw new SignerDetectorError('MalformedClientYaml', clientYamlPath, 'active_env');

  // 2. Read sui.keystore (JSON array of base64-encoded bech32 private keys)
  let keystoreRaw: string;
  try {
    keystoreRaw = await readFile(keystorePath, 'utf-8');
  } catch {
    throw new SignerDetectorError('MissingKeystore', keystorePath);
  }
  let entries: string[];
  try {
    entries = JSON.parse(keystoreRaw);
    if (!Array.isArray(entries)) throw new Error('not array');
  } catch {
    throw new SignerDetectorError('MalformedKeystore', keystorePath);
  }

  // 3. Find the entry whose derived address matches active_address
  for (const entry of entries) {
    const { schema, secretKey } = decodeSuiPrivateKey(entry);
    //   ^ decodeSuiPrivateKey handles the `suiprivkey1...` bech32 form used
    //     by the Sui CLI keystore, returning scheme + 32-byte secret.

    try {
      const keypair = buildKeypair(schema, secretKey);
      if (keypair.toSuiAddress() === activeAddress) {
        return {
          signer: wrapKeypair(keypair, schema as SignerScheme),
          activeNetwork: activeEnv,
          clientYamlPath,
          keystorePath,
        };
      }
    } catch (err) {
      if ((err as SignerDetectorError).code === 'UnsupportedScheme') throw err;
      // otherwise continue — malformed entry, try next
    }
  }

  throw new SignerDetectorError('NoMatchingKey', keystorePath, 'active_address');
}

function buildKeypair(scheme: string, secretKey: Uint8Array) {
  switch (scheme) {
    case 'ED25519':   return Ed25519Keypair.fromSecretKey(secretKey);
    case 'Secp256k1': return Secp256k1Keypair.fromSecretKey(secretKey);
    case 'Secp256r1': return Secp256r1Keypair.fromSecretKey(secretKey);
    default:
      throw new SignerDetectorError('UnsupportedScheme', '', scheme);
  }
}

/**
 * Wrap the keypair so callers never receive the secret bytes. The secret lives
 * only inside this function's closure. `deriveSymmetricKey` is the ONLY path
 * that exposes key-derived material (never the raw secret).
 */
function wrapKeypair(kp: Ed25519Keypair | Secp256k1Keypair | Secp256r1Keypair, scheme: SignerScheme): PocSigner {
  const secret: Uint8Array = (kp as any).getSecretKey
    ? decodeSuiPrivateKey((kp as any).getSecretKey()).secretKey
    : (kp as any).keypair.secretKey.slice(0, 32);

  return Object.freeze({
    scheme,
    address: kp.toSuiAddress(),
    getPublicKey: () => kp.getPublicKey().toRawBytes(),
    signPersonalMessage: (bytes) => kp.signPersonalMessage(bytes),
    signTransaction: (tx) => kp.signTransaction((tx as any).serialize()),
    deriveSymmetricKey: (salt, info) => hkdfSha256(secret, salt, info, 32),
  });
}

// `hkdfSha256` implemented via Node's built-in crypto.hkdfSync — see packages/seal/src/encryptor.ts
```

**Security rules (enforced by code review and the test suite):**

1. The raw `secret` variable is referenced only inside `wrapKeypair`'s closure. Any new method on `PocSigner` that would expose it must be rejected in review.
2. `PocSigner` has **no** `toJSON`, no `toString` override that exposes secrets, no getter named `secret*`, `privateKey`, or similar. A lint rule in `packages/sui/.eslintrc.json` forbids those property names.
3. No field of `SignerDetectorResult` is ever serialized to a log line or an API response. `/api/poc/health` only returns `signer.address` and `activeNetwork`.

**Error surface:**

| Code | When | Surfaced as |
|---|---|---|
| `MissingClientYaml` | `~/.sui/sui_config/client.yaml` unreadable | HTTP 500, stage `signer`, code `SIGNER_MISSING_CLIENT_YAML`, details `{ path }` |
| `MalformedClientYaml` | YAML parse fails, or `active_address` / `active_env` absent | HTTP 500, stage `signer`, code `SIGNER_MALFORMED_CLIENT_YAML`, details `{ path, field? }` |
| `MissingKeystore` | `sui.keystore` unreadable | HTTP 500, stage `signer`, code `SIGNER_MISSING_KEYSTORE`, details `{ path }` |
| `MalformedKeystore` | Not JSON, not an array | HTTP 500, stage `signer`, code `SIGNER_MALFORMED_KEYSTORE`, details `{ path }` |
| `NoMatchingKey` | No entry derives to `active_address` | HTTP 500, stage `signer`, code `SIGNER_NO_MATCHING_KEY` |
| `UnsupportedScheme` | Keystore contains a scheme outside {Ed25519, Secp256k1, Secp256r1} | HTTP 500, stage `signer`, code `SIGNER_UNSUPPORTED_SCHEME`, details `{ scheme }` |

### Sui_Client (`packages/sui/src/sui-client.ts`)

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import type { PocSigner } from './signer-detector';

export interface MetadataRecord {
  object_id:      string;       // Sui owned-object ID of the MetadataRecord
  blob_id:        string;       // Walrus blob ID
  schema_hash:    string;       // hex-encoded sha256
  record_type:    'form' | 'submission';
  form_blob_id?:  string;       // only set when record_type === 'submission'
  owner_address:  string;
  created_at:     string;       // ISO 8601
  tx_digest:      string;
}

export class SuiClientError extends Error {
  constructor(
    public readonly code: 'RPC_UNREACHABLE' | 'RPC_TIMEOUT' | 'TX_FAILED' | 'QUERY_FAILED' | 'INSUFFICIENT_GAS',
    public readonly endpoint: string,
    message: string,
  ) { super(message); this.name = 'SuiClientError'; }
}

export function createSuiClient(rpcUrl: string = getFullnodeUrl('testnet')): SuiClient {
  return new SuiClient({ url: rpcUrl });
}

export async function getBalance(
  client: SuiClient,
  address: string,
): Promise<{ totalBalance: string; coinType: string }> { /* ... */ }

export async function signAndExecuteTestMessage(
  signer: PocSigner,
): Promise<{ signature: string; valid: boolean }> { /* round-trip sign+verify of a static test payload */ }

export async function executeTransaction(
  client: SuiClient,
  tx: Transaction,
  signer: PocSigner,
): Promise<{ digest: string; effects: 'success' | 'failure'; errorMsg?: string }> { /* ... */ }

export async function queryMetadataRecords(
  client: SuiClient,
  packageId: string,
  owner: string,
): Promise<MetadataRecord[]> { /* queryEvents + getOwnedObjects */ }
```

All functions accept a 10-second abort via `AbortController` passed as an optional second argument (Requirement 4 / R5.2). Any request that exceeds 10s throws `SuiClientError('RPC_TIMEOUT')`.

### Metadata_Anchor — Move package (recommended path)

The POC publishes a minimal Move package under `packages/sui/move/sealbase_poc/` exactly **once**, manually, by the developer running:

```bash
cd packages/sui/move/sealbase_poc
sui client publish --gas-budget 100000000
```

The returned `packageId` is recorded in `SUI_POC_PACKAGE_ID` and loaded by Env_Loader. The Move module:

**`packages/sui/move/sealbase_poc/Move.toml`**

```toml
[package]
name = "sealbase_poc"
version = "0.1.0"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }

[addresses]
sealbase_poc = "0x0"
```

**`packages/sui/move/sealbase_poc/sources/metadata.move`**

```move
/// POC-only metadata anchor for SEALBASE Walrus blobs.
/// NOT production. Fields are intentionally small and the module has no upgrade path.
module sealbase_poc::metadata {
    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};
    use std::vector;

    /// record_type encoding
    const RECORD_TYPE_FORM: u8 = 1;
    const RECORD_TYPE_SUBMISSION: u8 = 2;

    /// Errors
    const EInvalidRecordType: u64 = 1;
    const EInvalidBlobId: u64 = 2;
    const EInvalidSchemaHash: u64 = 3;

    /// Owned on-chain anchor. Stores ONLY references/hashes — never plaintext.
    public struct MetadataRecord has key, store {
        id:             UID,
        blob_id:        vector<u8>,   // Walrus blob id as UTF-8 bytes
        schema_hash:    vector<u8>,   // sha256 of canonical JSON — 32 bytes
        record_type:    u8,           // 1 = form, 2 = submission
        form_blob_id:   Option<vector<u8>>, // set iff record_type == 2
        owner_address:  address,
        created_at_ms:  u64,
    }

    /// Event emitted on anchor so clients can index without scanning owned objects.
    public struct MetadataAnchored has copy, drop {
        record_id:     address,
        blob_id:       vector<u8>,
        schema_hash:   vector<u8>,
        record_type:   u8,
        form_blob_id:  Option<vector<u8>>,
        owner_address: address,
        created_at_ms: u64,
    }

    /// Entry function called by the Metadata_Anchor from `@poc/sui`.
    public entry fun anchor_record(
        blob_id:      vector<u8>,
        schema_hash:  vector<u8>,
        record_type:  u8,
        form_blob_id: Option<vector<u8>>,
        ctx:          &mut TxContext,
    ) {
        assert!(record_type == RECORD_TYPE_FORM || record_type == RECORD_TYPE_SUBMISSION, EInvalidRecordType);
        assert!(vector::length(&blob_id) > 0, EInvalidBlobId);
        assert!(vector::length(&schema_hash) == 32, EInvalidSchemaHash);
        if (record_type == RECORD_TYPE_SUBMISSION) {
            assert!(option::is_some(&form_blob_id), EInvalidRecordType);
        } else {
            assert!(option::is_none(&form_blob_id), EInvalidRecordType);
        };

        let owner = tx_context::sender(ctx);
        let now   = tx_context::epoch_timestamp_ms(ctx);
        let record = MetadataRecord {
            id:             object::new(ctx),
            blob_id,
            schema_hash,
            record_type,
            form_blob_id,
            owner_address:  owner,
            created_at_ms:  now,
        };
        event::emit(MetadataAnchored {
            record_id:     object::uid_to_address(&record.id),
            blob_id:       record.blob_id,
            schema_hash:   record.schema_hash,
            record_type:   record.record_type,
            form_blob_id:  record.form_blob_id,
            owner_address: record.owner_address,
            created_at_ms: record.created_at_ms,
        });
        transfer::public_transfer(record, owner);
    }
}
```

The TS-side anchor is thin:

```typescript
// packages/sui/src/metadata-anchor.ts
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/bcs';
import type { PocSigner } from './signer-detector';

export async function anchorRecord(
  client: SuiClient,
  packageId: string,
  signer: PocSigner,
  args: {
    blobId:      string;
    schemaHash:  Uint8Array;   // 32 bytes
    recordType:  'form' | 'submission';
    formBlobId?: string;
  },
): Promise<{ txDigest: string; recordId: string }> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::metadata::anchor_record`,
    arguments: [
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(args.blobId))),
      tx.pure(bcs.vector(bcs.u8()).serialize(args.schemaHash)),
      tx.pure.u8(args.recordType === 'form' ? 1 : 2),
      tx.pure(
        bcs.option(bcs.vector(bcs.u8())).serialize(
          args.formBlobId ? new TextEncoder().encode(args.formBlobId) : null,
        ),
      ),
    ],
  });
  tx.setSender(signer.address);
  tx.setGasBudget(10_000_000n);

  const { bytes, signature } = await signer.signTransaction(tx);
  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature,
    options: { showEvents: true, showEffects: true },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`sui_anchor failed: ${result.effects?.status?.error ?? 'unknown'}`);
  }
  const event = result.events?.find((e) => e.type.endsWith('::metadata::MetadataAnchored'));
  return { txDigest: result.digest, recordId: (event?.parsedJson as any)?.record_id ?? '' };
}
```

**Why Move package, not a pure self-transfer + pure-arg payload:** the self-transfer fallback works but is indistinguishable from any other self-transfer on Suiscan, and `queryMetadataRecords` would have to scan every `PaySui` transaction to find POC metadata — expensive and fragile. The Move package gives us a typed event (`MetadataAnchored`) and an owned object (`MetadataRecord`) that Sui's `queryEvents({ MoveEventModule: { package, module: 'metadata' } })` and `getOwnedObjects({ filter: StructType })` index efficiently. The one-time manual publish is a fair price.

**Fallback for the first-hour demo before `sui client publish`:** a transaction that transfers a zero-value `Coin<SUI>` to the signer's own address, carrying a single `TransactionBlock.pure` vector-of-u8 argument whose contents are `|| 'SBPOC' || record_type:u8 || sha256(canonical_bytes)(32) || blob_id_utf8 || form_blob_id_utf8? ||`. This is exactly the self-transfer path the user described. It is acceptable for the first two weeks of work; the Move package replaces it before Phase 5 (metadata anchoring) closes.

### Walrus_Client (`packages/walrus/src/client.ts`)

Pure HTTP client; no Sui signing required on the client side because the testnet publisher pays SUI fees on behalf of the uploader.

```typescript
export interface WalrusClientConfig {
  publisherUrl:       string;
  aggregatorUrl:      string;
  uploadTimeoutMs?:   number;   // default 30_000 (R10.3)
  retrieveTimeoutMs?: number;   // default 30_000 (R10.6)
  healthTimeoutMs?:   number;   // default 10_000 (R5.2)
  defaultEpochs?:     number;   // default 1
}

export type WalrusBlobId = string;

export interface WalrusPutResult {
  blobId:   WalrusBlobId;
  isNew:    boolean;
  endpoint: string;     // the publisher URL used
}

export class WalrusError extends Error {
  constructor(
    public readonly code:
      | 'PUBLISHER_TIMEOUT'
      | 'PUBLISHER_UNREACHABLE'
      | 'PUBLISHER_REJECTED'
      | 'AGGREGATOR_TIMEOUT'
      | 'AGGREGATOR_UNREACHABLE'
      | 'AGGREGATOR_NOT_FOUND'
      | 'BAD_RESPONSE'
      | 'HEALTH_PUBLISHER_FAIL'
      | 'HEALTH_AGGREGATOR_FAIL'
      | 'SIGNER_NOT_READY',
    public readonly endpoint: string,
    public readonly reason: string,
  ) { super(`${code} @ ${endpoint}: ${reason}`); this.name = 'WalrusError'; }
}

export interface WalrusClient {
  put(bytes: Uint8Array, opts?: { epochs?: number }): Promise<WalrusPutResult>;
  get(blobId: WalrusBlobId): Promise<Uint8Array>;
  healthCheck(): Promise<{
    publisher:  { ok: boolean; url: string; latencyMs: number; reason?: string };
    aggregator: { ok: boolean; url: string; latencyMs: number; reason?: string };
  }>;
}

export function createWalrusClient(config: WalrusClientConfig): WalrusClient;
```

**Upload path** — `PUT ${publisherUrl}/v1/blobs?epochs=${epochs}` with `Content-Type: application/octet-stream`, body = raw bytes. Response shape (per Walrus testnet publisher):

```json
{"newlyCreated": {"blobObject": {"blobId": "...", ...}}}   // first upload of these bytes
{"alreadyCertified": {"blobId": "...", ...}}               // dedup
```

**Retrieve path** — `GET ${aggregatorUrl}/v1/blobs/${blobId}`, raw body = bytes.

**Health check** — `GET ${publisherUrl}/v1/api` (OpenAPI spec endpoint) and `GET ${aggregatorUrl}/v1/api`; each with its own `AbortController` set to `healthTimeoutMs`. Both must return 2xx within the timeout. The health check is run:
- Once at process startup (from `Env_Loader` → server boot init).
- On every `/api/poc/health` request (with results cached for 5s to avoid hammering testnet on page reloads).

**Signer status semantics.** The Walrus HTTP publisher does not require a client-side signature on uploads — it pays the Sui fees itself. Therefore `signer_status` reported by `/api/poc/health` is defined as:

```
signer_status = (Signer_Detector succeeded) AND (publisher health OK) AND (aggregator health OK)
              ? 'ready'
              : 'not_ready'
```

This keeps R5.3 ("log signer status as exactly `ready` or exactly `not_ready`") meaningful despite the publisher-pays-fees model, and satisfies R5.5 / R5.6 (reject uploads when `not_ready`).

**Retry policy.** Three attempts, exponential backoff `1s, 2s, 4s`, only on HTTP 5xx and network-level errors. 4xx is never retried — it is a client-side problem (oversize blob, rejected content). On the aggregator side, 404 is never retried (the blob hasn't been published yet, retrying won't help within a request scope).

### Seal_Encryptor / Seal_Decryptor (`packages/seal/src/*`)

#### Plan A (preferred) — `@mysten/seal` integration

At design time, `@mysten/seal` is not yet published as a stable npm package (verified via `npm view @mysten/seal` — returns 404 or an unstable alpha as of the `walrus-poc` fork date). If a stable version ships before implementation, the interfaces below bind directly to it.

#### Plan B (POC fallback — must be explicit)

Use AES-256-GCM with the key derived from the Local_Signer's secret via HKDF-SHA-256. This keeps the invariant "only the Owner's local signer can decrypt" semantically true for the POC, because the key is bound 1:1 to the local keypair. A startup log line `WARNING: Seal fallback mode active — using AES-256-GCM + HKDF-from-local-signer; NOT real Seal` is emitted on process boot when `@mysten/seal` is not available, and `/api/poc/health` returns `seal.mode: 'fallback'`.

Plan B does **not** reuse `src/lib/seal/client.ts` as-is: that client derives its key from an arbitrary `policyId` string (which works for the production spec but would be wrong here because the POC has no policy service). Plan B's `packages/seal` is a new implementation that derives the key from the signer secret.

#### Encrypted_Blob wire format (versioned, BCS-adjacent)

```
Offset  Size  Field           Notes
------  ----  --------------  ---------------------------------
  0      1   version          0x01 (only value accepted)
  1      1   scheme_id        0x01 = AES-256-GCM + HKDF
  2     32   owner_address    tx sender's 32-byte Sui address
 34     16   salt             per-blob random salt (HKDF)
 50     12   nonce            AES-GCM IV (96-bit)
 62     16   tag              AES-GCM auth tag
 78      4   blob_type        'form' | 'subm' (ASCII, padded)
 82    var   ciphertext       AES-GCM ciphertext (no separate length prefix — consumes rest)
```

Total header: 82 bytes. Validator recognises an Encrypted_Blob by: `bytes[0] === 0x01 && bytes[1] === 0x01 && bytes.length >= 82`. For R8.6 ("Validator rejects non-Encrypted_Blob when `DEV_ALLOW_PLAINTEXT=false`"), this check is the entire gate.

```typescript
// packages/seal/src/encrypted-blob.ts
export interface EncryptedBlobHeader {
  version: 1;
  schemeId: 1;                          // AES-256-GCM + HKDF
  ownerAddress: string;                 // hex, 0x-prefixed
  salt: Uint8Array;                     // 16 bytes
  nonce: Uint8Array;                    // 12 bytes
  tag: Uint8Array;                      // 16 bytes
  blobType: 'form' | 'subm';
}
export interface EncryptedBlob {
  header: EncryptedBlobHeader;
  ciphertext: Uint8Array;
}

export function encode(blob: EncryptedBlob): Uint8Array { /* ... */ }
export function decode(bytes: Uint8Array): EncryptedBlob;      // throws ParseError
export function looksLikeEncryptedBlob(bytes: Uint8Array): boolean; // cheap header check
```

```typescript
// packages/seal/src/encryptor.ts
import { hkdfSync, createCipheriv, randomBytes } from 'node:crypto';
import type { PocSigner } from '@poc/sui/signer-detector';
import { encode, type EncryptedBlob } from './encrypted-blob';

export function encrypt(
  plaintext: Uint8Array,
  signer: PocSigner,
  blobType: 'form' | 'subm',
): Uint8Array {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const info = new TextEncoder().encode(`sealbase-poc-v1|${blobType}|${signer.address}`);
  const key = signer.deriveSymmetricKey(salt, info);     // 32 bytes
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    header: { version: 1, schemeId: 1, ownerAddress: signer.address, salt, nonce, tag, blobType },
    ciphertext: ct,
  };
  return encode(blob);
}
```

```typescript
// packages/seal/src/decryptor.ts
export class SealAuthError extends Error { readonly category = 'authorization'; }
export class SealParseError extends Error { readonly category = 'parse'; }

export function decrypt(blobBytes: Uint8Array, signer: PocSigner): Uint8Array {
  let parsed: EncryptedBlob;
  try { parsed = decode(blobBytes); } catch (e) {
    throw new SealParseError((e as Error).message);
  }
  if (parsed.header.ownerAddress !== signer.address) {
    throw new SealAuthError(`rejected signer ${signer.address}; blob owned by ${parsed.header.ownerAddress}`);
  }
  const info = new TextEncoder().encode(`sealbase-poc-v1|${parsed.header.blobType}|${parsed.header.ownerAddress}`);
  const key = signer.deriveSymmetricKey(parsed.header.salt, info);
  const decipher = createDecipheriv('aes-256-gcm', key, parsed.header.nonce);
  decipher.setAuthTag(parsed.header.tag);
  try {
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  } catch {
    // GCM auth failure — indistinguishable from tamper; category is 'parse' per R7.6
    throw new SealParseError('AES-GCM authentication failed');
  }
}
```

**Plan A migration path.** When `@mysten/seal` stabilizes, `packages/seal/src/encryptor.ts` and `decryptor.ts` are rewritten to call the SDK. The public surface (`encrypt(plaintext, signer, blobType)`, `decrypt(bytes, signer)`) stays identical, so route handlers and tests do not change. The wire-format version byte (`0x01`) is retained so in-flight blobs under Plan B stay decryptable; Plan A blobs use version `0x02`.

### Pretty_Printer / Parser / Validator (`packages/shared/src/*`)

#### Pretty_Printer — RFC 8785 (JCS) canonical JSON

```typescript
// packages/shared/src/pretty-printer.ts

/**
 * Canonicalize a JSON-serializable value per RFC 8785 (JSON Canonicalization Scheme).
 *
 * Rules:
 *   - Objects: keys sorted by UTF-16 code unit (lexicographic on the surrogate
 *     representation), no whitespace, UTF-8 output.
 *   - Arrays: insertion order preserved.
 *   - Numbers: normalized per RFC 8785 §3.2.2 (no trailing zeros, no +0/-0
 *     distinction, exponent 'e' lowercase, etc.). We delegate to the
 *     `@truestamp/canonify` or equivalent library; if none is acceptable,
 *     we implement §3.2.2 directly (ECMAScript ToString for numbers yields
 *     the correct representation for all IEEE-754 finite doubles).
 *   - Strings: escape rules per RFC 8259 §7 (backslash, quote, control chars
 *     < U+0020 escaped as \uXXXX; non-ASCII unescaped).
 *   - null / true / false: literal.
 *   - Rejects: undefined, functions, symbols, NaN, +/-Infinity, bigint.
 */
export function canonicalize(value: unknown): Uint8Array;

export function canonicalizeToString(value: unknown): string;
```

#### Schema_Hash

```typescript
// packages/shared/src/schema-hash.ts
import { createHash } from 'node:crypto';
import { canonicalize } from './pretty-printer';

export function schemaHash(value: unknown): Uint8Array {
  return createHash('sha256').update(canonicalize(value)).digest();
}

export function schemaHashHex(value: unknown): string {
  return Buffer.from(schemaHash(value)).toString('hex');
}
```

#### Parser (`packages/shared/src/parser.ts`)

```typescript
import { FormSchemaSchema, SubmissionSchema } from './validator';

export class ParseError extends Error { readonly category = 'parse'; }
export class ValidateError extends Error { readonly category = 'validate'; constructor(public issues: unknown[]) { super('validation failed'); } }

export function parseFormSchema(bytes: Uint8Array): FormSchema {
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (e) { throw new ParseError((e as Error).message); }
  const result = FormSchemaSchema.safeParse(json);
  if (!result.success) throw new ValidateError(result.error.issues);
  return result.data;
}

export function parseSubmission(bytes: Uint8Array): Submission { /* identical shape */ }
```

#### Validator / Zod schemas (`packages/shared/src/validator.ts`)

The POC schema is a strict subset of `src/lib/forms/schemas.ts`, using the smaller field-type set R10.2 prescribes:

```typescript
import { z } from 'zod';

export const PocFieldTypeSchema = z.enum([
  'text', 'long_text', 'number', 'email', 'url', 'select', 'checkbox',
]);

export const PocFieldSchema = z.object({
  id:       z.string().min(1),
  type:     PocFieldTypeSchema,
  label:    z.string().min(1).max(100),       // R10.2
  required: z.boolean().default(false),
  options:  z.array(z.string().min(1)).optional(), // only for 'select'
});

export const FormSchemaSchema = z.object({
  id:          z.string().min(1),
  title:       z.string().min(1).max(200),    // R10.1
  fields:      z.array(PocFieldSchema).max(50), // R10.1
  version:     z.literal(1),                  // migration fence
  created_at:  z.string().datetime(),
});
export type FormSchema = z.infer<typeof FormSchemaSchema>;

export const AnswerValueSchema = z.union([
  z.string(), z.number(), z.boolean(), z.null(),
]);

export const AnswerSchema = z.object({
  field_id: z.string().min(1),
  value:    AnswerValueSchema,
});

export const SubmissionSchema = z.object({
  form_blob_id:     z.string().min(1),
  form_schema_hash: z.string().regex(/^[0-9a-f]{64}$/),
  answers:          z.array(AnswerSchema),
  submitted_at:     z.string().datetime(),
});
export type Submission = z.infer<typeof SubmissionSchema>;
```

The Validator also performs **cross-schema** checks that Zod cannot express inline:

- Submission answers' `field_id`s must be a subset of the Form_Schema's `fields[*].id`.
- Answers for `required: true` fields must be non-null and, for string types, non-empty.
- The `form_schema_hash` must equal `schemaHashHex(form_schema)` recomputed at validation time.

```typescript
export function validateSubmissionAgainstForm(
  submission: Submission,
  form: FormSchema,
): { ok: true } | { ok: false; issues: Array<{ field_id?: string; code: string; message: string }> };
```

---

## Data Models

### TypeScript interfaces (single source of truth = `packages/shared/src/types.ts`)

```typescript
export interface FormSchema {
  id:         string;                                   // uuid v4
  title:      string;                                   // 1..200 chars
  fields:     FormField[];                              // 0..50
  version:    1;
  created_at: string;                                   // ISO 8601
}

export type FieldType = 'text' | 'long_text' | 'number' | 'email' | 'url' | 'select' | 'checkbox';

export interface FormField {
  id:       string;
  type:     FieldType;
  label:    string;                                     // 1..100 chars
  required: boolean;
  options?: string[];                                   // only when type === 'select'
}

export type AnswerValue = string | number | boolean | null;

export interface Answer {
  field_id: string;
  value:    AnswerValue;
}

export interface Submission {
  form_blob_id:     string;
  form_schema_hash: string;                             // 64-char hex
  answers:          Answer[];
  submitted_at:     string;                             // ISO 8601
}
```

### Local_Store schema (persisted — Zustand with `persist`)

Key: `sealbase-poc@1` (migration fence; bumping to `@2` discards old data).

```typescript
export interface PersistedFormEntry {
  blob_id:        string;
  schema_hash:    string;
  title:          string;                               // 1..200 chars
  owner_address:  string;
  created_at:     string;                               // ISO 8601 UTC
  sui_anchored:   { tx_digest: string; record_id: string } | null;
  status:         'anchored' | 'unlinked';              // R11.5
}

export interface PersistedSubmissionEntry {
  blob_id:        string;
  form_blob_id:   string;
  submitted_at:   string;
  owner_address:  string;                               // the form owner
  sui_anchored:   { tx_digest: string; record_id: string } | null;
}

export interface PocStoreState {
  version:       1;                                     // migration fence
  forms:         Record<string /* blob_id */, PersistedFormEntry>;
  submissions:   Record<string /* blob_id */, PersistedSubmissionEntry>;
  // ephemeral — never persisted; see PersistableEntry note below
  scratch?:      { formBuilderDraft?: unknown };       // marked `partialize` exclude
}
```

**Type-level exclusion rules.** We define:

```typescript
type ForbiddenKey = 'plaintext' | 'plainText' | 'secret' | 'privateKey' | 'keystore' | 'signer';
type PersistableEntry<T> = {
  [K in keyof T as K extends ForbiddenKey ? never : K]: T[K];
};
```

Zustand's `persist` middleware is configured with `partialize: (state) => ({ version: state.version, forms: state.forms, submissions: state.submissions })` — `scratch` is deliberately excluded. The PR adding any field to `PersistedFormEntry` or `PersistedSubmissionEntry` is reviewed against `ForbiddenKey`; the type check fails the build if a forbidden key is added.

### Server-side dev store (optional, JSON file)

For dev-only helpers (e.g., `GET /api/poc/metadata/:address` needs a place to cache last-seen event cursor), we keep a single JSON file at `.sealbase-poc/local-store.json` gitignored. Same schema as client-side; same migration fence. No plaintext or secret keys; only cursors + indices.

### Local_Store migration plan

- `version: 1` — initial. All fields above.
- Breaking changes bump to `version: 2`. The Zustand `persist` `migrate(persistedState, fromVersion)` handler discards persisted data when `fromVersion < currentVersion` and shows a toast "Local POC cache upgraded; please re-upload any unsaved forms". This is acceptable because:
  1. Walrus is the canonical source for every form and every submission (CORE_IDEOLOGY rule 1).
  2. Sui is the canonical source for every metadata record (R13).
  3. So the Local_Store is a pure cache; discarding it on version bump is safe.


---

## UI and Design System

This section satisfies **Requirement 19** (Design System and UI Consistency) and governs every surface under `apps/web/` and `src/app/poc/`. It is binding on Phase 4 (Form_Builder_UI), Phase 5 (Form_Submission_UI), and the status dashboard. It is **not** advisory.

### Visual philosophy

SealBase must read as **serious infrastructure software for encrypted forms** — closer to Linear, Vercel, Notion, Raycast, Stripe Docs, and Supabase than to any crypto dashboard, DAO console, or NFT marketplace. The tone is minimal, technical, calm, trustworthy, crypto-native, and developer-first. Three principles govern every UI decision:

1. **Forms are the primary object.** Every page is organized around forms, submissions, blobs, encryption state, and ownership — nothing else. Pages prioritize clarity, flow, and low cognitive load. No secondary product pillars exist in the POC.
2. **Encryption should feel invisible.** The UI never uses raw cryptographic or storage-infrastructure terms in user-visible copy. It uses "Securing your form…" instead of "Encrypting payload with decentralized blob storage…". Technical detail stays in developer tooling (console logs, `/api/poc/health`) — never in the body of a flow.
3. **Local-first feeling.** The app renders instantly, preserves state across reloads, and never blocks on a full-page refresh. Optimistic UX is preferred: the UI moves to the next state as soon as the local action (encrypt + local persist) succeeds, and reconciles the Walrus/Sui result in the background.

This translates to explicit "do / don't" rules for implementers:

| Must                                                         | Must not                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| Neutral/slate base with one subtle blue accent               | Rainbow gradients, neon purple/cyan, chart-style palettes    |
| Inter **or** Geist as sole typeface                          | Marketing display fonts, decorative fonts, additional families |
| Opacity fades and small transforms (≤8px translate)          | Bouncing, overshoot, parallax, confetti, spring physics      |
| shadcn-style variant-based primitives, one API per primitive | One-off giant components, duplicated button logic, inline `style={{…}}` |
| V1 field types: `text`, `textarea`, `email`, `number`, `select`, `checkbox` | Drag-heavy builders, conditional logic, workflow engines, automation |
| Dashboard order: Name → Submissions → Encryption → Upload → Blob Ref → Last Activity | Analytics widgets, charts, marketing content, crypto-flash transitions |

### Design_Tokens module

**Location:** `packages/shared/src/design-tokens.ts` (re-exported from `@poc/shared`).

The Design_Tokens module is the single source of truth for every visual primitive used in the POC UI. Components MUST import from this module and MUST NOT hard-code numeric spacing, color hex/hsl literals, radius values, or animation durations in component source. The **only** permitted escape is a value that provably does not appear in Design_Tokens, accompanied by a code comment justifying the exception (R19.2).

```typescript
// packages/shared/src/design-tokens.ts
// Single source of truth for visual tokens. DO NOT hard-code any of these
// values elsewhere. If you need a value not listed here, add it here first.

export const spacing = {
  0: '0',
  px: '1px',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;
export type Spacing = keyof typeof spacing;

export const radius = {
  none: '0',
  sm:   '4px',
  md:   '6px',
  lg:   '8px',
  xl:   '12px',
  full: '9999px',
} as const;
export type Radius = keyof typeof radius;

export const typography = {
  family: {
    sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
    mono: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  // One of these two must be chosen at app bootstrap; see "Typeface" below.
  // Inter is the default for the POC. If the team switches to Geist, change
  // `family.sans` to Geist here and nowhere else.
  size: {
    xs:   '12px',   // captions, helper text
    sm:   '13px',   // secondary body, table cells
    base: '14px',   // primary body — developer density
    md:   '15px',   // emphasized body
    lg:   '16px',   // section intro
    xl:   '18px',   // page title (small)
    '2xl':'20px',   // page title (default — max in POC)
  },
  weight: {
    regular:  400,
    medium:   500,
    semibold: 600,   // max weight used in POC — no 700/800/900
  },
  lineHeight: {
    tight:  1.25,
    normal: 1.5,
    loose:  1.7,
  },
  letterSpacing: {
    tight:  '-0.01em',
    normal: '0',
    wide:   '0.02em',
  },
} as const;

export const color = {
  // Neutral / slate base
  bg: {
    app:      'hsl(0 0% 100%)',          // light mode canvas
    appDark:  'hsl(220 13% 9%)',         // dark mode canvas
    surface:  'hsl(210 20% 98%)',        // light surface (card)
    surfaceDark: 'hsl(220 13% 12%)',     // dark surface (card)
    muted:    'hsl(210 20% 96%)',
    mutedDark:'hsl(220 13% 15%)',
  },
  border: {
    subtle:     'hsl(220 13% 91%)',
    subtleDark: 'hsl(220 13% 20%)',
    strong:     'hsl(220 13% 83%)',
    strongDark: 'hsl(220 13% 30%)',
    focus:      'hsl(217 91% 60%)',      // the single blue accent
  },
  text: {
    primary:       'hsl(220 13% 13%)',
    primaryDark:   'hsl(210 20% 98%)',
    secondary:     'hsl(220 9% 46%)',
    secondaryDark: 'hsl(215 14% 65%)',
    tertiary:      'hsl(220 9% 55%)',
    tertiaryDark:  'hsl(215 14% 55%)',
    inverse:       'hsl(0 0% 100%)',
  },
  accent: {
    // Single blue accent — used sparingly for focus, primary CTAs, and links
    base:     'hsl(217 91% 60%)',
    hover:    'hsl(217 91% 54%)',
    active:   'hsl(217 91% 48%)',
    subtle:   'hsl(217 91% 97%)',        // background tint for selected rows
    subtleDark:'hsl(217 91% 18%)',
  },
  status: {
    // Semantic — used only in Badge, Toast, and status pills. Minimal saturation.
    success:    'hsl(142 40% 42%)',
    successBg:  'hsl(142 40% 95%)',
    warning:    'hsl(38 75% 44%)',
    warningBg:  'hsl(38 75% 95%)',
    error:      'hsl(0 65% 48%)',
    errorBg:    'hsl(0 65% 96%)',
    info:       'hsl(217 91% 60%)',
    infoBg:     'hsl(217 91% 97%)',
  },
} as const;

export const elevation = {
  none: 'none',
  sm:   '0 1px 2px 0 hsl(220 13% 13% / 0.05)',
  md:   '0 2px 4px -1px hsl(220 13% 13% / 0.06), 0 1px 2px -1px hsl(220 13% 13% / 0.04)',
  lg:   '0 8px 16px -4px hsl(220 13% 13% / 0.08), 0 2px 4px -2px hsl(220 13% 13% / 0.04)',
  // Only three levels. No `xl` / `2xl`. Larger surfaces use layout, not shadows.
} as const;

export const motion = {
  duration: {
    instant: '80ms',    // hover, focus ring fade-in
    fast:    '140ms',   // button press, popover open
    base:    '200ms',   // modal open, page transition
    slow:    '320ms',   // rare — only toast entry
  },
  easing: {
    // All POC animations use these two easings. No spring, no bounce.
    standard: 'cubic-bezier(0.2, 0, 0, 1)',   // ease-out
    accel:    'cubic-bezier(0.4, 0, 1, 1)',   // ease-in for exit
  },
  // Pre-baked primitives — import these, don't hand-roll animations.
  primitives: {
    fadeIn:     'opacity 200ms cubic-bezier(0.2, 0, 0, 1)',
    fadeOut:    'opacity 140ms cubic-bezier(0.4, 0, 1, 1)',
    translateUp:'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
  },
} as const;

export const focusRing = {
  // Every interactive primitive uses exactly this focus treatment.
  outline: `2px solid ${color.border.focus}`,
  outlineOffset: '2px',
} as const;
```

**Tailwind binding.** `tailwind.config.ts` on `walrus-poc` is extended so Tailwind's `spacing`, `colors`, `borderRadius`, `boxShadow`, `fontFamily`, `fontSize`, and `transitionDuration` keys are generated **programmatically** from `design-tokens.ts`. This means `className="p-4"` resolves to `spacing[4]` (16px) by construction — if the token changes, every component follows. Arbitrary-value utility classes (`p-[17px]`, `text-[15.5px]`, `bg-[#abcdef]`) are forbidden by an ESLint rule (`no-restricted-syntax` matching the `[` pattern inside `className` string literals); violations fail CI.

### Typeface

The POC ships with **Inter** as the default `family.sans`. `apps/web/fonts.ts` hosts the single `next/font/google` import:

```typescript
// apps/web/fonts.ts
import { Inter } from 'next/font/google';
export const appFont = Inter({ subsets: ['latin'], variable: '--font-sans' });
```

`src/app/poc/layout.tsx` applies `appFont.variable` to `<html>`. No other font is loaded. Switching to Geist is a one-file change (`apps/web/fonts.ts` + `typography.family.sans` in `design-tokens.ts`) and nothing else — no component touches the family directly.

### UI_Primitives set

**Location:** `apps/web/components/ui/`. Each primitive is a single file exposing a `React.forwardRef` component plus its variant map via `class-variance-authority` (`cva`). No primitive depends on another primitive except through composition. No primitive imports from `apps/web/components/forms`, `components/layout`, `components/walrus`, or `components/submissions`.

```
apps/web/components/ui/
├── Button.tsx
├── Input.tsx
├── Textarea.tsx
├── Card.tsx
├── Modal.tsx         # Radix Dialog-based; single component, no Drawer variant
├── Dropdown.tsx      # Radix DropdownMenu
├── Badge.tsx
├── Tabs.tsx          # Radix Tabs
├── Toast.tsx         # sonner-based
├── EmptyState.tsx
├── LoadingState.tsx
├── FormField.tsx     # label + control + description + error, accepts any Input/Textarea
└── index.ts          # barrel export — the only public surface
```

**Variant contract — Button** (the template for every primitive):

```typescript
// apps/web/components/ui/Button.tsx
import { cva, type VariantProps } from 'class-variance-authority';

const buttonStyles = cva(
  // base — common to all variants, uses tokens via Tailwind classes
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-[background-color,color,box-shadow] duration-fast ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:   'bg-accent text-inverse hover:bg-accent-hover active:bg-accent-active',
        secondary: 'bg-surface text-primary border border-subtle hover:bg-muted',
        ghost:     'bg-transparent text-primary hover:bg-muted',
        danger:    'bg-error text-inverse hover:opacity-90',
        link:      'text-accent underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        sm: 'h-7  px-2.5 text-xs',
        md: 'h-8  px-3   text-sm',    // default — developer density
        lg: 'h-9  px-3.5 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}
```

Every primitive in the set follows the same pattern: a `cva` variant map + a typed props interface + `forwardRef`. Consumers never receive an escape hatch to inject arbitrary class names that would bypass variants. `className` is allowed only for layout spacing (margin, grid placement) — not for visual overrides.

### Component folder structure

```
apps/web/components/
├── ui/              # UI_Primitives — see above. NEVER imports from peer folders.
├── layout/          # AppShell, PocHeader, PocSidebar, PageHeader, ContentFrame
├── forms/           # Form_Builder_UI internals: FieldRow, FieldTypePicker,
│                    # FieldEditor, FormTitleInput, AddFieldButton, ValidationSummary
├── walrus/          # UploadStatusPill, BlobReferenceChip, AggregatorHint,
│                    # PublisherLatencyInline (read-only status surfaces)
└── submissions/     # SubmissionListRow, SubmissionDetailPanel,
                     # EncryptedSubmissionIndicator, SubmissionFillFields
```

**Import direction is strict:**

```
ui  ← layout
ui  ← forms         (forms imports ui; ui never imports forms)
ui  ← walrus
ui  ← submissions
ui  ← pages         (apps/web/pages/*)
```

No peer imports between `forms`, `walrus`, and `submissions`. Cross-feature composition happens at the page level. An ESLint `no-restricted-paths` rule enforces this; violations fail CI.

### UX_State — canonical state contract

Every asynchronous action in the POC (upload, encryption, submission, retrieval, Sui anchoring) MUST render an explicit visual representation for each of `idle`, `loading`, `success`, `error`, `empty`. Blank screens during pending operations are forbidden (R19.7).

The `LoadingState` and `EmptyState` primitives are the canonical renderers:

```typescript
// apps/web/components/ui/LoadingState.tsx
export interface LoadingStateProps {
  label: string;            // user-facing, encryption-agnostic
  mode?: 'inline' | 'block';
  progress?: number;        // 0..1, optional
}

// apps/web/components/ui/EmptyState.tsx
export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  icon?: React.ReactNode;   // from lucide-react, single stroke weight
}
```

For every page that drives an async action we define a small TypeScript discriminated union that the page consumes and the UI renders:

```typescript
// example — Form_Builder_UI save flow
type SaveState =
  | { kind: 'idle' }
  | { kind: 'loading'; stage: 'serializing' | 'securing' | 'uploading' | 'anchoring' }
  | { kind: 'success'; blobId: string; suiDigest: string | null }
  | { kind: 'error';   stage: 'securing' | 'uploading' | 'anchoring';
                       code: string; message: string }
  | { kind: 'empty' };      // no forms yet
```

The `stage` values map 1:1 to **user-visible copy** in `apps/web/copy/ux-copy.ts`:

```typescript
export const uxCopy = {
  save: {
    serializing: 'Preparing your form…',
    securing:    'Securing your form…',
    uploading:   'Uploading securely…',
    anchoring:   'Finalizing…',
  },
  fetch: {
    retrieving: 'Loading your form…',
    decrypting: 'Unlocking your form…',
  },
  submit: {
    validating: 'Checking your responses…',
    securing:   'Securing your response…',
    uploading:  'Submitting securely…',
  },
} as const;
```

**Forbidden copy strings** — the ESLint rule `no-restricted-syntax` rejects string literals matching any of: `/decentralized/i`, `/blob storage/i`, `/aggregator/i` (in user-visible components only; `apps/api` and `packages/walrus` are exempt because that copy is log/error-envelope text, not UI), `/publisher/i`, `/finalization/i`, `/seal encrypt/i`, `/AES-GCM/i`, `/walrus/i` (in UI copy only — `Walrus_Client` type imports are allowed). This is how R19.8 is mechanically enforced.

### Walrus UX surfaces

The three Walrus-adjacent UI components live in `apps/web/components/walrus/` and all follow the "background-oriented, asynchronous, lightweight" rule:

| Component                 | Rendered by                        | What the user sees                                                             |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `UploadStatusPill`        | FormBuilderPage, FormFillPage      | Small pill in the corner: `Securing…` → `Uploading…` → `Saved ✓` (200ms fade)  |
| `BlobReferenceChip`       | FormPreviewPage, SubmissionViewPage| Monospace short-hash (e.g. `blob:7f2…c4e`), click → copy to clipboard          |
| `AggregatorHint`          | Status dashboard only              | One-line subtle indicator of aggregator reachability (green/amber dot)         |

Raw endpoint URLs, HTTP status codes, retry counts, and aggregator/publisher labels **never** appear in primary flows. They appear only under `/poc` (status dashboard) behind an "Advanced" disclosure, because that page is the developer's diagnostic pane.

### Form_Builder_UI — field palette (R19.9 binding)

The V1 palette is exactly six types. Any implementation that adds a seventh fails the R19.9 check:

```typescript
// packages/shared/src/validator.ts — already referenced in "Validator / Zod schemas"
export const FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'number',
  'select',
  'checkbox',
] as const;
```

The Form_Builder_UI renders an `AddFieldButton` that opens a `Dropdown` (`apps/web/components/ui/Dropdown.tsx`) seeded from `FIELD_TYPES`. There is no drag-and-drop reorder library (no `@dnd-kit`, no `react-beautiful-dnd`); reordering is handled with up/down chevron `Button`s on each `FieldRow`. This is deliberate — the POC does not need drag-heavy interactions and every such library brings ~30KB+ and accessibility landmines.

There is no conditional-logic editor, no computed-field editor, no "workflow" concept, and no automation trigger surface. If a task proposes adding any of these, it belongs in `sealbase-platform`, not here.

### Dashboard information hierarchy (R19.10 binding)

The `StatusDashboardPage` (`/poc`) and the forms list (`/poc` lower half) render exactly the following columns/rows, in this order and no other:

```
┌──────────────────┬───────────────┬──────────────┬──────────────┬─────────────┬───────────────┐
│ Form Name        │ Submissions   │ Encryption   │ Upload       │ Blob Ref    │ Last Activity │
├──────────────────┼───────────────┼──────────────┼──────────────┼─────────────┼───────────────┤
│ Customer Intake  │ 12            │ ● Secured    │ ● Uploaded   │ blob:7f2…c4e│ 2m ago        │
│ Feedback Survey  │ 0             │ ● Secured    │ ● Uploaded   │ blob:1a0…9e2│ yesterday     │
│ Bug Report       │ —             │ ○ Draft      │ ○ Local only │ —           │ just now      │
└──────────────────┴───────────────┴──────────────┴──────────────┴─────────────┴───────────────┘
```

- **Encryption Status** and **Upload Status** use the `Badge` primitive with the `status.success` / `status.warning` semantic colors from Design_Tokens. They do not use icons from outside `lucide-react` and they do not animate.
- **No charts, no sparklines, no counters that tick**. `Submissions` is a plain numeric cell. Growth, trends, rates, and analytics are explicit non-goals.
- Empty state (zero forms) is rendered by the `EmptyState` primitive with a single primary `Button` labeled `Create form`.

### Animation rules (R19.11 binding)

- Every animation in the POC UI uses exactly one of `motion.primitives.fadeIn`, `motion.primitives.fadeOut`, `motion.primitives.translateUp`. Compound effects compose these by running two transitions in parallel on distinct properties — never on a single element via a bespoke keyframe.
- Translate distance is capped at **8 px**. Longer travel indicates the wrong interaction.
- Durations come from `motion.duration`. Using any literal `ms` value in component source is an ESLint violation (`no-restricted-syntax` on `/\b\d+ms\b/` inside `className` or `style`).
- `framer-motion` is permitted **only** for the Toast primitive's entry/exit (already driven by sonner) and for the Modal primitive's overlay fade. No `spring`, no `whileHover`, no `whileTap`, no `layout` prop.
- Reduced-motion compliance: the top-level `AppShell` wraps the tree in a context that, when `prefers-reduced-motion: reduce` is active, rewrites every `motion.primitives.*` class to `transition-none`. This is implemented once, in one file.

### Responsive design targets (R19.13 binding)

- **Primary target: 1280–1536 CSS pixels** (developer laptop). Layouts are designed width-first at 1440 px and tested at 1280 px and 1536 px for no wrapping regressions.
- **Minimum supported: 360 CSS pixels.** Below this, content is allowed to scroll horizontally in `packages/walrus/*` diagnostic tables only (read-only surfaces); no primary flow is allowed to require horizontal scroll on a 360 px viewport.
- **Maximum targeted: 1920 CSS pixels.** Above 1280 px the content column is capped at 1280 px and horizontally centered with `margin-inline: auto`. The POC does not use full-bleed layouts because they produce the "admin panel" aesthetic R19.0 explicitly rejects.
- Breakpoints come from Design_Tokens; no bespoke `@media` rules in component source.

### Accessibility requirements (R19.15 binding)

- Every interactive primitive uses `focus-visible` with `focusRing.outline` — verified by a Vitest snapshot of `Button`, `Input`, `Textarea`, `Dropdown`, `Modal`, `Tabs`, and `FormField`.
- Contrast: `text.primary` on `bg.app` is ≥7:1 (AAA body); `text.secondary` on `bg.app` is ≥4.5:1 (AA body); `accent.base` on `bg.app` is ≥4.5:1. Token values in Design_Tokens are chosen to pass — CI runs `@adobe/leonardo-contrast-colors` or `wcag-contrast` to fail the build if a token falls below the threshold.
- Every Modal uses Radix Dialog (traps focus, returns focus to trigger, escape to close) — no custom overlay.
- Every FormField wires `<label>` ↔ control via `htmlFor` / `id`, and wires `aria-describedby` to helper text and `aria-invalid="true"` + `aria-errormessage` when in error state.
- Keyboard paths for every core flow are documented in `docs/design-system.md` (Accessibility section) and exercised by a Playwright smoke test (post-POC — see tasks.md).

### Design_System_Doc (`docs/design-system.md`) — required sections

Six non-empty sections, each a top-level `##` heading, per R19.14:

```
## Visual Philosophy
## Spacing System
## Component Rules
## Interaction Philosophy
## Animation Constraints
## Accessibility Requirements
```

Each section mirrors the rules in this design chapter and links back to the Design_Tokens module as the executable source of truth. The doc is a **reference for humans**; the tokens file is the **source of truth for the build**. If the two disagree, the tokens file wins and the doc is corrected.

### How R19 is satisfied end-to-end

| R19 clause                                | Enforcement mechanism                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------|
| 19.1 Design_Tokens module exists          | `packages/shared/src/design-tokens.ts` — imported by Tailwind config and all primitives                                                 |
| 19.2 No ad-hoc numeric/color literals     | ESLint `no-restricted-syntax` against `class(Name)?="[^"]*\[` and `/#[0-9a-f]{3,8}/i` in `apps/web/**` and `src/app/poc/**`             |
| 19.3 Single typeface                      | `apps/web/fonts.ts` is the single font-loading site; CI grep fails if any other font is imported                                        |
| 19.4 Palette restriction                  | Tailwind config generates color classes only from `design-tokens.color.*`; arbitrary color literals blocked by 19.2 rule                |
| 19.5 UI_Primitives with variant API       | Inventory test in `apps/web/components/ui/primitives.inventory.test.ts` asserts every required primitive exists and exposes `cva`       |
| 19.6 No duplicated button logic           | ESLint `no-restricted-imports` blocks React Aria, Headless UI, and any `Button`-named export not from `@ui/Button`                      |
| 19.7 Five UX_States rendered              | Each page's `SaveState`/`FetchState` union is unit-tested for exhaustiveness (TypeScript `never` check + runtime snapshot per state)    |
| 19.8 Encryption-agnostic copy             | `apps/web/copy/ux-copy.ts` is the sole source; ESLint forbids the banned strings in UI files                                            |
| 19.9 Six field types only                 | `FIELD_TYPES` is frozen; validator fails unknown types; dropdown is seeded from the same const                                          |
| 19.10 Dashboard column order              | `StatusDashboardPage` uses `const DASHBOARD_COLUMNS = [...] as const` matching the required order; snapshot test pinned                 |
| 19.11 Animation constraints               | ESLint rule + `motion.primitives` are the only exported animations; no `spring`/`bounce` exports exist                                  |
| 19.12 Folder structure                    | `no-restricted-paths` ESLint rule forbids peer imports between `forms`/`walrus`/`submissions`                                           |
| 19.13 Responsive window                   | Playwright smoke test runs at 360 / 1280 / 1536 / 1920 px; no-horizontal-scroll assertion on primary flows at 360 px                    |
| 19.14 `docs/design-system.md` exists      | Covered by Requirement 15 doc-deliverable check; six-heading verification in completion script                                          |
| 19.15 WCAG 2.1 AA                         | Contrast test at build time; `focus-visible` snapshot test for every primitive                                                          |
| 19.16 Violation fails completion          | The Phase 4/5 completion scripts call `npm run lint:ui` which is a composite of the rules above; non-zero exit fails phase completion   |

### Cross-references

- Requirement 19 (all clauses) — governs this entire section.
- Requirement 10 (Form_Builder_UI) and Requirement 12 (Form_Submission_UI) — surfaces where these rules are user-visible.
- Requirement 11 (Local Persistence) — the "local-first feeling" principle is grounded in the Zustand persist store already specified in Data Models.
- Requirement 14 (Repository Structure) — `apps/web/components/{ui,layout,forms,walrus,submissions}/*` is a strict subset of the R14.1 `apps/web` directory.
- Requirement 15 (Documentation Deliverables) — `docs/design-system.md` is covered by R15.6 as amended.
