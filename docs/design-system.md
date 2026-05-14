# Design System

> **Scope:** `walrus-poc` branch. This document defines the visual philosophy, spacing system, component rules, interaction philosophy, animation constraints, and accessibility requirements for the POC UI.
>
> The executable source of truth for all token values is `packages/shared/src/design-tokens.ts`. This document describes the intent and rules; the tokens file is the implementation.

---

## Visual Philosophy

The POC UI is designed to feel like **serious infrastructure software** — minimal, technical, calm, and trustworthy. The aesthetic references are Linear, Vercel, Notion, Raycast, Stripe Docs, and Supabase.

**What this means in practice:**

- Neutral slate base with a single blue accent. No rainbow gradients, no neon purples, no crypto-dashboard color palettes.
- Developer-density typography: 14px base body size, Inter typeface, max weight semibold (600). No display fonts, no marketing-sized headings.
- Generous whitespace. Layouts breathe. Padding is consistent and sourced from the spacing scale.
- Every async action has an explicit visual state. No blank screens during pending operations.
- Encryption-agnostic language in user-visible copy. "Securing your form…" not "AES-256-GCM encrypting blob…".

**What this explicitly avoids:**

- Glassmorphism, heavy blur, or transparency effects
- Bouncing, overshoot, parallax, confetti, or crypto-flashy transitions
- Drag-heavy builders, workflow engines, or conditional logic UI
- Charts, sparklines, or analytics widgets on the dashboard
- More than one accent color on any screen
- Hex color literals or arbitrary Tailwind values in component source

---

## Spacing System

All spacing values come from `packages/shared/src/design-tokens.ts` → `spacing`. The scale is based on a 4px base unit.

| Token | Value | Typical use |
|---|---|---|
| `spacing[0.5]` | 2px | Micro gaps, icon padding |
| `spacing[1]` | 4px | Tight inline spacing |
| `spacing[1.5]` | 6px | Compact padding |
| `spacing[2]` | 8px | Tight spacing, inline elements |
| `spacing[3]` | 12px | Compact padding |
| `spacing[4]` | 16px | Default padding, card padding |
| `spacing[5]` | 20px | Section gaps |
| `spacing[6]` | 24px | Card gaps, form field gaps |
| `spacing[8]` | 32px | Section padding |
| `spacing[10]` | 40px | Large section gaps |
| `spacing[12]` | 48px | Page section gaps |
| `spacing[16]` | 64px | Hero sections |
| `spacing[20]` | 80px | Large hero sections |
| `spacing[24]` | 96px | Maximum spacing |

**Rule:** All spacing values in component source must come from this scale. Ad-hoc numeric literals (e.g., `padding: 17px`) are not permitted. If a value is not in the scale, add it to `design-tokens.ts` first.

### Border radius

| Token | Value | Use |
|---|---|---|
| `radius.none` | 0 | No rounding |
| `radius.sm` | 4px | Small elements (badges, chips) |
| `radius.md` | 6px | Default (inputs, buttons) |
| `radius.lg` | 8px | Cards, modals |
| `radius.xl` | 12px | Large cards |
| `radius.full` | 9999px | Pills, avatars |

---

## Typography

Sourced from `packages/shared/src/design-tokens.ts` → `typography`.

**Typeface:** Inter (loaded via `apps/web/fonts.ts` using `next/font/google`). Geist is the alternative — if the team switches, change `typography.family.sans` in `design-tokens.ts` and nowhere else. No other font families are permitted in the POC UI.

**Size scale:**

| Token | Value | Use |
|---|---|---|
| `typography.size.xs` | 12px | Captions, helper text |
| `typography.size.sm` | 13px | Secondary body, table cells |
| `typography.size.base` | 14px | Primary body (developer density) |
| `typography.size.md` | 15px | Emphasized body |
| `typography.size.lg` | 16px | Section intro |
| `typography.size.xl` | 18px | Page title (small) |
| `typography.size['2xl']` | 20px | Page title (default — max in POC) |

**Weight scale:**

| Token | Value | Use |
|---|---|---|
| `typography.weight.regular` | 400 | Body text |
| `typography.weight.medium` | 500 | Labels, secondary emphasis |
| `typography.weight.semibold` | 600 | Headings, primary emphasis (max weight) |

No weight above 600 is used in the POC. Bold (700) and heavier weights are reserved for the production marketing site.

---

## Color System

Sourced from `packages/shared/src/design-tokens.ts` → `color`.

### Palette structure

**Backgrounds (`color.bg`):** `app` (light canvas), `appDark`, `surface` (card), `surfaceDark`, `muted`, `mutedDark`

