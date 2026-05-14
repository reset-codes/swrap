// @poc/seal package barrel.
export {
  encode,
  decode,
  looksLikeEncryptedBlob,
  ParseError,
  HEADER_SIZE,
  VERSION,
  SCHEME_ID,
} from './encrypted-blob';
export type { EncryptedBlob, EncryptedBlobHeader, BlobType } from './encrypted-blob';

export { encrypt } from './encryptor';
export { decrypt, SealAuthError, SealParseError } from './decryptor';
