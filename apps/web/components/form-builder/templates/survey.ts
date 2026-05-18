import type { PocField } from '../FieldCard';

export const surveyTemplate = {
  title: 'Product Survey',
  description: 'Understand how customers use your product',
  fields: [
    {
      id: 'sv-1',
      type: 'text',
      label: 'Full Name',
      placeholder: 'Enter your name',
    },
    {
      id: 'sv-2',
      type: 'email',
      label: 'Email Address',
      placeholder: 'you@example.com',
      required: true,
    },
    {
      id: 'sv-3',
      type: 'select',
      label: 'How did you hear about us?',
      options: ['Social Media', 'Friend or Colleague', 'Search Engine', 'Advertisement', 'Other'],
    },
    {
      id: 'sv-4',
      type: 'select',
      label: 'How often do you use our product?',
      options: ['Daily', 'Weekly', 'Monthly', 'Rarely'],
    },
    {
      id: 'sv-5',
      type: 'star_rating',
      label: 'How would you rate our product?',
      maxStars: 5,
      required: true,
    },
    {
      id: 'sv-6',
      type: 'textarea',
      label: 'What feature would you like to see improved?',
      placeholder: 'Share your thoughts…',
    },
  ] satisfies PocField[],
};
