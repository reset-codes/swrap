# Implementation Tasks

## Stage 1: Foundation

- [x] 1. Initialize Next.js 15 project with TypeScript, TailwindCSS, and shadcn/ui
  - Scaffold Next.js 15 app with App Router and TypeScript strict mode
  - Install and configure TailwindCSS with the SEALBASE design token palette (colors, typography, spacing from UI_GUIDELINES.md)
  - Install and initialize shadcn/ui component library
  - Install Framer Motion
  - Configure path aliases (`@/` → `src/`)
  - Create `.env.example` documenting all required environment variables
  - Set up ESLint and Prettier with project conventions
  - **Requirements**: R16, R18, R19

- [x] 2. Configure Google OAuth authentication with NextAuth
  - Install and configure NextAuth v5 with Google OAuth provider
  - Create `/src/lib/auth/` with NextAuth config, session types, and role definitions
  - Implement auth middleware to protect all `/dashboard` routes
  - Create login page at `/app/(auth)/login/page.tsx` with Google sign-in button
  - Implement role assignment logic: first user in workspace gets `owner`, subsequent get `admin`
  - Add session-expiry redirect to login page
  - **Requirements**: R1, R2

- [x] 3. Set up Prisma ORM with PostgreSQL schema
  - Install Prisma and configure `DATABASE_URL` environment variable
  - Create `prisma/schema.prisma` with index-only tables:
    - `User` (id, email, name, image, role, createdAt)
    - `Form` (id, slug, title, ownerId, schemaBlobId, mode, isPublished, createdAt)
    - `Submission` (id, formId, walrusBlobId, status, submittedAt)
    - `SubmissionStatusLog` (id, submissionId, adminId, status, createdAt)
    - `BlobReference` (id, walrusBlobId, blobType, ownerId, formId, createdAt)
    - `StorageCredit` (id, userId, balance, updatedAt)
    - `CreditTransaction` (id, userId, amount, type, walrusBlobId, createdAt)
  - Run initial migration and seed script
  - Create `/src/lib/prisma/client.ts` singleton
  - **Requirements**: R19

- [x] 4. Implement Walrus SDK client wrapper
  - Install Walrus SDK (or implement HTTP client against Walrus aggregator/publisher endpoints)
  - Create `/src/lib/walrus/client.ts` with typed methods:
    - `writeBlob(data: Buffer | string): Promise<{ blobId: string }>`
    - `readBlob(blobId: string): Promise<Buffer>`
  - Implement retry logic: max 3 retries with exponential backoff on failure
  - Add error handling that surfaces user-friendly messages without exposing internals
  - Create `/src/lib/walrus/types.ts` for shared Walrus types
  - **Requirements**: R8

- [x] 5. Implement Seal encryption client wrapper
  - Install Seal SDK
  - Create `/src/lib/seal/client.ts` with typed methods:
    - `encrypt(value: string, policyId: string): Promise<{ encryptedBlob: string }>`
    - `decrypt(encryptedBlob: string, adminKey: string): Promise<string>`
    - `createPolicy(formId: string, authorizedRoles: string[]): Promise<{ policyId: string }>`
  - Ensure plaintext values are never logged or persisted
  - Add error handling for Seal operation failures
  - **Requirements**: R9

- [x] 6. Implement Infrastructure Wallet manager
  - Create `/src/lib/wallet/manager.ts` for managing SEALBASE infrastructure keypairs
  - Load wallet private keys from environment variables (never log or expose)
  - Implement `executeWalrusWrite(data: Buffer): Promise<{ blobId: string }>` that uses the infra wallet
  - Implement `executeSealOperation(op: SealOperation): Promise<SealResult>`
  - Ensure private keys are never included in API responses or error messages
  - **Requirements**: R15

