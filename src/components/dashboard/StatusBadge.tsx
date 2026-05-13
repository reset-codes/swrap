import { Badge } from '@/components/ui/badge';
import type { SubmissionStatus } from '@/types/submission';

// ─── StatusBadge ──────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: SubmissionStatus;
}

/** Human-readable labels for each submission status. */
const STATUS_LABELS: Record<SubmissionStatus, string> = {
  open: 'Open',
  under_review: 'Under Review',
  planned: 'Planned',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

/**
 * Colored badge for a submission Status_Tag.
 *
 * Maps each SubmissionStatus to the design-token badge variant defined in
 * UI_GUIDELINES.md and the Badge component's CVA variants.
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge variant={status} aria-label={`Status: ${STATUS_LABELS[status]}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
