import type { PocField } from '../FieldCard';

export const reviewTemplate = {
  title: 'Customer Review',
  description: 'Collect customer reviews and testimonials',
  fields: [
    {
      id: 'rv-1',
      type: 'text',
      label: 'Your Name',
      placeholder: 'Enter your name',
      required: true,
    },
    {
      id: 'rv-2',
      type: 'email',
      label: 'Email Address',
      placeholder: 'you@example.com',
    },
    {
      id: 'rv-3',
      type: 'star_rating',
      label: 'Overall Rating',
      maxStars: 5,
      required: true,
    },
    {
      id: 'rv-4',
      type: 'text',
      label: 'Review Title',
      placeholder: 'Summarize your review in a few words',
      required: true,
    },
    {
      id: 'rv-5',
      type: 'textarea',
      label: 'Your Review',
      placeholder: 'Tell us about your experience…',
      required: true,
    },
    {
      id: 'rv-6',
      type: 'checkbox',
      label: 'I agree to publish this review publicly',
    },
  ] satisfies PocField[],
};
