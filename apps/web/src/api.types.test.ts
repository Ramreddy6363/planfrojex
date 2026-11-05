import { expect, it } from 'vitest'
import { api } from './api'

// Never called: `pnpm typecheck` fails if the client stops rejecting a wrong path or body.
function typedClientChecks() {
  // @ts-expect-error unknown path
  api.nope.$get()
  // @ts-expect-error wrong body field
  api.invites.accept.$post({ json: { tokn: 'x' } })
  // @ts-expect-error role must be editor or viewer
  api.workspaces[':ws'].invites.$post({ param: { ws: 'a' }, json: { emails: [], role: 'owner' } })
}
it.skip('typed client rejects bad calls at compile time', typedClientChecks)
it('has typed workspace endpoints', () => {
  expect(typeof api.me.$get).toBe('function')
})
