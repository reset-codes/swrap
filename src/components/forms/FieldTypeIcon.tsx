'use client';

import {
  Type,
  AlignLeft,
  FileText,
  ChevronDown,
  CheckSquare,
  Square,
  Star,
  Link,
  Image,
  Video,
  Paperclip,
} from 'lucide-react';
import type { FieldType } from '@/types/form';

const FIELD_TYPE_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  short_text: Type,
  long_text: AlignLeft,
  rich_text: FileText,
  dropdown: ChevronDown,
  multi_select: CheckSquare,
  checkbox: Square,
  star_rating: Star,
  url: Link,
  image_upload: Image,
  video_upload: Video,
  file_upload: Paperclip,
};

interface FieldTypeIconProps {
  type: FieldType;
  className?: string;
}

export function FieldTypeIcon({ type, className = 'h-4 w-4' }: FieldTypeIconProps) {
  const Icon = FIELD_TYPE_ICONS[type];
  return <Icon className={className} />;
}
