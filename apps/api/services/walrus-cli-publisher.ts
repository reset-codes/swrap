/**
 * apps/api/services/walrus-cli-publisher.ts
 *
 * CLI-based Walrus blob publisher — hard fallback for when the HTTP publisher
 * endpoint is unavailable or returns an error.
 *
 * This module shells out to the `walrus` CLI binary installed on the VPS,
 * which uses the locally-configured keypair from ~/.config/walrus/client_config.yaml
 * (or the path in WALRUS_CONFIG_PATH).
 *
 * USAGE PATTERN
 * ─────────────
 * Call `publishViaWalusCli(data, contentType)` as a fallback inside a try/catch
 * that wraps the primary HTTP publisher path. If the CLI path also fails, the
 * error is surfaced to the caller — never silently swallowed.
 *
 * SECURITY
 * ────────
 * - The tmp file is written to the OS tmp directory with mode 0o600.
 * - It is deleted immediately after the CLI invocation regardless of success/failure.
 * - No plaintext data is logged.
 * - The blob ID parsed from stdout is validated before being returned.
 *
 * ENVIRONMENT
 * ───────────
 * WALRUS_CLI_PATH       — absolute path to the walrus binary (default: 'walrus')
 * WALRUS_CONFIG_PATH    — path to walrus client config yaml (optional)
 * WALRUS_EPOCHS         — number of storage epochs (default: '1')
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class WalrusCliPublishError extends Error {
  readonly code = 'WALRUS_CLI_PUBLISH_FAILED' as const;

  constructor(reason: string, public readonly detail?: string) {
    super(`Walrus CLI publish failed: ${reason}`);
    this.name = 'WalrusCliPublishError';
  }
}

// ---------------------------------------------------------------------------
// Blob ID extraction
// ---------------------------------------------------------------------------

/**
 * Parse the Walrus blob ID from `walrus store` stdout.
 *
 * The CLI emits a JSON object to stdout. We look for the blobId field
 * in either the `newlyCreated.blobObject.blobId` or `alreadyCertified.blobId`
 * paths (mirrors the HTTP publisher response shape).
 *
 * Falls back to a simple regex scan over the raw stdout if JSON parsing fails.
 */
function parseBlobId(stdout: string): string {
  // Try structured JSON first
  // walrus store --json outputs a single JSON object on stdout
  const trimmed = stdout.trim();

  // The CLI may emit logs before the JSON — find the last line that starts with '{'
  const jsonLines = trimmed.split('\n').filter((l) => l.trimStart().startsWith('{'));
  for (let i = jsonLines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(jsonLines[i]) as Record<string, unknown>;

      // newlyCreated path
      const newlyCreated = parsed['newlyCreated'] as { blobObject?: { blobId?: string } } | undefined;
      if (newlyCreated?.blobObject?.blobId) {
        return newlyCreated.blobObject.blobId;
      }

      // alreadyCertified path
      const alreadyCertified = parsed['alreadyCertified'] as { blobId?: string } | undefined;
      if (alreadyCertified?.blobId) {
        return alreadyCertified.blobId;
      }

      // Flat blobId field (some CLI versions)
      if (typeof parsed['blobId'] === 'string' && parsed['blobId']) {
        return parsed['blobId'];
      }
    } catch {
      // Not valid JSON — continue
    }
  }

  // Fallback: regex scan for a blobId-looking value (base58 alphanumeric, 40+ chars)
  const match = stdout.match(/["']?blobId["']?\s*:\s*["']?([A-Za-z0-9+/=_-]{30,})["']?/);
  if (match?.[1]) return match[1];

  throw new WalrusCliPublishError(
    'Could not parse blob ID from CLI output',
    `stdout: ${stdout.slice(0, 500)}`,
  );
}

// ---------------------------------------------------------------------------
// Validate that the extracted blob ID looks reasonable
// ---------------------------------------------------------------------------

function validateBlobId(blobId: string): void {
  if (!blobId || typeof blobId !== 'string') {
    throw new WalrusCliPublishError('Blob ID is empty or not a string');
  }
  if (blobId.length < 10) {
    throw new WalrusCliPublishError(`Blob ID too short to be valid: "${blobId}"`);
  }
  // Must not contain spaces or control characters
  if (/[\s\x00-\x1f]/.test(blobId)) {
    throw new WalrusCliPublishError(`Blob ID contains invalid characters: "${blobId}"`);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Publish `data` to Walrus using the `walrus store` CLI command.
 *
 * Writes `data` to a temporary file, invokes the CLI, parses the blob ID
 * from stdout, and cleans up the temp file.
 *
 * @param data         The content to publish (Buffer or string).
 * @param _contentType MIME type hint (unused by CLI path but kept for API symmetry).
 * @returns            The Walrus blob ID of the published content.
 * @throws             WalrusCliPublishError if the CLI is unavailable or publish fails.
 */
export async function publishViaWalrusCli(
  data: Buffer | string,
  _contentType = 'application/octet-stream',
): Promise<{ blobId: string }> {
  const cliPath = process.env.WALRUS_CLI_PATH ?? 'walrus';
  const configPath = process.env.WALRUS_CONFIG_PATH;
  const epochs = process.env.WALRUS_EPOCHS ?? '1';

  // Write content to a temp file with restrictive permissions
  const tmpFile = join(tmpdir(), `walrus-publish-${randomUUID()}.bin`);

  try {
    const content = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    await writeFile(tmpFile, content, { mode: 0o600 });

    // Build CLI args
    // walrus store [--config <path>] --epochs <n> --json <file>
    const args: string[] = ['store'];
    if (configPath) {
      args.push('--config', configPath);
    }
    args.push('--epochs', epochs, '--json', tmpFile);

    let stdout = '';
    let stderr = '';

    try {
      const result = await execFileAsync(cliPath, args, {
        timeout: 120_000,     // 2 minutes — Walrus writes can be slow on testnet
        maxBuffer: 10 * 1024 * 1024, // 10 MB output buffer
      });
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
    } catch (execErr) {
      const err = execErr as { stdout?: string; stderr?: string; message?: string; code?: number | string };
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
      const detail = `exit code: ${err.code ?? 'unknown'}, stderr: ${(stderr).slice(0, 300)}`;
      throw new WalrusCliPublishError(
        'CLI process exited with non-zero status',
        detail,
      );
    }

    // Log stderr at debug level (never logs data content)
    if (stderr.trim()) {
      console.warn('[WalrusCliPublisher] CLI stderr:', stderr.slice(0, 500));
    }

    const blobId = parseBlobId(stdout);
    validateBlobId(blobId);

    return { blobId };
  } finally {
    // Always clean up the temp file — non-fatal if deletion fails
    await unlink(tmpFile).catch((e) => {
      console.warn('[WalrusCliPublisher] Failed to delete temp file:', e.message);
    });
  }
}

/**
 * Check whether the Walrus CLI is available on this system.
 * Returns true if the binary is found and responds to --version.
 * Used to gate CLI fallback availability at startup.
 */
export async function isWalrusCliAvailable(): Promise<boolean> {
  const cliPath = process.env.WALRUS_CLI_PATH ?? 'walrus';
  try {
    await execFileAsync(cliPath, ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
