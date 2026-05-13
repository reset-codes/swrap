# SEALBASE — UI Guidelines

## Design Language

**Minimal. Premium. Calm. Structured.**

SEALBASE should feel like a modern enterprise SaaS product — not a crypto dashboard, not a hackathon project. The aesthetic references are Linear, Typeform, Notion, Airtable, and Supabase.

---

## What to Avoid

| Avoid | Use Instead |
|-------|-------------|
| Neon colors, glowing borders | Neutral grays, subtle accent colors |
| Glassmorphism (heavy blur, transparency) | Clean solid surfaces with subtle shadows |
| Excessive gradients | Flat colors with intentional gradient accents |
| Cluttered layouts | Generous whitespace, clear hierarchy |
| Crypto/blockchain iconography | Clean, universal iconography (Lucide) |
| Flashy animations | Subtle, purposeful motion |
| Dark mode by default | Light mode primary, dark mode supported |
| Heavy font weights everywhere | Typographic hierarchy through size and weight |

---

## Color System

### Palette

```
Background:   #FAFAFA  (near-white, not pure white)
Surface:      #FFFFFF  (cards, panels)
Border:       #E5E7EB  (subtle dividers)
Muted:        #F3F4F6  (secondary backgrounds, hover states)

Text Primary:   #111827  (near-black)
Text Secondary: #6B7280  (labels, captions)
Text Muted:     #9CA3AF  (placeholders, disabled)

Accent:       #2563EB  (primary blue — actions, links, focus)
Accent Hover: #1D4ED8
Accent Light: #EFF6FF  (accent backgrounds, badges)

Success:  #16A34A
Warning:  #D97706
Error:    #DC2626
Info:     #2563EB

Walrus Brand: #0EA5E9  (used sparingly for Walrus-specific UI elements)
Seal Brand:   #7C3AED  (used sparingly for encryption indicators)
```

### Usage Rules

- Use `Accent` only for primary actions (buttons, links, focus rings).
- Use `Walrus Brand` only for Walrus-specific indicators (blob IDs, storage status).
- Use `Seal Brand` only for encryption indicators and Seal-related UI.
- Never use more than 2 accent colors on a single screen.
- Status colors (success, warning, error) are for feedback only — not decoration.

---

## Typography

### Font Stack

```
Font Family: Inter (primary), system-ui (fallback)
Monospace:   JetBrains Mono (for blob IDs, code, technical values)
```

### Scale

| Name | Size | Weight | Use |
|------|------|--------|-----|
| Display | 36px / 2.25rem | 700 | Hero headings, landing page |
| H1 | 28px / 1.75rem | 600 | Page titles |
| H2 | 22px / 1.375rem | 600 | Section headings |
| H3 | 18px / 1.125rem | 600 | Card titles, subsections |
| Body | 14px / 0.875rem | 400 | Default body text |
| Small | 12px / 0.75rem | 400 | Labels, captions, metadata |
| Mono | 12px / 0.75rem | 400 | Blob IDs, technical values |

### Rules

- Line height: 1.5 for body, 1.2 for headings.
- Letter spacing: -0.01em for headings, normal for body.
- Never use more than 3 font sizes on a single screen.
- Use weight (not size) to create hierarchy within the same text block.

---

## Spacing System

Based on a 4px base unit:

```
4px   (1)  — micro gaps, icon padding
8px   (2)  — tight spacing, inline elements
12px  (3)  — compact padding
16px  (4)  — default padding, card padding
20px  (5)  — section gaps
24px  (6)  — card gaps, form field gaps
32px  (8)  — section padding
48px  (12) — page section gaps
64px  (16) — hero sections
```

---

## Component Guidelines

### Buttons

```
Primary:    bg-accent text-white, hover:bg-accent-hover
Secondary:  bg-white border border-border text-primary, hover:bg-muted
Ghost:      transparent text-secondary, hover:bg-muted text-primary
Destructive: bg-error text-white, hover:bg-error/90

Size SM:  h-8  px-3  text-sm
Size MD:  h-9  px-4  text-sm  (default)
Size LG:  h-10 px-6  text-base
```

- Always include a loading state for async actions.
- Destructive actions require a confirmation dialog.
- Icon buttons must have accessible labels.

### Cards

