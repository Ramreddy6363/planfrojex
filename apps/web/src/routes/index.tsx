import { createRoute } from '@tanstack/react-router'
import { LandingPage } from '../landing'
import { enterApp, getMe } from '../session'
import { rootRoute } from './root'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    try {
      await getMe()
    } catch {
      return
    }
    await enterApp()
  },
  component: LandingPage,
})
