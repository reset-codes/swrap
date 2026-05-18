import type { PocField } from '../FieldCard';

export const waitlistTemplate = {
  title: 'Waitlist Form',
  description: 'Collect interest and build your early access list',
  fields: [
    {
      id: 'wl-1',
      type: 'text',
      label: 'Full Name',
      placeholder: 'Enter your full name',
      required: true,
    },
    {
      id: 'wl-2',
      type: 'email',
      label: 'Email Address',
      placeholder: 'you@example.com',
      required: true,
    },
    {
      id: 'wl-3',
      type: 'select',
      label: 'How would you use this?',
      options: ['Personal use', 'Small business', 'Enterprise', 'Developer'],
    },
    {
      id: 'wl-4',
      type: 'textarea',
      label: 'Anything else you want us to know?',
      placeholder: 'Tell us about your use case…',
    },
    {
      id: 'wl-5',
      type: 'checkbox',
      label: 'I agree to receive product updates by email',
      required: true,
    },
  ] satisfies PocField[],
};