- [x] 7. Build dashboard shell layout
  - Create `/src/app/dashboard/layout.tsx` with sidebar (240px fixed) and main content area
  - Build `Sidebar` component with: SEALBASE logo, navigation links (Forms, Submissions, Storage, Settings), storage credit balance display, user avatar and sign-out
  - Build `DashboardHeader` component with page title and action slot
  - Implement collapsible sidebar behavior at `md` (768px) breakpoint
  - Apply SEALBASE design tokens: colors, typography, spacing from UI_GUIDELINES.md
  - **Requirements**: R11, R18

---

## Stage 2: Form Builder

- [x] 8. Define shared TypeScript types for forms and fields
  - Create `/src/types/form.ts` with:
    - `FieldType` union type for all 11 field types
    - `FieldConfig` interface (label, type, required, placeholder, helpText, validation, encrypted)
    - `FormSchema` interface (id, title, description, slug, mode, fields, createdAt, version)
    - `FormMode` type (`conversational` | `table`)
  - Create `/src/types/submission.ts` with `SubmissionPayload`, `FieldValue`, `BlobRef` types
  - Create `/src/types/api.ts` with `ApiSuccess<T>` and `ApiError` response types
  - **Requirements**: R3, R5

- [x] 9. Implement FormService business logic
  - Create `/src/services/FormService.ts` with:
    - `createForm(adminId, schema): Promise<Form>` — validates, stores on Walrus, indexes in PG
    - `updateForm(formId, adminId, schema): Promise<Form>` — stores new schema blob, updates PG ref
    - `publishForm(formId, adminId): Promise<{ publicUrl: string }>` — marks published, enforces slug uniqueness
    - `getFormBySlug(slug): Promise<FormSchema>` — fetches schema blob from Walrus
    - `getFormsByOwner(adminId): Promise<Form[]>` — queries PG index
    - `deleteForm(formId, ownerId): Promise<void>` — owner-only, removes PG metadata
  - Enforce: Walrus write before PG index, slug immutability after publish, credit check before write
  - **Requirements**: R3, R4, R5, R8, R10

- [x] 10. Build Form Builder UI — field list and drag-and-drop
  - Create `/src/components/forms/FormBuilder.tsx` as the main builder container
  - Implement drag-and-drop field reordering using `@dnd-kit/core`
  - Build `FieldList` component showing all fields with drag handles, type icons, and edit/delete actions
  - Build `AddFieldButton` with a dropdown of all 11 field types
  - Implement field add, edit, remove, and reorder operations updating local form state
  - **Requirements**: R3

- [x] 11. Build field configuration panel
  - Create `/src/components/forms/FieldConfigPanel.tsx` as a slide-in panel
  - Implement configuration controls for all field types:
    - Required toggle (all types)
    - Placeholder text (text, URL fields)
    - Help text (all types)
    - Validation rules (min/max length for text, file size for uploads)
    - Encryption toggle (all types)
  - Show encryption toggle with Seal brand color indicator when enabled
  - Validate that label is non-empty before allowing save
  - **Requirements**: R3, R9

- [x] 12. Build form settings panel and slug generation
  - Create `/src/components/forms/FormSettings.tsx` with:
    - Form title input
    - Form description textarea
    - Slug input (auto-generated from title, editable before publish, locked after)
    - Mode selector: Conversational vs Table (with visual preview thumbnails)
    - Encryption mode selector: None, Field-level, Full submission
  - Implement slug auto-generation from title (lowercase, hyphenated, URL-safe)
  - Show slug preview as `sealbase.app/f/[slug]`
  - **Requirements**: R4

- [x] 13. Implement form schema serialization and Zod validation
  - Create `/src/lib/forms/serializer.ts` with:
    - `serializeFormSchema(schema: FormSchema): string` — JSON serialization
    - `parseFormSchema(json: string): FormSchema` — parsing with Zod validation
  - Create Zod schema for `FormSchema` validating all field types and required properties
  - Ensure round-trip: `parseFormSchema(serializeFormSchema(schema))` produces equivalent object
  - Return descriptive errors for unrecognized field types or malformed JSON
  - **Requirements**: R5

