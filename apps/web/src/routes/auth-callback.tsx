import { createRoute } from '@tanstack/react-router'
import { auth } from '../auth-client'
import { enterApp } from '../session'
import { rootRoute } from './root'

export const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  beforeLoad: async () => {
    const session = await auth.getSession()
    if (session.data?.user.name) sessionStorage.setItem('displayName', session.data.user.name)
    return enterApp()
  },
})
