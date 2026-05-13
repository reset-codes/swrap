import { initializeApp, getApps, cert, getApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

// Firebase Admin SDK — used server-side to verify ID tokens.
// Requires FIREBASE_SERVICE_ACCOUNT_KEY env var (JSON string of the service account key)
// OR GOOGLE_APPLICATION_CREDENTIALS pointing to the key file.

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  // Option 1: Service account key as JSON string in env var
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    const serviceAccount = JSON.parse(serviceAccountKey);
    return initializeApp({
      credential: cert(serviceAccount),
    });
  }

  // Option 2: GOOGLE_APPLICATION_CREDENTIALS env var (auto-detected by SDK)
  return initializeApp();
}

const adminApp = getAdminApp();
const adminAuth: Auth = getAuth(adminApp);

export { adminApp, adminAuth };
