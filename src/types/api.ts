/**
 * Standard API response shapes for all Swrap API routes.
 * All API responses must conform to one of these two shapes.
 * See: ENGINEERING_RULES.md Rule 9
 */

/** Successful API response */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Error API response */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/** Union type for all API responses */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Helper to create a success response */
export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

/** Helper to create an error response */
export function apiError(code: string, message: string): ApiError {
  return { success: false, error: { code, message } };
}

// ─── Common Error Codes ───────────────────────────────────────────────────────

/** Standard error codes used across all Swrap API routes */
export const API_ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  WALRUS_ERROR: 'WALRUS_ERROR',
  SEAL_ERROR: 'SEAL_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
