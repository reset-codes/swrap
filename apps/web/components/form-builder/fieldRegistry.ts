/**
 * fieldRegistry — centralized field type definitions, metadata, and defaults.
 *
 * This is the single source of truth for:
 *   - Field type identifiers
 *   - Human-readable labels
 *   - Icons
 *   - Default field values (label + placeholder + type-specific defaults)
 *   - Category groupings for the palette and field picker
 *
 * All field creation MUST go through `getDefaultField(type)` so defaults
 * are consistent everywhere in the builder.
 *
 * Requirements: 3.1 (centralized registry), Phase 1 Task 2+3
 */

import {
  Type,
  AlignLeft,
  Mail,
  Phone,
  Link,
  ChevronDown,
  CheckSquare,
  Star,
  Wallet,
  Hash,
  Upload,
  Image,
} from 'lucide-react';
import type { PocField } from './FieldCard';

// ---------------------------------------------------------------------------
// Field type identifiers (exhaustive union)
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'url'
  | 'select'
  | 'checkbox'
  | 'star_rating'
  | 'wallet_address'
  | 'file_upload'
  | 'image_upload';

// ---------------------------------------------------------------------------
// Field registry entry
// ---------------------------------------------------------------------------

export interface FieldRegistryEntry {
  type: FieldType;
  label: string;
  icon: React.ElementType;
  category: FieldCategory;
  /** Default values for newly-inserted fields of this type. */
  defaults: Omit<PocField, 'id'>;
}

export type FieldCategory = 'Basic' | 'Contact' | 'Media' | 'Advanced';

// ---------------------------------------------------------------------------
// Registry definition
// ---------------------------------------------------------------------------

export const FIELD_REGISTRY: Record<FieldType, FieldRegistryEntry> = {
  text: {
    type: 'text',
    label: 'Short Text',
    icon: Type,
    category: 'Basic',
    defaults: {
      type: 'text',
      label: 'Your Name',
      placeholder: 'Enter your full name',
    },
  },
  textarea: {
    type: 'textarea',
    label: 'Long Text',
    icon: AlignLeft,
    category: 'Basic',
    defaults: {
      type: 'textarea',
      label: 'Tell us more',
      placeholder: 'Write your response…',
    },
  },
  number: {
    type: 'number',
    label: 'Number',
    icon: Hash,
    category: 'Basic',
    defaults: {
      type: 'number',
      label: 'Number',
      placeholder: 'Enter a number',
    },
  },
  select: {
    type: 'select',
    label: 'Dropdown',
    icon: ChevronDown,
    category: 'Basic',
    defaults: {
      type: 'select',
      label: 'Select an Option',
      placeholder: 'Choose an option…',
      options: ['Option 1', 'Option 2'],
    },
  },
  checkbox: {
    type: 'checkbox',
    label: 'Checkbox',
    icon: CheckSquare,
    category: 'Basic',
    defaults: {
      type: 'checkbox',
      label: 'I agree to the terms',
    },
  },
  email: {
    type: 'email',
    label: 'Email',
    icon: Mail,
    category: 'Contact',
    defaults: {
      type: 'email',
      label: 'Email Address',
      placeholder: 'you@example.com',
    },
  },
  phone: {
    type: 'phone',
    label: 'Phone',
    icon: Phone,
    category: 'Contact',
    defaults: {
      type: 'phone',
      label: 'Phone Number',
      placeholder: '+1 (555) 000-0000',
    },
  },
  url: {
    type: 'url',
    label: 'URL',
    icon: Link,
    category: 'Contact',
    defaults: {
      type: 'url',
      label: 'Website',
      placeholder: 'https://yourwebsite.com',
    },
  },
  file_upload: {
    type: 'file_upload',
    label: 'File Upload',
    icon: Upload,
    category: 'Media',
    defaults: {
      type: 'file_upload',
      label: 'Upload File',
      placeholder: 'Drag & drop or click to upload',
    },
  },
  image_upload: {
    type: 'image_upload',
    label: 'Image Upload',
    icon: Image,
    category: 'Media',
    defaults: {
      type: 'image_upload',
      label: 'Upload Image',
      placeholder: 'Drag & drop or click to upload an image',
    },
  },
  star_rating: {
    type: 'star_rating',
    label: 'Rating',
    icon: Star,
    category: 'Advanced',
    defaults: {
      type: 'star_rating',
      label: 'Rate your experience',
      maxStars: 5,
    },
  },
  wallet_address: {
    type: 'wallet_address',
    label: 'Wallet Address',
    icon: Wallet,
    category: 'Advanced',
    defaults: {
      type: 'wallet_address',
      label: 'Wallet Address',
      placeholder: '0x…',
      helpText: 'Enter your SUI wallet address',
    },
  },
};

// ---------------------------------------------------------------------------
// Category ordering for the picker UI
// ---------------------------------------------------------------------------

export const FIELD_CATEGORIES: FieldCategory[] = ['Basic', 'Contact', 'Media', 'Advanced'];

export const FIELDS_BY_CATEGORY: Record<FieldCategory, FieldRegistryEntry[]> = {
  Basic: ['text', 'textarea', 'number', 'select', 'checkbox'].map(
    (t) => FIELD_REGISTRY[t as FieldType],
  ),
  Contact: ['email', 'phone', 'url'].map((t) => FIELD_REGISTRY[t as FieldType]),
  Media: ['file_upload', 'image_upload'].map((t) => FIELD_REGISTRY[t as FieldType]),
  Advanced: ['star_rating', 'wallet_address'].map((t) => FIELD_REGISTRY[t as FieldType]),
};

// ---------------------------------------------------------------------------
// getDefaultField — canonical factory for new fields
// ---------------------------------------------------------------------------

/**
 * Creates a new PocField with a fresh UUID and the canonical defaults
 * for the given type.
 *
 * All field creation in the builder MUST go through this function.
 * Do NOT call `{ id: crypto.randomUUID(), type, label: '' }` inline.
 */
export function getDefaultField(type: string): PocField {
  const entry = FIELD_REGISTRY[type as FieldType];
  if (!entry) {
    // Unknown type: provide a minimal valid field
    return {
      id: crypto.randomUUID(),
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' '),
    };
  }
  return {
    id: crypto.randomUUID(),
    ...entry.defaults,
  };
}
