import { vi } from 'vitest';

// Set up default POC environment for tests
process.env.DEV_BYPASS_STORAGE = 'true';
process.env.DEV_LOCAL_SIGNER = 'true';
process.env.DEV_ALLOW_PLAINTEXT = 'false';
process.env.USE_WALRUS_TESTNET = 'true';
process.env.USE_SUI_TESTNET = 'true';
process.env.SUI_POC_PACKAGE_ID = '0x9b9972cd09e905eeb0ac627a4f99294c736f5dc71a743fac5cf254b6dd5e1138';
process.env.WALRUS_PUBLISHER_URL = 'https://publisher.walrus-testnet.walrus.space';
process.env.WALRUS_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space';
process.env.SUI_RPC_URL = 'https://fullnode.testnet.sui.io:443';
process.env.AUTH_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
process.env.INFRA_WALLET_PRIVATE_KEY = 'suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'; 
