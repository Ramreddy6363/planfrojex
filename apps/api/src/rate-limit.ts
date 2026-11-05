import { sql } from 'drizzle-orm'
import type { Db } from './db'
import { rateLimit } from './db/schema'

export async function consumeRateLimit(
  db: Db,
  scope: string,
  subject: string,
  amount: number,
  limit: number,
  windowMs: number,
) {
  if (amount < 1 || amount > limit) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject))
  const key = `planfrojex:${scope}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const now = Date.now()
  const stale = sql`${rateLimit.lastRequest} <= ${now - windowMs}`
  const rows = await db
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, count: amount, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`CASE WHEN ${stale} THEN ${amount} ELSE ${rateLimit.count} + ${amount} END`,
        lastRequest: sql`CASE WHEN ${stale} THEN ${now} ELSE ${rateLimit.lastRequest} END`,
      },
      setWhere: sql`${stale} OR ${rateLimit.count} + ${amount} <= ${limit}`,
    })
    .returning({ count: rateLimit.count })
  return rows.length > 0
}
