/**
 * Verify a Firebase ID token without the full Admin SDK.
 * Uses Firebase's public keys endpoint to validate the JWT signature.
 * This avoids needing a service account key for token verification.
 */

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'sealbase-xyz';
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface DecodedToken {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

// Cache for Google's public certificates
let cachedCerts: Record<string, string> | null = null;
let certsExpiry = 0;

async function getGoogleCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now < certsExpiry) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google certs: ${res.status}`);
  }

  // Parse cache-control header for expiry
  const cacheControl = res.headers.get('cache-control');
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) * 1000 : 3600000;

  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpiry = now + maxAge;

  return cachedCerts;
}

function base64UrlDecode(str: string): string {
  // Add padding
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Verify a Firebase ID token and return the decoded payload.
 * Validates: issuer, audience, expiry, and signature via Google's public certs.
 */
export async function verifyFirebaseToken(idToken: string): Promise<DecodedToken | null> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    // Validate claims
    const now = Math.floor(Date.now() / 1000);

    // Check expiry
    if (!payload.exp || payload.exp < now) {
      console.error('[firebase] Token expired');
      return null;
    }

    // Check issued-at (not in the future, with 5 min tolerance)
    if (!payload.iat || payload.iat > now + 300) {
      console.error('[firebase] Token iat is in the future');
      return null;
    }

    // Check audience
    if (payload.aud !== FIREBASE_PROJECT_ID) {
      console.error('[firebase] Token audience mismatch:', payload.aud);
      return null;
    }

    // Check issuer
    const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
    if (payload.iss !== expectedIssuer) {
      console.error('[firebase] Token issuer mismatch:', payload.iss);
      return null;
    }

    // Check subject (uid) exists
    if (!payload.sub || typeof payload.sub !== 'string') {
      console.error('[firebase] Token missing sub claim');
      return null;
    }

    // Verify signature using Google's public certs
    const certs = await getGoogleCerts();
    const kid = header.kid;
    if (!kid || !certs[kid]) {
      console.error('[firebase] Token kid not found in Google certs');
      return null;
    }

    // Use Node.js crypto to verify the RS256 signature
    const crypto = await import('crypto');
    const cert = certs[kid];
    const signatureInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(
      parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[2].length % 4)) % 4),
      'base64',
    );

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signatureInput);
    const isValid = verifier.verify(cert, signature);

    if (!isValid) {
      console.error('[firebase] Token signature verification failed');
      return null;
    }

    return {
      uid: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      email_verified: payload.email_verified,
    };
  } catch (error) {
    console.error('[firebase] Token verification error:', error);
    return null;
  }
}
