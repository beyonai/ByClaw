/**
 * Client-namespace projection of the devflow domain: a pure re-export of the
 * package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @zhchxiao123/dsh-devflow/client
 */

export type * from './types.ts'