- [x] 14. Build form API routes
  - Create `/src/app/api/forms/route.ts` — GET (list), POST (create)
  - Create `/src/app/api/forms/[formId]/route.ts` — GET, PUT (update), DELETE (owner only)
  - Create `/src/app/api/forms/[formId]/publish/route.ts` — POST (publish)
  - Validate all inputs with Zod; return `{ success, data }` / `{ success, error }` shapes
  - Enforce authentication and role checks at route level
  - **Requirements**: R4, R11, R16

---

## Stage 3: Storage Pipeline

- [x] 15. Implement StorageService with credit gating
  - Create `/src/services/StorageService.ts` with:
    - `estimateCost(dataSize: number): number` — returns estimated WAL cost
    - `writeWithCreditCheck(adminId, data, blobType): Promise<{ blobId: string }>` — checks credits, writes to Walrus via infra wallet, deducts credits
    - `readBlob(blobId: string): Promise<Buffer>` — fetches from Walrus
  - Enforce: credit check → Walrus write → credit deduction (never write without sufficient credits)
  - Return HTTP 402 error shape when credits are insufficient
  - **Requirements**: R8, R10

- [x] 16. Implement CreditService
  - Create `/src/services/CreditService.ts` with:
    - `getBalance(adminId): Promise<number>`
    - `checkSufficient(adminId, estimatedCost): Promise<boolean>`
    - `deposit(adminId, amount, currency): Promise<CreditTransaction>`
    - `deduct(adminId, amount, walrusBlobId): Promise<CreditTransaction>`
    - `getTransactionHistory(adminId): Promise<CreditTransaction[]>`
    - `getPerFormUsage(adminId): Promise<FormUsageSummary[]>`
  - **Requirements**: R10, R13

- [x] 17. Implement EncryptionService
  - Create `/src/services/EncryptionService.ts` with:
    - `encryptField(value: string, policyId: string): Promise<string>` — returns encrypted blob string
    - `encryptPayload(payload: object, policyId: string): Promise<string>` — full submission encryption
    - `decryptField(encryptedBlob: string, adminKey: string): Promise<string>` — in-memory only
    - `decryptPayload(encryptedBlob: string, adminKey: string): Promise<object>` — in-memory only
    - `createFormPolicy(formId: string): Promise<string>` — returns policyId
  - Ensure no plaintext is logged or persisted at any point
  - Abort and throw on Seal operation failure
  - **Requirements**: R9

- [x] 18. Build file upload API route
  - Create `/src/app/api/upload/route.ts` — POST multipart/form-data
  - Accept image, video, and generic file uploads
  - Validate file size against configured maximum
  - Upload file buffer to Walrus via StorageService (with credit check)
  - Store BlobReference in PostgreSQL
  - Return `{ success: true, data: { blobId, blobType, size } }`
  - **Requirements**: R6, R8, R10

---

## Stage 4: Submission System

- [x] 19. Build public form renderer — Table Mode
  - Create `/src/app/f/[slug]/page.tsx` as the public form entry point (no auth required)
  - Fetch Form_Schema from Walrus via `getFormBySlug`
  - Build `TableModeForm` component rendering all fields simultaneously in a scrollable layout
  - Implement all 11 field type renderers: text inputs, dropdowns, multi-select, checkbox, star rating, URL, file upload inputs
  - Apply public form layout: minimal header, centered max-w-2xl content, "Powered by SEALBASE" footer
  - Use Next.js ISR for public form pages
  - **Requirements**: R6, R14

- [x] 20. Build public form renderer — Conversational Mode
  - Build `ConversationalModeForm` component showing one field at a time
  - Implement question enter/exit animations using Framer Motion (`questionTransition` variants from UI_GUIDELINES.md)
  - Implement progress indicator showing current question number / total
  - Implement keyboard navigation: Enter to advance, Backspace to go back
  - Implement answer confirmation with subtle scale pulse animation
  - **Requirements**: R6, R14

