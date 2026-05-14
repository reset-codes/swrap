/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
 *
 * Implements the canonicalization algorithm per RFC 8785 §3:
 * - Object keys sorted lexicographically (Unicode code point order)
 * - Numbers: no NaN, no Infinity; integers and floats use JSON.stringify representation
 * - Strings: standard JSON escaping
 * - Arrays: elements in order
 * - null, true, false: as-is
 * - Rejected: undefined, functions, symbols, NaN, ±Infinity, bigint
 *
 * Requirements: R9.1, R9.2
 */

/**
 * Serialize a value to a canonicalized JSON string per RFC 8785.
 * Throws if the value contains unsupported types (undefined, function, symbol,
 * bigint, NaN, or ±Infinity).
 */
export function canonicalizeToString(value: unknown): string {
  return serialize(value);
}

/**
 * Serialize a value to canonicalized JSON bytes (UTF-8 encoded) per RFC 8785.
 * Throws if the value contains unsupported types.
 */
export function canonicalize(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeToString(value));
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new Error(
        `NaN and Infinity are not allowed in RFC 8785 JCS (got ${value})`,
      );
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'bigint') {
    throw new Error('bigint is not allowed in RFC 8785 JCS');
  }

  if (typeof value === 'undefined') {
    throw new Error('undefined is not allowed in RFC 8785 JCS');
  }

  if (typeof value === 'function') {
    throw new Error('functions are not allowed in RFC 8785 JCS');
  }

  if (typeof value === 'symbol') {
    throw new Error('symbols are not allowed in RFC 8785 JCS');
  }

  if (Array.isArray(value)) {
    return '[' + value.map(serialize).join(',') + ']';
  }

  if (typeof value === 'object') {
    // Sort keys by Unicode code point order (lexicographic on UTF-16 code units,
    // which matches RFC 8785 §3.2.3 for the BMP; full Unicode sort would require
    // localeCompare with 'unicode' sensitivity, but RFC 8785 specifies UCS-2/UTF-16
    // code unit ordering which is what JS default sort provides).
    const keys = Object.keys(value as object).sort();
    const pairs = keys.map(
      (k) =>
        JSON.stringify(k) +
        ':' +
        serialize((value as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }

  throw new Error(`Unsupported type: ${typeof value}`);
}
