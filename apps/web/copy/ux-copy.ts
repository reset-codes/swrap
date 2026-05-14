/**
 * UX copy strings for all asynchronous POC actions.
 *
 * This is the SOLE source of user-visible strings for Phase 4/5 surfaces.
 * All components MUST import from here — never inline copy in UI files.
 *
 * Banned terms (enforced by ESLint no-restricted-syntax):
 *   decentralized, blob storage, aggregator, publisher, finalization,
 *   seal encrypt, AES-GCM, walrus
 *
 * Requirements: R19.8
 */
export const uxCopy = {
  /**
   * Save flow — Form_Builder_UI (POST /api/poc/forms)
   * Stages: securing → uploading → anchoring
   */
  save: {
    idle: 'Save form',
    loading: {
      securing:  'Securing your form…',
      uploading: 'Uploading securely…',
      anchoring: 'Saving to the network…',
    },
    success: 'Form saved successfully.',
    error: {
      securing:  'Failed to secure your form. Please try again.',
      uploading: 'Upload failed. Please check your connection and try again.',
      anchoring: 'Could not save to the network. Please try again.',
    },
  },

  /**
   * Fetch flow — FormPreviewPage / FormFillPage (GET /api/poc/forms/[blob_id])
   * Stages: loading → success | error
   */
  fetch: {
    idle:    'Load form',
    loading: 'Loading your form…',
    success: 'Form loaded.',
    error:   'Could not load the form. Please check the link and try again.',
  },

  /**
   * Submit flow — Form_Submission_UI (POST /api/poc/submissions)
   * Stages: validating → securing → uploading
   */
  submit: {
    idle: 'Submit',
    loading: {
      validating: 'Checking your responses…',
      securing:   'Securing your response…',
      uploading:  'Submitting securely…',
    },
    success: 'Response submitted successfully.',
    error: {
      validating: 'Some responses need attention. Please review and try again.',
      securing:   'Failed to secure your response. Please try again.',
      uploading:  'Submission failed. Please check your connection and try again.',
    },
  },
} as const;

export type UxCopy = typeof uxCopy;

/** Stage keys for the save loading flow. */
export type SaveLoadingStage = keyof typeof uxCopy.save.loading;

/** Stage keys for the save error flow. */
export type SaveErrorStage = keyof typeof uxCopy.save.error;

/** Stage keys for the submit loading flow. */
export type SubmitLoadingStage = keyof typeof uxCopy.submit.loading;

/** Stage keys for the submit error flow. */
export type SubmitErrorStage = keyof typeof uxCopy.submit.error;
