/**
 * Airtable public shared form scraper.
 *
 * Strategy:
 *   1. Fetch the Airtable share page HTML
 *   2. Extract the signed `readSharedFormData` API URL embedded in the page
 *   3. Call that API to get the real field schema
 *   4. Map Airtable column types → SWRAP PocField types
 *
 * This works without auth, OAuth, or browser automation.
 * Only public Airtable shared form links (shr...) are supported.
 *
 * No external dependencies — uses Node.js fetch (Next.js 15 has it globally).
 */

// ─── Lightweight field type (matches PocField in apps/web) ───────────────────
// Defined locally to avoid a cross-workspace import dependency.

export interface ImportedField {
  id: string
  type: string
  label: string
  required?: boolean
  placeholder?: string
  helpText?: string
  options?: string[]           // for 'select' fields
  maxStars?: number            // for 'star_rating' fields
  validation?: {
    minValue?: number
    maxValue?: number
    minLength?: number
    maxLength?: number
  }
}

// ─── URL validation ───────────────────────────────────────────────────────────

const AIRTABLE_SHARE_RE =
  /^https:\/\/airtable\.com\/[a-zA-Z0-9]+\/shr[a-zA-Z0-9]+/

export function isValidAirtableShareUrl(url: string): boolean {
  return AIRTABLE_SHARE_RE.test(url.trim())
}

// ─── Field type mapping ───────────────────────────────────────────────────────

/**
 * Maps Airtable internal column types → SWRAP builder PocField types.
 *
 * Airtable uses a `text` type for many things — typeOptions.validatorName
 * disambiguates email/url. We handle that below.
 */
const TYPE_MAP: Record<string, string> = {
  text: 'text',              // may be overridden by validatorName
  multilineText: 'textarea',
  richText: 'textarea',
  email: 'email',
  url: 'url',
  phoneNumber: 'phone',
  number: 'number',
  currency: 'number',
  percent: 'number',
  rating: 'star_rating',
  select: 'select',
  multiSelect: 'select',      // map to select (closest equivalent)
  checkbox: 'checkbox',
  date: 'text',
  dateTime: 'text',
  multipleAttachment: 'file_upload',
  // computed / linked fields — skip
  autoNumber: '_skip',
  formula: '_skip',
  lookup: '_skip',
  rollup: '_skip',
  count: '_skip',
  createdTime: '_skip',
  lastModifiedTime: '_skip',
  createdBy: '_skip',
  lastModifiedBy: '_skip',
  singleCollaborator: '_skip',
  multipleCollaborators: '_skip',
  multipleRecordLinks: '_skip',
  externalSyncSource: '_skip',
  button: '_skip',
  barcode: '_skip',
}

// ─── Airtable API response shapes ─────────────────────────────────────────────

interface AirtableColumn {
  id: string
  name: string
  type: string
  typeOptions?: {
    validatorName?: string   // 'email' | 'url' for text fields
    choices?: Record<string, { id: string; name: string; color?: string }>
    choiceOrder?: string[]
    max?: number             // for rating fields
  } | null
}

interface AirtableFormFieldMeta {
  title?: string
  description?: string
  required?: boolean
  shouldShowAsList?: boolean
  whitelistedChoiceIds?: string[]
}

interface AirtableView {
  id: string
  name: string
  type: string
  columnOrder: { columnId: string; visibility: boolean }[]
  meaningfulColumnOrder?: { columnId: string; visibility: boolean }[]
  metadata?: {
    form?: {
      fieldsByColumnId?: Record<string, AirtableFormFieldMeta>
      description?: string
    }
  }
}

interface AirtableFormTable {
  name: string
  columns: AirtableColumn[]
  views: AirtableView[]
}

interface AirtableReadSharedFormResponse {
  msg: string
  data: {
    formTable: AirtableFormTable
  }
}

// ─── Scraper result ───────────────────────────────────────────────────────────

export interface AirtableScrapedForm {
  title: string
  description?: string
  fields: ImportedField[]
  skipped: { name: string; type: string; reason: string }[]
  source: 'readSharedFormData'
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

/**
 * Scrape a public Airtable shared form URL and return SWRAP-compatible fields.
 *
 * @throws Error with a user-readable message on failure.
 */
export async function scrapeAirtableSharedForm(
  shareUrl: string,
): Promise<AirtableScrapedForm> {
  const url = shareUrl.trim()

  if (!isValidAirtableShareUrl(url)) {
    throw new Error(
      'Invalid Airtable URL. Please paste a public shared form link like: https://airtable.com/appXxx/shrXxx',
    )
  }

  // ── Step 1: Fetch the Airtable page HTML ─────────────────────────────────
  const pageHtml = await fetchAirtablePage(url)

  // ── Step 2: Extract signed API URL from embedded JS ──────────────────────
  const apiUrl = extractReadSharedFormDataUrl(pageHtml)
  if (!apiUrl) {
    throw new Error(
      'Could not import this Airtable form yet. The form may be private or unavailable.',
    )
  }

  // ── Step 3: Call readSharedFormData ──────────────────────────────────────
  const formData = await fetchReadSharedFormData(apiUrl, pageHtml)

  // ── Step 4: Parse + map ──────────────────────────────────────────────────
  return parseFormData(formData, pageHtml)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function fetchAirtablePage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    // Next.js fetch — disable caching so we always get fresh signed URLs
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(
      `Could not reach Airtable (HTTP ${res.status}). Check your link and try again.`,
    )
  }

  return res.text()
}

/**
 * Extracts the signed `readSharedFormData` URL from the Airtable page HTML.
 *
 * Airtable embeds a prefetch call in a `<script>` tag:
 *   window.__stashedPrefetch = {
 *     urlWithParams: "/v0.3/view/viw.../readSharedFormData?...&accessPolicy=...",
 *     ...
 *   }
 *
 * The URL is JSON-encoded with \u002F (/) escape sequences.
 */
