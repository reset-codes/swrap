const fs = require('fs');

// Fix apps/api/health.ts
let health = fs.readFileSync('apps/api/health.ts', 'utf8');
health = health.replace("import { detectLocalSigner } from '@poc/sui';\nimport { createWalrusClient } from '@poc/walrus';\nimport { createSuiClient, getBalance } from '@poc/sui';", "import { detectLocalSigner, createSuiClient, getBalance } from '@poc/sui';\nimport { createWalrusClient } from '@poc/walrus';");
fs.writeFileSync('apps/api/health.ts', health);

// Fix apps/api/error-envelope.ts
let errEnv = fs.readFileSync('apps/api/error-envelope.ts', 'utf8');
errEnv = errEnv.replace("import { SignerDetectorError } from '@poc/sui';\nimport { SuiClientError } from '@poc/sui';", "import { SignerDetectorError, SuiClientError } from '@poc/sui';");
fs.writeFileSync('apps/api/error-envelope.ts', errEnv);

// Fix packages/walrus/src/client.ts
let walrusClient = fs.readFileSync('packages/walrus/src/client.ts', 'utf8');
walrusClient = walrusClient.replace("type PublisherResponse = NewlyCreatedResponse | AlreadyCertifiedResponse;", "// type PublisherResponse = NewlyCreatedResponse | AlreadyCertifiedResponse;");
fs.writeFileSync('packages/walrus/src/client.ts', walrusClient);