**Borders (`color.border`):** `subtle`, `subtleDark`, `strong`, `strongDark`, `focus` (the single blue accent: `hsl(217 91% 60%)`)

**Text (`color.text`):** `primary`, `primaryDark`, `secondary`, `secondaryDark`, `tertiary`, `tertiaryDark`, `inverse`

**Accent (`color.accent`):** `base`, `baseDark`, `hover`, `hoverDark`, `active`, `activeDark`, `subtle`, `subtleDark`
- The accent is a single blue: `hsl(217 91% 50%)` in light mode, `hsl(217 91% 60%)` in dark mode.
- Used sparingly: focus rings, primary CTAs, links, selected row backgrounds.
- Never used for decoration.

**Status (`color.status`):** `success`, `successBg`, `warning`, `warningBg`, `error`, `errorBg`, `info`, `infoBg`
- Used only in `Badge`, `Toast`, and status pills.
- Not used for decoration or layout.

### WCAG contrast requirements

All text and interactive elements must meet WCAG 2.1 AA contrast ratios:

| Pair | Minimum ratio |
|---|---|
| `text.primary` / `bg.app` | 7:1 (AAA) |
| `text.secondary` / `bg.app` | 4.5:1 (AA) |
| `accent.base` / `bg.app` | 4.5:1 (AA) |
| Dark mode equivalents | Same minimums |

These ratios are verified by `scripts/check-contrast.ts` (run via `npm run check:contrast`).

---

## Component Rules

All UI surfaces consume the `UI_Primitives` set from `apps/web/components/ui/`. Duplicated button logic, one-off giant components, and inline styling are not permitted.

### UI_Primitives inventory

| Primitive | File | Purpose |
|---|---|---|
| `Button` | `ui/Button.tsx` | All clickable actions |
| `Input` | `ui/Input.tsx` | Single-line text input |
| `Textarea` | `ui/Textarea.tsx` | Multi-line text input |
| `Card` | `ui/Card.tsx` | Content container |
| `Modal` | `ui/Modal.tsx` | Overlay dialogs (Radix Dialog) |
| `Dropdown` | `ui/Dropdown.tsx` | Menu and select (Radix DropdownMenu) |
| `Badge` | `ui/Badge.tsx` | Status indicators |
| `Tabs` | `ui/Tabs.tsx` | Tab navigation (Radix Tabs) |
| `Toast` | `ui/Toast.tsx` | Transient notifications (sonner) |
| `EmptyState` | `ui/EmptyState.tsx` | Zero-data screens |
| `LoadingState` | `ui/LoadingState.tsx` | Pending operation screens |
| `FormField` | `ui/FormField.tsx` | Label + input + error wrapper |

Each primitive uses `class-variance-authority` (CVA) for variant management. The variant API is the single public interface — no prop drilling of raw class strings.

### Component folder rules

UI component source is organized into five folders with no cross-folder imports between feature folders:

```
apps/web/components/
  ui/           — UI_Primitives (shared by all feature surfaces)
  layout/       — AppShell, PocHeader, PocSidebar, ContentFrame, PageHeader
  forms/        — Form_Builder_UI components
  submissions/  — Form_Submission_UI components
  walrus/       — Walrus-specific indicators (UploadStatusPill)
```

`components/forms/**` must not import from `components/submissions/**` or `components/walrus/**`, and vice versa. Cross-cutting concerns go in `components/ui/`.

### Form_Builder_UI field types

The V1 field-type palette is exactly: `text`, `textarea`, `email`, `number`, `select`, `checkbox`. No other field types are permitted in the POC. No drag-and-drop reordering — fields are reordered via up/down chevron buttons only.

### Dashboard column order

The status dashboard renders columns in exactly this order:

```
Form Name | Submissions | Encryption | Upload | Blob Ref | Last Activity
```

No analytics widgets, charts, or marketing content appear on dashboard surfaces.

---

## Interaction Philosophy

Every asynchronous POC action must render all five UX states explicitly. No blank screens during pending operations.

### UX states

| State | When | Visual treatment |
|---|---|---|
| `idle` | Before any action | Default form/list view |
| `loading` | Action in flight | `LoadingState` or inline spinner + progress copy |
| `success` | Action completed | Success indicator + result data |
| `error` | Action failed | Stage-labeled error message + retry option |
| `empty` | No data | `EmptyState` with a primary CTA |

### Progress copy

All user-visible copy for async operations comes from `apps/web/copy/ux-copy.ts`. The copy uses encryption-agnostic language:

