import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

// Any Drizzle Postgres driver fits, so dev and tests inject node-postgres (src/dev/local.ts).
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
export type DatabaseFactory = (url: string) => Db

// Pool (WebSocket) rather than neon-http: only it supports interactive transactions.
// ponytail: one pool per request, never ended; Workers drops the socket when the request ends.
export const connect: DatabaseFactory = (url) =>
  drizzle(new Pool({ connectionString: url }), { schema })
