import type { Hono } from 'hono'
import { outbox } from './email'
import type { Env } from './env'

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function mountDevOutbox<T extends Hono<Env>>(app: T): T {
  app.get('/__dev/outbox', (c) => {
    const hostname = new URL(c.req.url).hostname
    if (!localHosts.has(hostname)) return c.json({ error: 'Not found' }, 404)
    return c.json({ messages: outbox })
  })
  return app
}
