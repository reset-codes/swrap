/**
 * Form Templates — pre-built field arrays for common form types.
 *
 * Each template exports: { title, description, fields }
 * The UI uses these to populate the form builder with a starting set of fields.
 *
 * DO NOT define templates inline in the UI component.
 */

export { feedbackTemplate } from './feedback';
export { surveyTemplate } from './survey';
export { reviewTemplate } from './review';
export { waitlistTemplate } from './waitlist';

import type { PocField } from '../FieldCard';

export interface FormTemplate {
  id: string;
  title: string;
  description: string;
  fields: PocField[];
}

import { feedbackTemplate } from './feedback';
import { surveyTemplate } from './survey';
import { reviewTemplate } from './review';
import { waitlistTemplate } from './waitlist';

export const FORM_TEMPLATES: FormTemplate[] = [
  { id: 'feedback', ...feedbackTemplate },
  { id: 'survey', ...surveyTemplate },
  { id: 'review', ...reviewTemplate },
  { id: 'waitlist', ...waitlistTemplate },
  {
    id: 'blank',
    title: 'Blank Form',
    description: 'Start from scratch with an empty form',
    fields: [],
  },
];
