// POC app — API surface barrel.
// Note: health and forms both export GET/POST; import directly from each
// module when you need a specific handler. This barrel re-exports only the
// non-conflicting named exports.
export { GET as healthGET } from './health';
export type { HealthResponse } from './health';
export { POST as formsPost, GET as formsGet } from './forms';
