/**
 * src/lib/walrus/cli-publisher.ts
 *
 * Thin wrapper that re-exports the Walrus CLI publisher from apps/api/services.
 * This allows FormService (src/services/FormService.ts) to call the CLI fallback
 * without a circular dependency.
 *
 * In Vercel serverless functions, the CLI fallback is a no-op because there is
 * no `walrus` binary in the serverless environment. It will throw, and the caller
 * will surface the original HTTP error. This is correct behavior — the CLI fallback
 * is only effective on the VPS.
 *
 * For the VPS path (apps/api services), use apps/api/services/walrus-cli-publisher.ts
 * directly.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export class WalrusCliPublishError extends Error {
  readonly code = 'WALRUS_CLI_PUBLISH_FAILED' as const;

  constructor(reason: string, public readonly detail?: string) {
    super(`Walrus CLI publish failed: ${reason}`);
    this.name = 'WalrusCliPublishError';
  }
}

function parseBlobId(stdout: string): string {
  const trimmed = stdout.trim();
  const jsonLines = trimmed.split('\n').filter((l) => l.trimStart().startsWith('{'));
  for (let i = jsonLines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(jsonLines[i]) as Record<string, unknown>;
      const newlyCreated = parsed['newlyCreated'] as { blobObject?: { blobId?: string } } | undefined;
      if (newlyCreated?.blobObject?.blobId) return newlyCreated.blobObject.blobId;
      const alreadyCertified = parsed['alreadyCertified'] as { blobId?: string } | undefined;
      if (alreadyCertified?.blobId) return alreadyCertified.blobId;
      if (typeof parsed['blobId'] === 'string' && parsed['blobId']) return parsed['blobId'];
    } catch { /* continue */ }
  }
  const match = stdout.match(/["']?blobId["']?\s*:\s*["']?([A-Za-z0-9+/=_-]{30,})["']?/);
  if (match?.[1]) return match[1];
  throw new WalrusCliPublishError(
    'Could not parse blob ID from CLI output',
    `stdout: ${stdout.slice(0, 500)}`,
  );
}

/**
 * Publish `data` to Walrus using the `walrus store` CLI command.
 *
 * Only effective when the `walrus` binary is installed on the host
 * (VPS deployments). In serverless (Vercel) environments this will fail
 * immediately — callers should treat that failure as "CLI not available"
 * and surface the original HTTP error to the user.
 */
export async function publishViaWalrusCli(
  data: Buffer | string,
  _contentType = 'application/octet-stream',
): Promise<{ blobId: string }> {
  const cliPath = process.env.WALRUS_CLI_PATH ?? 'walrus';
  const configPath = process.env.WALRUS_CONFIG_PATH;
  const epochs = process.env.WALRUS_EPOCHS ?? '1';

  const tmpFile = join(tmpdir(), `walrus-publish-${randomUUID()}.bin`);
  try {
    const content = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    await writeFile(tmpFile, content, { mode: 0o600 });

    const args: string[] = ['store'];
    if (configPath) args.push('--config', configPath);
    args.push('--epochs', epochs, '--json', tmpFile);

    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileAsync(cliPath, args, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
    } catch (execErr) {
      const err = execErr as { stdout?: string; stderr?: string; code?: number | string };
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
      throw new WalrusCliPublishError(
        'CLI process exited with non-zero status',
        `exit code: ${err.code ?? 'unknown'}, stderr: ${stderr.slice(0, 300)}`,
      );
    }

    if (stderr.trim()) {
      console.warn('[WalrusCliPublisher] CLI stderr:', stderr.slice(0, 500));
    }

    const blobId = parseBlobId(stdout);
    if (!blobId || blobId.length < 10 || /[\s\x00-\x1f]/.test(blobId)) {
      throw new WalrusCliPublishError(`Invalid blob ID returned: "${blobId}"`);
    }

    return { blobId };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
