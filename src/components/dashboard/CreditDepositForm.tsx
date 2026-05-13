'use client';

/**
 * CreditDepositForm — Client component for depositing storage credits.
 *
 * Renders a WAL amount input and a "Deposit Credits" button.
 * Calls POST /api/credits/deposit and shows success/error feedback.
 *
 * Requirements: R10, R13
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toasts } from '@/lib/toast';
import type { ApiResponse } from '@/types/api';

// ─── CreditDepositForm ────────────────────────────────────────────────────────

interface CreditDepositFormProps {
  /** Called after a successful deposit so the parent can refresh data. */
  onSuccess?: (newBalance: number) => void;
}

export function CreditDepositForm({ onSuccess }: CreditDepositFormProps) {
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleDeposit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setStatus('error');
      setMessage('Please enter a valid amount greater than zero.');
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch('/api/credits/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parsed }),
      });

      const json: ApiResponse<{ newBalance: number }> = await res.json();

      if (!json.success) {
        setStatus('error');
        setMessage(json.error.message);
        return;
      }

      setStatus('success');
      setMessage(`${parsed.toFixed(3)} WAL deposited successfully.`);
      setAmount('');
      toasts.creditDeposited(parsed);
      onSuccess?.(json.data.newBalance);
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
      toasts.networkError();
    }
  }

  return (
    <form onSubmit={handleDeposit} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id="wal-amount"
            type="number"
            min="0.001"
            step="0.001"
            placeholder="0.000"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (status !== 'idle') {
                setStatus('idle');
                setMessage('');
              }
            }}
            aria-label="WAL amount to deposit"
            aria-describedby={message ? 'deposit-feedback' : undefined}
            aria-invalid={status === 'error' ? 'true' : undefined}
            disabled={status === 'loading'}
            className="pr-12"
          />
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-small text-text-secondary"
            aria-hidden="true"
          >
            WAL
          </span>
        </div>

        <Button type="submit" disabled={status === 'loading' || !amount}>
          {status === 'loading' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Depositing…
            </>
          ) : (
            'Deposit Credits'
          )}
        </Button>
      </div>

      {message && (
        <p
          id="deposit-feedback"
          role={status === 'error' ? 'alert' : 'status'}
          className={
            status === 'success'
              ? 'text-small text-success'
              : 'text-small text-error'
          }
        >
          {message}
        </p>
      )}
    </form>
  );
}
