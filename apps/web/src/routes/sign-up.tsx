import { createRoute } from '@tanstack/react-router'
import { AuthForm } from '../auth-form'
import { rootRoute } from './root'

export const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  component: () => <AuthForm mode="sign-up" />,
})