| Stage | Copy |
|---|---|
| Encrypting | "Securing your form…" |
| Uploading | "Uploading securely…" |
| Anchoring | "Confirming on-chain…" |
| Retrieving | "Fetching your form…" |
| Decrypting | "Unlocking your form…" |

Raw technical terms (`AES-256-GCM`, `blob storage`, `aggregator`, `publisher`, `finalization`, `seal encrypt`, `walrus`) must not appear in user-visible copy.

### Error messages

Errors are stage-labeled. The error envelope from the API includes a `stage` field (`env`, `signer`, `validate`, `encrypt`, `upload`, `anchor`, `retrieve`, `decrypt`). The UI maps this to a human-readable message identifying which step failed.

---

## Animation Constraints

Sourced from `packages/shared/src/design-tokens.ts` → `motion`.

### Permitted animations

Only opacity fades and small transforms. All durations and easings come from the tokens:

| Token | Value | Use |
|---|---|---|
| `motion.duration.instant` | 80ms | Hover, focus ring fade-in |
| `motion.duration.fast` | 140ms | Button press, popover open |
| `motion.duration.base` | 200ms | Modal open, page transition |
| `motion.duration.slow` | 320ms | Toast entry (rare) |
| `motion.easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | Ease-out (enter) |
| `motion.easing.accel` | `cubic-bezier(0.4, 0, 1, 1)` | Ease-in (exit) |

### Pre-baked primitives

```typescript
motion.primitives.fadeIn      // opacity 200ms cubic-bezier(0.2, 0, 0, 1)
motion.primitives.fadeOut     // opacity 140ms cubic-bezier(0.4, 0, 1, 1)
motion.primitives.translateUp // transform 200ms cubic-bezier(0.2, 0, 0, 1)
```

Import these primitives — do not hand-roll animation values.

### Prohibited animations

- Bouncing or overshoot (spring physics)
- Parallax scrolling
- Confetti or particle effects
- Crypto-flashy transitions (glowing borders, pulsing neon)
- Literal `ms` values in `className` or `style` props (use token references)

### Reduced motion

`AppShell` rewrites `motion.primitives.*` classes to `transition-none` when `prefers-reduced-motion: reduce` is set. All animations must respect this media query.

---

## Accessibility Requirements

### WCAG 2.1 AA compliance

All text and interactive elements must meet WCAG 2.1 AA contrast ratios (see Color System above). Contrast is verified by `npm run check:contrast`.

### Keyboard navigation

All interactive elements must be fully operable via keyboard. Tab order must be logical and follow visual reading order.

### Focus indicators

Every interactive primitive uses exactly the focus treatment from `packages/shared/src/design-tokens.ts` → `focusRing`:

```typescript
focusRing.outline       // "2px solid hsl(217 91% 60%)"
focusRing.outlineOffset // "2px"
```

No custom focus styles are permitted. No `outline: none` without a visible replacement.

### Semantic HTML

- All form fields must have associated `<label>` elements.
- Error messages must be associated with their fields via `aria-describedby`.
- Icon-only buttons must have `aria-label`.
- Status indicators must not rely on color alone — use icons or text alongside color.
- Modal dialogs must trap focus and restore focus on close.

### Responsive layout

The POC UI must be legible and operable at viewport widths from 360px to 1920px. Primary optimization target is developer-laptop widths (1280–1536px).

Breakpoints (sourced from design tokens):

| Name | Width |
|---|---|
| `xs` | 360px |
| `md` | 768px |
| `lg` | 1280px |
| `xl` | 1536px |
| `2xl` | 1920px |

---

## Tailwind Integration

`tailwind.config.ts` on the `walrus-poc` branch is generated from `design-tokens.ts` via a `buildTailwindTheme()` helper. This ensures the Tailwind utility classes and the TypeScript token values stay in sync.

The mapping covers: `theme.extend.spacing`, `colors`, `borderRadius`, `boxShadow`, `fontFamily`, `fontSize`, `transitionDuration`, and `screens`.

**Rule:** Do not add Tailwind arbitrary values (e.g., `w-[17px]`, `text-[#abc]`) in component source. If a value is needed, add it to `design-tokens.ts` first, then use the generated Tailwind class.

---

## Related Files

- `packages/shared/src/design-tokens.ts` — executable token source of truth
- `apps/web/components/ui/` — UI_Primitives implementation
- `apps/web/copy/ux-copy.ts` — all user-visible strings
- `apps/web/fonts.ts` — Inter font loading
- `tailwind.config.ts` — Tailwind theme generated from tokens
- `scripts/check-contrast.ts` — WCAG contrast verification
