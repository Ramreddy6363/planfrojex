import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { apiBase } from './api-base'

export const auth = createAuthClient({
  baseURL: apiBase(),
  fetchOptions: { credentials: 'include' },
  plugins: [emailOTPClient()],
})