```
bg-white border border-border rounded-lg shadow-sm
padding: 24px
hover (interactive cards): shadow-md transition-shadow
```

### Form Fields

```
Input:    h-9 border border-border rounded-md px-3 text-sm
          focus: ring-2 ring-accent/20 border-accent
          error: border-error ring-2 ring-error/20
Label:    text-sm font-medium text-primary mb-1.5
Help:     text-xs text-muted mt-1
Error:    text-xs text-error mt-1
```

### Badges / Status Tags

```
open:         bg-blue-50   text-blue-700   border-blue-200
under_review: bg-yellow-50 text-yellow-700 border-yellow-200
planned:      bg-purple-50 text-purple-700 border-purple-200
resolved:     bg-green-50  text-green-700  border-green-200
rejected:     bg-red-50    text-red-700    border-red-200
```

### Tables

- Zebra striping: alternate rows with `bg-muted/40`.
- Sticky header on scroll.
- Row hover: `bg-muted/60`.
- Pagination at bottom, showing count and page controls.
- Empty state centered in table body.

---

## Motion Guidelines

### Principles

- Motion should be **purposeful** — it communicates state changes, not decoration.
- Motion should be **fast** — transitions under 300ms for UI elements.
- Motion should be **subtle** — ease-out curves, not bouncy springs for business UI.

### Standard Transitions

```
Page transitions:     fade + slight upward translate, 200ms ease-out
Modal/dialog:         scale from 0.95 + fade, 150ms ease-out
Dropdown/popover:     fade + slight downward translate, 120ms ease-out
Toast notifications:  slide in from right, 200ms ease-out
Form field focus:     ring expand, 100ms ease-out
Button hover:         background color, 100ms ease-in-out
```

### Conversational Mode Transitions

The Conversational Mode form experience requires more expressive motion:

```
Question enter:   slide up + fade in, 300ms ease-out
Question exit:    slide up + fade out, 200ms ease-in
Progress bar:     smooth width transition, 400ms ease-in-out
Answer confirm:   subtle scale pulse, 150ms ease-out
```

### Framer Motion Variants

```typescript
// Standard page element
const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }
}

// Conversational form question
const questionTransition = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.2, ease: 'easeIn' } }
}
```

---

## Layout Guidelines

### Dashboard Layout

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (240px fixed)  │  Main Content Area        │
│                         │                           │
│  Logo                   │  Page Header              │
│  Navigation             │  ─────────────────────── │
│  ─────────────────────  │  Content                  │
│  Workspace info         │                           │
│  Storage credits        │                           │
│  ─────────────────────  │                           │
│  User / Settings        │                           │
└─────────────────────────────────────────────────────┘
```

### Public Form Layout

```
┌─────────────────────────────────────────────────────┐
│  Minimal header (logo + form title)                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│         Form content (centered, max-w-2xl)          │
│                                                     │
│  [Conversational: one question, full screen]        │
│  [Table: all fields, scrollable]                    │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Powered by SEALBASE (subtle footer)                │
└─────────────────────────────────────────────────────┘
```

---

## Iconography

Use **Lucide React** exclusively. Do not mix icon libraries.

Key icons:
- Forms: `FileText`
- Submissions: `Inbox`
- Storage: `Database`
- Encryption: `Lock` / `Unlock`
- Walrus: custom SVG or `Cloud`
- Settings: `Settings`
- Export: `Download`
- Status: `Circle` (colored by status)
- Add: `Plus`
- Delete: `Trash2`
- Edit: `Pencil`

---

## Accessibility

- All interactive elements must have accessible labels.
- Color must not be the only indicator of state (use icons + text alongside color).
- Focus rings must be visible (use `ring-2 ring-accent/50`).
- Form fields must have associated labels.
- Error messages must be associated with their fields via `aria-describedby`.
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text.
- Keyboard navigation must work for all interactive elements.

---

## Responsive Breakpoints

```
sm:  640px   — Mobile landscape
md:  768px   — Tablet
lg:  1024px  — Desktop (primary target for dashboard)
xl:  1280px  — Wide desktop
2xl: 1536px  — Ultra-wide
```

- Dashboard: optimized for `lg` and above. Collapsible sidebar on `md`.
- Public forms: fully responsive from `sm` upward.
- Landing page: responsive from `sm` upward.
