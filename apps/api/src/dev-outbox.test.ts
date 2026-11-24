import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, expect, it } from 'vitest'
import { mountDevOutbox } from './dev-outbox'
import { outbox } from './email'
import type { Env } from './env'

const app = mountDevOutbox(new OpenAPIHono<Env>())

afterEach(() => {
  outbox.length = 0
})

it('lets localhost retrieve development email links and codes', async () => {
  outbox.push({ to: 'reviewer@example.com', subject: 'Review', text: 'Open /share/secret-token' })
  const response = await app.request('http://localhost/__dev/outbox')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    messages: [{ to: 'reviewer@example.com', subject: 'Review', text: 'Open /share/secret-token' }],
  })
})

it('does not expose the development outbox for non-local hosts', async () => {
  const response = await app.request('http://example.com/__dev/outbox')
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })
})
