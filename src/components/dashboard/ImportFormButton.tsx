'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ImportSource = 'typeform' | 'google-forms' | 'airtable';

export function ImportFormButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<ImportSource>('typeform');
  const [jsonInput, setJsonInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || 'Import failed');
      }

      const { data } = await res.json();
      setIsOpen(false);
      setJsonInput('');
      
      // Navigate to the newly created form
      if (data.form?.id) {
        router.push(`/dashboard/forms/${data.form.id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON or import failed');
    } finally {
      setIsImporting(false);
    }
  };

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
              Paste the JSON export from your external form provider to import it into Swrap.
            </Dialog.Description>

            <div className="space-y-4">
              <div>
                <label className="text-small font-medium text-text-primary mb-1.5 block">
                  Source Platform
                </label>
                <div className="flex gap-2">
                  {(['typeform', 'google-forms', 'airtable'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSource(s)}
                      className={cn(
                        'flex-1 rounded-md border py-2 text-small font-medium transition-colors',
                        source === s
                          ? 'border-accent bg-accent-light text-accent'
                          : 'border-border bg-white text-text-secondary hover:bg-muted'
                      )}
                    >
                      {s === 'typeform' ? 'Typeform' : s === 'google-forms' ? 'Google Forms' : 'Airtable'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="import-json" className="text-small font-medium text-text-primary mb-1.5 block">
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
              <Button onClick={handleImport} disabled={isImporting || !jsonInput.trim()}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
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
