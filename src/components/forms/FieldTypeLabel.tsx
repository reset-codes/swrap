'use client';

import type { FieldType } from '@/types/form';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: 'Short Text',
  long_text: 'Long Text',
  rich_text: 'Rich Text',
  dropdown: 'Dropdown',
  multi_select: 'Multi Select',
  checkbox: 'Checkbox',
  star_rating: 'Star Rating',
  url: 'URL',
  image_upload: 'Image Upload',
  video_upload: 'Video Upload',
  file_upload: 'File Upload',
};

interface FieldTypeLabelProps {
  type: FieldType;
  className?: string;
}

export function FieldTypeLabel({ type, className }: FieldTypeLabelProps) {
  return <span className={className}>{FIELD_TYPE_LABELS[type]}</span>;
}
