import { NextResponse } from 'next/server';

type DependencyState = 'configured' | 'missing';

interface HealthResponse {
  ok: boolean;
  service: 'swrap-api';
  dependencies: {
    database: DependencyState;
    walrusAggregator: DependencyState;
    walrusPublisher: DependencyState;
    suiRpc: DependencyState;
    sealPackage: DependencyState;
    infraWallet: DependencyState;
  };
}

function state(value: string | undefined): DependencyState {
  return value && value.trim() !== '' ? 'configured' : 'missing';
}

export async function GET() {
  const dependencies: HealthResponse['dependencies'] = {
    database: state(process.env.DATABASE_URL),
    walrusAggregator: state(process.env.WALRUS_AGGREGATOR_URL),
    walrusPublisher: state(process.env.WALRUS_PUBLISHER_URL),
    suiRpc: state(process.env.SUI_RPC_URL),
    sealPackage: state(process.env.SUI_POC_PACKAGE_ID),
    infraWallet: state(process.env.INFRA_WALLET_PRIVATE_KEY),
  };

  const ok = Object.values(dependencies).every((value) => value === 'configured');

  return NextResponse.json(
    {
      ok,
      service: 'swrap-api',
      dependencies,
    } satisfies HealthResponse,
    { status: ok ? 200 : 503 },
  );
}
