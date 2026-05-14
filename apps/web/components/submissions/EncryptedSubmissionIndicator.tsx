'use client';

/**
 * EncryptedSubmissionIndicator — small badge indicating that a submission
 * is encrypted. Always shows "Secured" to avoid exposing cryptographic
 * implementation details in user-visible copy (R19.8).
 *
 * Requirements: R12.5, R19.6, R19.8
 */

import * as React from 'react';
import { Badge } from '../ui/Badge';
import { Lock } from 'lucide-react';

export function EncryptedSubmissionIndicator() {
  return (
    <Badge variant="info" size="sm" aria-label="This submission is encrypted">
      <Lock className="h-3 w-3" aria-hidden="true" />
      Secured
    </Badge>
  );
}
