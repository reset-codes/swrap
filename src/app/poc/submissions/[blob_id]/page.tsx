'use client';

import { use } from 'react';
import { SubmissionViewPage } from '@poc/apps/web/pages/SubmissionViewPage';

export default function Page({ params }: { params: Promise<{ blob_id: string }> }) {
  const { blob_id } = use(params);
  return <SubmissionViewPage blobId={blob_id} />;
}
