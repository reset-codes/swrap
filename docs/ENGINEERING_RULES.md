# SEALBASE — Engineering Rules

## The Prime Directive

**MVP-first. Startup product. Ship fast, ship well.**

Do not overengineer. Do not add abstractions before they are needed. Do not build for scale you do not have. Build for the product you are shipping today, with the architecture that can grow tomorrow.

---

## Rule 1: Walrus is the Source of Truth

- All meaningful data MUST be stored on Walrus before the operation is considered complete.
- PostgreSQL stores only references, metadata, and index data.
- If a Walrus write fails, the operation fails. Do not fall back to PostgreSQL-only storage.
- Every submission MUST have a `walrus_blob_id` before it is considered persisted.

```
CORRECT:  store on Walrus → index in PostgreSQL → return success
WRONG:    store in PostgreSQL → "also try Walrus" → return success
```

---

## Rule 2: PostgreSQL is Disposable

- The database schema must be reconstructable from Walrus data.
- Never store data in PostgreSQL that does not exist on Walrus.
- Never treat a PostgreSQL row as the authoritative record for a submission.
- Migrations must be backward-compatible. Never drop columns without a deprecation period.

---

## Rule 3: Submissions are Immutable

- Once a submission is stored on Walrus, it cannot be modified.
- Status changes, admin notes, and resolution states are separate records that reference the original submission.
- Never UPDATE a submission row. Only INSERT new status/annotation records.
- The original submission blob ID is permanent and must never be overwritten.

---

## Rule 4: Submitters are Anonymous

- Public form submission endpoints must not require authentication.
- Do not collect PII from submitters unless the form explicitly asks for it.
- Do not store IP addresses or device fingerprints without explicit product decision.
- Submitters must never be required to connect a wallet, sign a transaction, or hold any crypto.

---

## Rule 5: Storage Credits Must Be Checked Before Writes

```
CORRECT:
  1. Check credit balance
  2. Estimate write cost
  3. If balance >= cost: proceed with write
  4. Deduct credits after successful write

WRONG:
  1. Write to Walrus
  2. Try to deduct credits
  3. Handle failure after the fact
```

Never allow a Walrus write to proceed without confirming sufficient credits. Insufficient credits must return a clear error to the admin, not a silent failure.

---

## Rule 6: Encryption Happens Before Storage

- Encrypted fields must be encrypted via Seal BEFORE the payload is sent to Walrus.
- Never store plaintext versions of encrypted fields anywhere — not in PostgreSQL, not in logs, not in error messages.
- Decryption happens in-memory, per request, in the API layer. Decrypted values are never persisted.

---

## Rule 7: No Overengineering

Things we are NOT building:
- Event sourcing systems
- CQRS patterns
- Microservices architecture
- Message queues (unless Walrus SDK requires async)
- GraphQL (REST API routes are sufficient)
- Redis caching (PostgreSQL is fast enough for MVP)
- Complex job queues (simple async functions are fine)

If you find yourself building infrastructure for the infrastructure, stop and ship the feature instead.

---

## Rule 8: TypeScript Everywhere

- All code must be TypeScript. No `any` types without explicit justification and a comment.
- Prisma-generated types are the source of truth for database models.
- Zod schemas are used for all API input validation.
- Shared types live in `/src/types/`. Do not duplicate type definitions.

---

## Rule 9: API Design

- All API routes follow REST conventions.
- All API responses follow a consistent shape:
  ```typescript
  // Success
  { success: true, data: T }
  
  // Error
  { success: false, error: { code: string, message: string } }
  ```
- All API inputs are validated with Zod before processing.
- Authentication is checked at the route level, not inside service functions.
- Never expose internal error messages to clients. Log internally, return safe messages.

---

## Rule 10: Error Handling

- Every Walrus operation must have error handling with retry logic (max 3 retries, exponential backoff).
- Every Seal operation must have error handling.
- Storage credit failures must return HTTP 402 (Payment Required) with a clear message.
- Network errors must be caught and surfaced as user-friendly messages in the UI.
- Never let an unhandled promise rejection crash the server.

---

## Rule 11: File Structure

```
/src
  /app              # Next.js App Router pages and layouts
    /f/[slug]       # Public form pages
    /dashboard      # Admin dashboard pages
    /api            # API routes
  /components       # Shared UI components
    /ui             # shadcn/ui base components
    /forms          # Form builder components
    /dashboard      # Dashboard-specific components
  /lib              # Utility functions and clients
    /walrus         # Walrus SDK client wrapper
    /seal           # Seal SDK client wrapper
    /prisma         # Prisma client singleton
    /auth           # NextAuth configuration
  /services         # Business logic layer
  /types            # Shared TypeScript types
  /hooks            # React hooks
/prisma
  schema.prisma     # Database schema
  migrations/       # Migration files
/docs               # Product documentation
```

---

## Rule 12: Testing

- Unit tests for all service layer functions.
- Integration tests for all API routes.
- E2E tests for critical paths: form creation, form submission, admin login.
- Test files live next to the code they test (`*.test.ts`).
- Do not ship untested service layer code.

---

## Rule 13: Environment Variables

All secrets and configuration live in environment variables. Never hardcode:
- Database URLs
- Walrus API keys or endpoints
- Seal keys or policy IDs
- Infrastructure wallet private keys
- NextAuth secrets
- Google OAuth credentials

Use `.env.local` for development. Document all required variables in `.env.example`.

---

## Rule 14: Performance

- Public form pages must load in under 2 seconds on a 4G connection.
- Dashboard pages must load in under 3 seconds.
- Walrus reads for submission viewing are acceptable to be slightly slower (decentralized network latency).
- Use Next.js ISR for public form pages where possible.
- Paginate all list views. Never load unbounded lists.

---

## Rule 15: Security

- All admin routes require authentication. Middleware must enforce this.
- Role-based access control is enforced at the API layer, not just the UI.
- Seal decryption is only available to `admin` and `owner` roles.
- CSV export is only available to `admin` and `owner` roles.
- Form deletion is only available to `owner` role.
- Never log sensitive field values, even in development.
- Infrastructure wallet private keys must never be logged or exposed in API responses.
