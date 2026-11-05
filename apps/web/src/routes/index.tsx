import { createRoute } from '@tanstack/react-router'
import { enterApp } from '../session'
import { rootRoute } from './root'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: enterApp,
})