- [x] 21. Implement client-side form validation
  - Create `/src/lib/forms/validator.ts` with field-level validation functions for all field types
  - Validate required fields, URL format, file size limits, text length constraints
  - Display field-level error messages adjacent to invalid fields
  - Prevent form submission when validation errors exist
  - Show upload progress indicator during file uploads
  - **Requirements**: R14

- [x] 22. Implement SubmissionService
  - Create `/src/services/SubmissionService.ts` with:
    - `assemblePayload(formId, fieldValues, uploadedBlobRefs): SubmissionPayload`
    - `storeSubmission(adminId, formId, payload): Promise<{ submissionBlobId: string }>` — encrypts if needed, writes to Walrus, indexes in PG
    - `getSubmission(submissionBlobId): Promise<SubmissionPayload>` — fetches from Walrus
    - `listSubmissions(formId, filters, pagination): Promise<PaginatedSubmissions>`
  - Enforce: encrypt before store, Walrus write before PG index, never update existing submission
  - **Requirements**: R6, R7, R9

- [x] 23. Build submission API routes
  - Create `/src/app/api/forms/[formId]/submissions/route.ts` — POST (public, no auth), GET (admin only, paginated)
  - Create `/src/app/api/submissions/[submissionId]/route.ts` — GET (admin only)
  - Create `/src/app/api/submissions/[submissionId]/status/route.ts` — POST (admin only, append-only status update)
  - Create `/src/app/api/submissions/[submissionId]/decrypt/route.ts` — POST (admin/owner only)
  - Validate all inputs with Zod; enforce auth and role checks
  - **Requirements**: R6, R7, R9, R16

---

## Stage 5: Admin Dashboard

- [x] 24. Build forms list page
  - Create `/src/app/dashboard/forms/page.tsx`
  - Display paginated list of all forms with: title, slug, mode badge, published status, submission count, creation date
  - Implement "New Form" button opening the Form Builder
  - Implement per-form actions: Edit, View Submissions, Delete (owner only with confirmation dialog)
  - Display empty state when no forms exist
  - **Requirements**: R11

- [x] 25. Build submission list view with filters and search
  - Create `/src/app/dashboard/forms/[formId]/submissions/page.tsx`
  - Display paginated submissions table with: Submission_Blob_ID (monospace), timestamp, Status_Tag badge, field preview
  - Implement Status_Tag filter (multi-select: open, under_review, planned, resolved, rejected)
  - Implement keyword search against indexed metadata
  - Implement sort by timestamp (newest/oldest)
  - Display empty state when no submissions exist
  - **Requirements**: R12

- [x] 26. Build submission detail view
  - Create `/src/app/dashboard/forms/[formId]/submissions/[submissionId]/page.tsx`
  - Fetch submission payload from Walrus and display all field values
  - Display Walrus blob ID in monospace with copy-to-clipboard button
  - Display encryption indicator (Seal brand color lock icon) for encrypted fields
  - Implement "Decrypt" button for encrypted fields — calls decrypt API, displays in-memory result
  - Display inline media previews for image and video uploads
  - Display Status_Tag with update dropdown (append-only)
  - **Requirements**: R12

- [x] 27. Build status tag update flow
  - Implement status update UI in submission detail view: dropdown with all 5 status options
  - Call `POST /api/submissions/[id]/status` on selection
  - Display status history log (all previous status changes with admin and timestamp)
  - Update displayed status badge immediately on success
  - **Requirements**: R7, R12

- [x] 28. Implement CSV export
  - Create `/src/app/api/forms/[formId]/export/route.ts` — GET (admin/owner only)
  - Generate CSV with columns: submission_id, submitted_at, status, and one column per form field
  - For encrypted fields: include decrypted values if caller has admin/owner role, otherwise `[encrypted]`
  - Stream response as `text/csv` with appropriate Content-Disposition header
  - **Requirements**: R2, R12

