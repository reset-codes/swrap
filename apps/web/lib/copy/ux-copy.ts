/**
 * ux-copy.ts — UX vocabulary mapping module
 *
 * This is the ONLY place internal state names cross into user-visible UI strings.
 * All components that display upload progress, privacy mode labels, or auth entity
 * references MUST import from this module rather than hardcoding strings.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.6, 8.8
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Upload_State_Machine states as defined in the design.
 * Requirements: 6.1
 */
export type UploadState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

// ---------------------------------------------------------------------------
// Upload phase labels
// ---------------------------------------------------------------------------

/**
 * Maps an Upload_State_Machine state to a human-readable progress phrase.
 *
 * This is the authoritative mapping between internal state names and the
 * UX_Vocabulary phrases shown in upload progress UI. No component should
 * hardcode these strings — always call this function.
 *
 * Requirements: 6.12, 8.8
 *
 * @param state - The current Upload_State_Machine state
 * @returns A human-readable phrase suitable for display in progress UI
 */
export function uploadPhase(state: UploadState): string {
  switch (state) {
    case 'pending':
      return 'Preparing';
    case 'encrypting':
      return 'Securing';
    case 'uploading':
      return 'Uploading';
    case 'uploaded':
      return 'Saving';
    case 'indexed':
      return 'Saved';
    case 'failed':
      return "Couldn't save — retry";
  }
}

// ---------------------------------------------------------------------------
// Privacy mode labels
// ---------------------------------------------------------------------------

/**
 * Maps a form privacy mode to its UX_Vocabulary label.
 *
 * Uses "Shared" for public forms and "Private" for private forms,
 * hiding the internal `public`/`private` terminology from users.
 *
 * Requirements: 8.2, 4.1
 *
 * @param mode - The form's privacy mode
 * @returns The UX_Vocabulary label for the privacy mode
 */
export function privacyModeLabel(mode: 'public' | 'private'): string {
  switch (mode) {
    case 'public':
      return 'Shared';
    case 'private':
      return 'Private';
  }
}

// ---------------------------------------------------------------------------
// Auth entity label
// ---------------------------------------------------------------------------

/**
 * Returns the plain-language label for the active authentication entity.
 *
 * ZK Login users and external wallet users are both referred to as
 * "your account" in primary flows, hiding wallet/signer terminology.
 *
 * Requirements: 8.4, 8.6
 *
 * @returns The plain-language label for the auth entity
 */
export function authEntityLabel(): 'your account' {
  return 'your account';
}
