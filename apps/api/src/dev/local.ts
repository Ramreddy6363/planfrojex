import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { DatabaseFactory } from '../db'
import * as schema from '../db/schema'

// Dev and tests only: a plain TCP PostgreSQL (the local Docker database). Never imported by the Worker.
export const connectLocal: DatabaseFactory = (url) =>
  drizzle(new Pool({ connectionString: url }), { schema })