function extractReadSharedFormDataUrl(html: string): string | null {
  // Match the urlWithParams value containing readSharedFormData
  const match = html.match(
    /urlWithParams:\s*"([^"]*readSharedFormData[^"]*)"/,
  )
  if (!match) return null

  // Decode JSON unicode escapes (\u002F → /)
  const rawUrl = match[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  )

  return `https://airtable.com${rawUrl}`
}

async function fetchReadSharedFormData(
  apiUrl: string,
  pageHtml: string,
): Promise<AirtableReadSharedFormResponse> {
  // Extract headers that Airtable embeds in the page for its own prefetch call.
  // These are required — the API returns 400 without them.
  const appIdMatch = pageHtml.match(/"x-airtable-application-id":"([^"]+)"/)
  const appId = appIdMatch ? appIdMatch[1] : ''

  const pageLoadIdMatch = pageHtml.match(/"x-airtable-page-load-id":"([^"]+)"/)
  const pageLoadId = pageLoadIdMatch ? pageLoadIdMatch[1] : ''

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'x-time-zone': 'UTC',
      'x-user-locale': 'en',
      'x-airtable-inter-service-client': 'webClient',
      ...(appId ? { 'x-airtable-application-id': appId } : {}),
      ...(pageLoadId ? { 'x-airtable-page-load-id': pageLoadId } : {}),
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(
      `Could not import this Airtable form yet. The form may have expired or is unavailable (HTTP ${res.status}).`,
    )
  }

  const data = (await res.json()) as AirtableReadSharedFormResponse

  if (data.msg !== 'SUCCESS' || !data.data?.formTable) {
    throw new Error('Could not import this Airtable form yet.')
  }

  return data
}

/**
 * Parse the Airtable API response into SWRAP fields.
 *
 * Uses the form view's `columnOrder` + `fieldsByColumnId` metadata for:
 *   - Custom field titles (overrides the column name)
 *   - Required state
 *   - Help text / descriptions
 *
 * Uses `columns` array for:
 *   - Column types and typeOptions (choices, validatorName, rating max)
 */
function parseFormData(
  data: AirtableReadSharedFormResponse,
  pageHtml: string,
): AirtableScrapedForm {
  const { formTable } = data.data

  // Find the form view (type === 'form')
  const formView = formTable.views.find((v) => v.type === 'form') ?? formTable.views[0]

  // Form title: prefer the view name, fall back to page <title>
  let title = formView?.name ?? formTable.name
  // Try to extract cleaner title from page <title> tag
  const titleMatch = pageHtml.match(/<title>([^<]+)<\/title>/)
  if (titleMatch && titleMatch[1] && !titleMatch[1].toLowerCase().includes('airtable')) {
    title = titleMatch[1].replace(/ - Airtable$/, '').trim()
  }

  const formDescription = formView?.metadata?.form?.description

  // Build column lookup by id
  const columnsById = new Map<string, AirtableColumn>(
    formTable.columns.map((c) => [c.id, c]),
  )

  // Get ordered column IDs from the form view
  const orderedColumnIds =
    formView?.columnOrder
      ?.filter((entry) => entry.visibility !== false)
      .map((entry) => entry.columnId) ??
    formTable.columns.map((c) => c.id)

  // Form-level field metadata (titles, required, descriptions)
  const fieldsMeta = formView?.metadata?.form?.fieldsByColumnId ?? {}

  const fields: ImportedField[] = []
  const skipped: AirtableScrapedForm['skipped'] = []

  for (const colId of orderedColumnIds) {
    const col = columnsById.get(colId)
    if (!col) continue

    const meta = fieldsMeta[colId] ?? {}

    // Determine SWRAP field type
    let swrapType = TYPE_MAP[col.type]

    if (swrapType === '_skip') {
      skipped.push({
        name: col.name,
        type: col.type,
        reason: `Computed or linked field type "${col.type}" cannot be imported.`,
      })
      continue
    }

    if (!swrapType) {
      // Unknown type — fall back to short text
      swrapType = 'text'
    }

    // Refine 'text' type using validatorName
    if (col.type === 'text' && col.typeOptions?.validatorName) {
      const v = col.typeOptions.validatorName
      if (v === 'email') swrapType = 'email'
      else if (v === 'url') swrapType = 'url'
    }

    // Use custom title from form metadata if available
    const label = (meta.title ?? col.name).trim()

    // Build dropdown options for select fields
    let options: string[] | undefined
    if ((col.type === 'select' || col.type === 'multiSelect') && col.typeOptions?.choices) {
      const choices = col.typeOptions.choices
      const order = col.typeOptions.choiceOrder ?? Object.keys(choices)
      // Filter to whitelisted choices if the form restricts options
      const allowedIds = meta.whitelistedChoiceIds
        ? new Set(meta.whitelistedChoiceIds)
        : null
      options = order
        .filter((id) => !allowedIds || allowedIds.has(id))
        .map((id) => choices[id]?.name)
        .filter(Boolean) as string[]
    }

    // Build validation for star_rating
    let validation: ImportedField["validation"] | undefined
    if (col.type === 'rating' && col.typeOptions?.max) {
      validation = { minValue: 1, maxValue: col.typeOptions.max }
    }

    const field: ImportedField = {
      id: crypto.randomUUID(),
      type: swrapType,
      label,
      required: meta.required ?? false,
      ...(meta.description ? { helpText: meta.description.trim() } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(validation ? { validation } : {}),
    }

    fields.push(field)
  }

  return {
    title,
    description: formDescription ?? undefined,
    fields,
    skipped,
    source: 'readSharedFormData',
  }
}
