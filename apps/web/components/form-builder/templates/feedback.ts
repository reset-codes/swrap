import type { PocField } from '../FieldCard';

export const feedbackTemplate = {
  title: 'Feedback Form',
  description: 'Collect user feedback and suggestions',
  fields: [
    {
      id: 'fb-1',
      type: 'text',
      label: 'Your Name',
      placeholder: 'Enter your full name',
      required: true,
    },
    {
      id: 'fb-2',
      type: 'email',
      label: 'Email Address',
      placeholder: 'you@example.com',
      required: true,
    },
    {
      id: 'fb-3',
      type: 'star_rating',
      label: 'Overall Experience',
      maxStars: 5,
      required: true,
    },
    {
      id: 'fb-4',
      type: 'textarea',
      label: 'Your Feedback',
      placeholder: 'Tell us what you think…',
    },
    {
      id: 'fb-5',
      type: 'select',
      label: 'Category',
      options: ['Product', 'Support', 'Billing', 'Other'],
    },
  ] satisfies PocField[],
};
