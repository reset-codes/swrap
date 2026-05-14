// POC app — API surface barrel.
// Note: health, forms, submissions, and metadata all export GET/POST; import
// directly from each module when you need a specific handler. This barrel
// re-exports only the non-conflicting named exports.
export { GET as healthGET } from './health';
export type { HealthResponse } from './health';
export { POST as formsPost, GET as formsGet } from './forms';
export { POST as submissionsPost, GET as submissionsGet } from './submissions';
export { GET as metadataGet } from './metadata';
