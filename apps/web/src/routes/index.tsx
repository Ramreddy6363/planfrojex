import { createRoute } from '@tanstack/react-router'
import { RequestError } from '../api'
import { LandingPage } from '../landing'
import { enterApp, getMe } from '../session'
import { rootRoute } from './root'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    try {
      await getMe()
    } catch (error) {
      // Only "not signed in" shows the landing page; network and server failures show the error state.
      if (error instanceof RequestError && error.status === 401) return
      throw error
    }
    await enterApp()
  },
  component: LandingPage,
})
