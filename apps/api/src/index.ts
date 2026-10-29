import { OpenAPIHono } from '@hono/zod-openapi'
import type { Env } from './env'

const app = new OpenAPIHono<Env>().get('/health', (c) => c.json({ ok: true }))

export type AppType = typeof app
export default app