- [x] 29. Build storage analytics page
  - Create `/src/app/dashboard/storage/page.tsx`
  - Display current Storage_Credits balance prominently
  - Display per-form storage usage breakdown (submissions, uploads, schemas)
  - Display historical credit transaction log with timestamps and amounts
  - Display low-credits warning banner when balance is below threshold
  - Implement credit deposit flow (WAL/SUI amount input + deposit button)
  - **Requirements**: R10, R13

---

## Stage 6: Polish

- [x] 30. Build landing page
  - Create `/src/app/(marketing)/page.tsx` as the public landing page
  - Implement sections: hero (headline + CTA), features (3-4 key differentiators), how it works (3-step flow), footer
  - Apply Display typography (36px/700) for hero headline
  - Implement fade-up entrance animations with Framer Motion
  - Add "Get Started" CTA linking to Google login
  - Ensure responsive layout from 640px upward
  - **Requirements**: R18

- [x] 31. Implement loading and empty states
  - Build skeleton loading components for: forms list, submissions list, submission detail
  - Build empty state components for: no forms, no submissions, no credits, no search results
  - Apply skeleton shimmer animation using TailwindCSS `animate-pulse`
  - Ensure all async data fetches show skeleton before data loads
  - **Requirements**: R18

- [x] 32. Implement toast notification system
  - Install and configure a toast library (e.g., `sonner`) compatible with shadcn/ui
  - Implement toast notifications for: form saved, form published, submission received, status updated, export downloaded, credit deposited, error states
  - Apply slide-in-from-right animation (200ms ease-out per UI_GUIDELINES.md)
  - **Requirements**: R18

- [x] 33. Implement error states and network error handling
  - Build error boundary components for dashboard and public form pages
  - Implement user-friendly error messages for: Walrus write failure, Seal encryption failure, insufficient credits (HTTP 402), network timeout
  - Ensure no internal error details are exposed to users
  - **Requirements**: R8, R9, R10, R16

- [x] 34. Accessibility audit and keyboard navigation
  - Audit all interactive elements for accessible labels (`aria-label`, `aria-describedby`)
  - Verify focus rings are visible (`ring-2 ring-accent/50`) on all focusable elements
  - Verify all form fields have associated labels
  - Verify error messages are linked to fields via `aria-describedby`
  - Verify keyboard navigation works for: form builder, submission table, status dropdown, modal dialogs
  - Verify color contrast meets WCAG 2.1 AA (4.5:1 body, 3:1 large text)
  - **Requirements**: R18

- [x] 35. Responsive design pass
  - Verify public forms are fully functional at 640px viewport width
  - Implement collapsible sidebar at 768px breakpoint in dashboard
  - Verify landing page is responsive from 640px upward
  - Test Conversational Mode on mobile viewport
  - **Requirements**: R14, R18

---

## Stage 7: Bonus

- [x] 36. Implement form import — Typeform
  - Create `/src/app/api/import/typeform/route.ts` — POST with Typeform JSON export
  - Map Typeform field types to SEALBASE field types (best-effort)
  - Skip unsupported field types and return list of skipped fields to Admin
  - Create a draft Form in the Form Builder pre-populated with imported fields
  - **Requirements**: R17

- [x] 37. Implement form import — Google Forms
  - Create `/src/app/api/import/google-forms/route.ts` — POST with Google Forms JSON export
  - Map Google Forms question types to SEALBASE field types
  - Skip unsupported types and notify Admin
  - Create draft Form in Form Builder
  - **Requirements**: R17

- [ ] 38. Implement form import — Airtable
  - Create `/src/app/api/import/airtable/route.ts` — POST with Airtable base schema export
  - Map Airtable field types to SEALBASE field types
  - Skip unsupported types and notify Admin
  - Create draft Form in Form Builder
  - **Requirements**: R17
