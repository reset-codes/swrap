/**
 * Metadata query handler for the POC.
 *
 * GET /api/poc/metadata/[address]
 *   - Calls queryMetadataRecords from @poc/sui for the given address
 *   - Returns { records, address }
 *
 * Requirements: R13.3
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadPocEnv } from '@poc/shared';
import { createSuiClient, queryMetadataRecords } from '@poc/sui';
import { toErrorResponse } from './error-envelope';

// ---------------------------------------------------------------------------
// GET handler — query metadata records for an address
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  // 1. Load env
  let env: ReturnType<typeof loadPocEnv>;
  try {
    env = loadPocEnv();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 2. Get address from params
  const { address } = await context.params;

  if (!address) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_ADDRESS',
          stage: 'validate',
          message: 'address is required',
        },
      },
      { status: 400 },
    );
  }

  // 3. Query metadata records from Sui
  try {
    const client = createSuiClient(env.SUI_RPC_URL);
    const records = await queryMetadataRecords(
      client,
      env.SUI_POC_PACKAGE_ID ?? '',
      address,
    );
    return NextResponse.json({ records, address }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
