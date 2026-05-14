import { SuiGrpcClient } from '@mysten/sui/grpc';

/**
 * Create the Sui client shape expected by @mysten/seal.
 *
 * The Seal SDK calls the newer core client API (`client.core.getObject`) during
 * encryption/decryption, so the legacy JSON-RPC wrapper used elsewhere in the
 * POC is not sufficient here.
 */
export function createSealSuiClient(rpcUrl: string): SuiGrpcClient {
  return new SuiGrpcClient({
    network: 'testnet',
    baseUrl: rpcUrl,
  });
}
