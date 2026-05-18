'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2, Link as LinkIcon } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ImportSource = 'typeform' | 'google-forms' | 'airtable';

export function ImportFormButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<ImportSource>('airtable');
  const [jsonInput, setJsonInput] = useState('');
  const [airtableUrl, setAirtableUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Airtable URL import ───────────────────────────────────────────────────

  const handleAirtableUrlImport = async () => {
    setError(null);
    setIsImporting(true);

    try {
      const res = await fetch('/api/import/airtable-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: airtableUrl.trim() }),
      });

      const data = await res.json().catch(() => ({})) as {
        success?: boolean;
        data?: { redirectUrl?: string; formId?: string };
        error?: { message?: string };
      };

      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Import failed');
      }

      setIsOpen(false);
      setAirtableUrl('');

      const redirectUrl = data?.data?.redirectUrl;
      if (redirectUrl) {
        router.push(redirectUrl);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  // ── JSON import (Typeform / Google Forms / Airtable schema export) ────────

  const handleJsonImport = async () => {
    setError(null);
    setIsImporting(true);

    try {
      const parsedJson = JSON.parse(jsonInput);
      const res = await fetch(`/api/import/${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedJson),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(data.error?.message || 'Import failed');
      }

      const { data } = await res.json() as { data: { form?: { id?: string }; formId?: string } };
      setIsOpen(false);
      setJsonInput('');

      const formId = data.form?.id ?? data.formId;
      if (formId) {
        router.push(`/dashboard/forms/new?draft=${formId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON or import failed');
    } finally {
      setIsImporting(false);
    }
  };

  // ── Decide which handler to use ───────────────────────────────────────────

  const isAirtableUrl = source === 'airtable';
  const canSubmit = isAirtableUrl ? airtableUrl.trim().length > 0 : jsonInput.trim().length > 0;

  const handleImport = isAirtableUrl ? handleAirtableUrlImport : handleJsonImport;

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        <FileDown className="h-4 w-4" aria-hidden="true" />
        Import Form
      </Button>

      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
              'rounded-lg border border-border bg-white p-6 shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
            )}
          >
            <Dialog.Title className="text-h3 font-semibold text-text-primary mb-2">
              Import Form
            </Dialog.Title>
            <Dialog.Description className="text-body text-text-secondary mb-4">
              {isAirtableUrl
                ? 'Paste a public Airtable share link to import it instantly.'
                : 'Paste the JSON export from your form provider.'}
            </Dialog.Description>

            <div className="space-y-4">
              {/* Source selector */}
              <div>
                <label className="text-small font-medium text-text-primary mb-1.5 block">
                  Source
                </label>
                <div className="flex gap-2">
                  {(['airtable', 'typeform', 'google-forms'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setSource(s); setError(null); }}
                      className={cn(
                        'flex-1 rounded-md border py-2 text-small font-medium transition-colors',
                        source === s
                          ? 'border-accent bg-accent-light text-accent'
                          : 'border-border bg-white text-text-secondary hover:bg-muted',
                      )}
                    >
                      {s === 'airtable' ? 'Airtable' : s === 'typeform' ? 'Typeform' : 'Google Forms'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Airtable: URL input */}
              {isAirtableUrl ? (
                <div>
                  <label
                    htmlFor="import-airtable-url"
                    className="text-small font-medium text-text-primary mb-1.5 block"
                  >
                    Airtable Share Link
                  </label>
                  <div className="relative flex items-center">
                    <LinkIcon className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden="true" />
                    <input
                      id="import-airtable-url"
                      type="url"
                      className="w-full rounded-md border border-border bg-white pl-9 pr-3 py-2 text-small shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={airtableUrl}
                      onChange={(e) => setAirtableUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleImport(); }}
                      placeholder="https://airtable.com/appXxx/shrXxx"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-text-tertiary">
                    Paste the URL from your Airtable shared form (must be a public &ldquo;shr...&rdquo; link).
                  </p>
                </div>
              ) : (
                /* Non-airtable: JSON textarea */
                <div>
                  <label
                    htmlFor="import-json"
                    className="text-small font-medium text-text-primary mb-1.5 block"
                  >
                    JSON Data
                  </label>
                  <textarea
                    id="import-json"
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-small font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
                    rows={8}
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    placeholder={`Paste ${source} JSON here...`}
                  />
                </div>
              )}

              {error && (
                <p className="text-small text-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsOpen(false)} disabled={isImporting}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={isImporting || !canSubmit}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  'Import Form'
                )}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
