'use client';

import { use } from 'react';
import { FormPreviewPage } from '@poc/apps/web/pages/FormPreviewPage';

export default function Page({ params }: { params: Promise<{ blob_id: string }> }) {
  const { blob_id } = use(params);
  return <FormPreviewPage blobId={blob_id} />;
}
