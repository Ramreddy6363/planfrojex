import { createRoute } from '@tanstack/react-router'
import { AuthForm } from '../auth-form'
import { rootRoute } from './root'

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: () => <AuthForm mode="sign-in" />,
})
