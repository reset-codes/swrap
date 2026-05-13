# SEALBASE — Product Roadmap

## Stage Overview

| Stage | Name | Focus | Status |
|-------|------|-------|--------|
| 1 | Foundation | Project setup, auth, DB schema, design system, Walrus/Seal scaffolding | Planned |
| 2 | Form Builder | Field system, drag/drop, conversational mode, table mode, publishing | Planned |
| 3 | Storage Pipeline | Uploads, Walrus storage, Seal encryption, storage credits | Planned |
| 4 | Submission System | Public forms, submission handling, metadata indexing | Planned |
| 5 | Admin Dashboard | Filters, statuses, viewer, media previews, CSV export, analytics | Planned |
| 6 | Polish | Landing page, animations, onboarding, empty states, responsive | Planned |
| 7 | Bonus | Import tools, enhanced analytics, demo prep | Future |

---

## Stage 1: Foundation

**Goal**: A working skeleton with auth, database, design system, and infrastructure integrations scaffolded.

### Deliverables
- [ ] Next.js 15 project with TypeScript, TailwindCSS, shadcn/ui
- [ ] Google OAuth via NextAuth
- [ ] Prisma schema (index-only tables: forms, submissions, users, credits, blobs)
- [ ] Design system tokens (colors, typography, spacing, shadows)
- [ ] Dashboard shell (sidebar, header, navigation)
- [ ] Walrus SDK integration (client wrapper, blob read/write)
- [ ] Seal SDK scaffolding (encryption/decryption client)
- [ ] Infrastructure wallet setup (keypair management)
- [ ] Storage credit balance model
- [ ] `/docs` directory with all core documentation

### Exit Criteria
- Admin can log in with Google
- Dashboard shell renders with navigation
- Walrus client can write and read a test blob
- Seal client can encrypt and decrypt a test payload
- Database schema is migrated and seeded

---

## Stage 2: Form Builder

**Goal**: Admins can create, configure, and publish forms with all supported field types.

### Deliverables
- [ ] Field type system (short text, long text, rich text, dropdown, multi-select, checkbox, star rating, URL, image upload, video upload, file upload)
- [ ] Field configuration panel (required, placeholder, help text, validation, encryption toggle)
- [ ] Drag-and-drop form builder (Table Mode)
- [ ] Conversational Mode builder (Typeform-style preview)
- [ ] Form settings (title, description, slug, mode selection)
- [ ] Form schema serialization to JSON
- [ ] Form schema storage on Walrus
- [ ] Form metadata indexing in PostgreSQL
- [ ] Public URL generation (`sealbase.app/f/[slug]`)
- [ ] Form versioning (new schema blob on each save)

### Exit Criteria
- Admin can create a form with multiple field types
- Form schema is stored on Walrus and indexed locally
- Public URL is generated and accessible
- Both Table Mode and Conversational Mode are selectable

---

## Stage 3: Storage Pipeline

**Goal**: File uploads and submission payloads flow through Walrus correctly. Seal encryption works end-to-end.

### Deliverables
- [ ] File upload API (image, video, generic file → Walrus)
- [ ] Blob reference tracking (blob_id stored in PostgreSQL)
- [ ] Seal encryption integration (field-level and full-submission)
- [ ] Seal policy creation per form
- [ ] Storage credit check before writes
- [ ] Storage credit deduction after writes
- [ ] Infrastructure wallet transaction execution
- [ ] Storage cost estimation
- [ ] Admin credit deposit flow (WAL/SUI)
- [ ] Credit balance display in dashboard

### Exit Criteria
- File upload stores blob on Walrus and returns blob_id
- Encrypted fields are encrypted via Seal before Walrus storage
- Storage credits are deducted correctly per write
- Admin can view remaining credits

---

## Stage 4: Submission System

**Goal**: Public forms accept submissions. Submissions are stored on Walrus and indexed locally.

### Deliverables
- [ ] Public form renderer (`/f/[slug]`)
- [ ] Conversational Mode submission UI (animated, one question at a time)
- [ ] Table Mode submission UI (compact, all fields visible)
- [ ] Client-side form validation
- [ ] Submission assembly (payload JSON with blob refs)
- [ ] Submission storage on Walrus (canonical submission blob)
- [ ] Submission metadata indexing in PostgreSQL
- [ ] Append-only submission model (no updates, only status layers)
- [ ] Anonymous submitter model (no account required)
- [ ] Success state after submission

### Exit Criteria
- Anyone with a public URL can submit a form
- Submission is stored on Walrus with a canonical blob ID
- Submission metadata is indexed in PostgreSQL
- No wallet or account required for submitters

---

## Stage 5: Admin Dashboard

**Goal**: Admins can view, filter, search, and manage all submissions.

### Deliverables
- [ ] Submissions list view (table with filters, search, sort)
- [ ] Status tag system (open, under review, planned, resolved, rejected)
- [ ] Status update flow (append-only status layer)
- [ ] Submission detail view (full payload, field values, media previews)
- [ ] Walrus blob reference display (blob IDs, links)
- [ ] Encryption indicator (shows which fields are encrypted)
- [ ] Decrypt-on-demand (admin decrypts via Seal in-memory)
- [ ] Media preview (images, videos inline)
- [ ] CSV export (metadata + decrypted values if authorized)
- [ ] Storage analytics (per-form usage, total spend, credit history)
- [ ] Forms list with submission counts

### Exit Criteria
- Admin can view all submissions for their forms
- Status tags can be applied and updated
- Encrypted fields show decrypt button; decryption works
- CSV export downloads correctly
- Storage analytics show accurate data

---

## Stage 6: Polish

**Goal**: The product feels like a real startup product. Every screen is intentional.

### Deliverables
- [ ] Landing page (hero, features, how it works, CTA)
- [ ] Onboarding flow (first form creation wizard)
- [ ] Loading states (skeleton screens, spinners)
- [ ] Empty states (no forms, no submissions, no credits)
- [ ] Error states (failed uploads, insufficient credits, network errors)
- [ ] Responsive design (mobile-friendly public forms, tablet dashboard)
- [ ] Framer Motion animations (page transitions, form field animations)
- [ ] Conversational Mode polish (smooth transitions, progress indicator)
- [ ] Toast notifications (success, error, info)
- [ ] Keyboard navigation and accessibility audit

### Exit Criteria
- Landing page is live and converts visitors to sign-ups
- All screens have proper loading, empty, and error states
- Public forms work well on mobile
- Animations feel smooth and intentional

---

## Stage 7: Bonus (Future)

**Goal**: Ecosystem integrations and enhanced capabilities.

### Deliverables
- [ ] Import from Typeform (JSON schema mapping)
- [ ] Import from Google Forms (JSON schema mapping)
- [ ] Import from Airtable (base schema mapping)
- [ ] Enhanced analytics (response rates, completion rates, field-level stats)
- [ ] Demo mode (pre-populated demo workspace)
- [ ] Embeddable widget (iframe or JS embed for external sites)
- [ ] Webhook support (notify external services on submission)

---

## What We Are NOT Building

These are explicitly out of scope and should not be added without a product decision:

- Realtime collaboration on forms
- Token systems or tokenomics
- DAO governance
- Complex smart contracts
- Notification systems (email, push)
- Automation engines or workflows
- AI-powered form generation (future consideration only)
- Multi-language i18n (future consideration only)
