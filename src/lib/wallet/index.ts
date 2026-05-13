/**
 * Infrastructure Wallet Manager — public API surface.
 *
 * Re-exports all types and manager functions so consumers can import from
 * a single path:
 *
 *   import { executeWalrusWrite, executeSealDecrypt, WalletError } from '@/lib/wallet'
 *
 * SECURITY: Never import or re-export the raw private key value. Use
 * getAdminDecryptKey() only within the service layer, never in API routes.
 */

export type { WalletConfig, SealOperation, SealResult, SealOperationType } from './types'

export { WalletError } from './types'

export {
  getInfraWalletKey,
  getAdminDecryptKey,
  executeWalrusWrite,
  executeWalrusRead,
  executeSealEncrypt,
  executeSealDecrypt,
  executeSealCreatePolicy,
} from './manager'
