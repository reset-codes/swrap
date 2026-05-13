'use client';

import { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { signIn } from 'next-auth/react';
import { firebaseAuth } from './config';

const googleProvider = new GoogleAuthProvider();

/**
 * Hook that handles Firebase Google sign-in and bridges the result
 * to NextAuth by passing the Firebase ID token as credentials.
 */
export function useFirebaseAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle(callbackUrl?: string) {
    setLoading(true);
    setError(null);

    try {
      // 1. Sign in with Firebase (Google popup)
      const result = await signInWithPopup(firebaseAuth, googleProvider);

      // 2. Get the Firebase ID token
      const idToken = await result.user.getIdToken();

      // 3. Pass the ID token to NextAuth credentials provider
      // With redirect: true, this will navigate the browser on success.
      // On failure, it redirects to the error page.
      await signIn('firebase', {
        idToken,
        redirect: true,
        callbackUrl: callbackUrl ?? '/dashboard',
      });
    } catch (err: unknown) {
      // Handle Firebase popup errors
      const firebaseError = err as { code?: string; message?: string };
      if (firebaseError.code === 'auth/popup-closed-by-user') {
        // User closed the popup — not an error to display
        setError(null);
      } else if (firebaseError.code === 'auth/popup-blocked') {
        setError('Popup was blocked. Please allow popups for this site.');
      } else {
        setError('An error occurred during sign-in. Please try again.');
        console.error('[firebase] sign-in error:', firebaseError);
      }
    } finally {
      setLoading(false);
    }
  }

  return { signInWithGoogle, loading, error };
}
