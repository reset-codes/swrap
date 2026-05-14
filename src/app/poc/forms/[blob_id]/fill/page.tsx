'use client';

import { use } from 'react';
import { FormFillPage } from '@poc/apps/web/pages/FormFillPage';

export default function Page({ params }: { params: Promise<{ blob_id: string }> }) {
  const { blob_id } = use(params);
  return <FormFillPage blobId={blob_id} />;
}
