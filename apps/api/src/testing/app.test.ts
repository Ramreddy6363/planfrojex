import { describe, expect, it } from 'vitest'
import { outbox } from '../email'
import { testApp } from './app'

describe.runIf(Boolean(process.env.PLANFROJEX_TEST_CONTAINERS))(
  'authenticated test application',
  () => {
    it('signs in and uses the session to create and read a workspace', async () => {
      const test = await testApp()
      try {
        const headers = await test.signIn('owner@example.com')
        const created = await test.request('/workspaces', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Northwind', slug: 'northwind', isPersonal: false }),
        })
        expect(created.status).toBe(201)
        expect((await test.request('/workspaces/northwind', { headers })).status).toBe(200)
        const invite = await test.request('/workspaces/northwind/invites', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ emails: ['Invitee@Example.com'], role: 'viewer' }),
        })
        expect(invite.status).toBe(201)
        const mail = outbox.find((message) => message.to === 'invitee@example.com')
        const token = mail?.text.match(/\/invite\/([0-9a-f]{64})/)?.[1]
        expect(token).toBeTruthy()
        const stranger = await test.signIn('stranger@example.com')
        expect((await test.request('/workspaces/northwind', { headers: stranger })).status).toBe(
          404,
        )
        const accept = (cookie: Record<string, string>) =>
          test.request('/invites/accept', {
            method: 'POST',
            headers: { ...cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
          })
        expect((await accept(stranger)).status).toBe(400)
        const invitee = await test.signIn('invitee@example.com')
        expect((await accept(invitee)).status).toBe(200)
        expect((await accept(invitee)).status).toBe(400)
        expect((await test.request('/workspaces/northwind', { headers: invitee })).status).toBe(200)
      } finally {
        await test.stop()
      }
    }, 120000)
  },
)
