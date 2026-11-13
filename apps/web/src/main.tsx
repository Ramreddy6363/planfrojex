import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import { Loading } from './layouts'
import { indexRoute } from './routes'
import { acceptInviteRoute } from './routes/accept-invite'
import { authCallbackRoute } from './routes/auth-callback'
import { createWorkspaceRoute } from './routes/create-workspace'
import { inviteRoute } from './routes/invite'
import { membersRoute } from './routes/members'
import { onboardingRoute } from './routes/onboarding'
import { projectBriefRoute } from './routes/project-brief'
import { projectTasksRoute } from './routes/project-tasks'
import { projectsRoute } from './routes/projects'
import { rootRoute } from './routes/root'
import { signInRoute } from './routes/sign-in'
import { signUpRoute } from './routes/sign-up'
import { verifyRoute } from './routes/verify'
import { workspaceRoute } from './routes/workspace'
import { queryClient } from './session'
import './styles.css'

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    signInRoute,
    signUpRoute,
    verifyRoute,
    authCallbackRoute,
    onboardingRoute,
    createWorkspaceRoute,
    inviteRoute,
    acceptInviteRoute,
    workspaceRoute,
    membersRoute,
    projectsRoute,
    projectBriefRoute,
    projectTasksRoute,
  ]),
  defaultPendingComponent: Loading,
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
)
