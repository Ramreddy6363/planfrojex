import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import { Loading } from './layouts'
import { indexRoute } from './routes'
import { acceptInviteRoute } from './routes/accept-invite'
import { accountSettingsRoute } from './routes/account-settings'
import { authCallbackRoute } from './routes/auth-callback'
import { createWorkspaceRoute } from './routes/create-workspace'
import { inboxRoute } from './routes/inbox'
import { inviteRoute } from './routes/invite'
import { LoadError } from './routes/load-error'
import { membersRoute } from './routes/members'
import { myTasksRoute } from './routes/my-tasks'
import { NotFound } from './routes/not-found'
import { onboardingRoute } from './routes/onboarding'
import { projectActivityRoute } from './routes/project-activity'
import { projectBriefRoute } from './routes/project-brief'
import { projectDiagramsRoute } from './routes/project-diagrams'
import { projectPlanRoute } from './routes/project-plan'
import { projectTasksRoute } from './routes/project-tasks'
import { projectsRoute } from './routes/projects'
import { publicShareRoute } from './routes/public-share'
import { rootRoute } from './routes/root'
import { signInRoute } from './routes/sign-in'
import { signUpRoute } from './routes/sign-up'
import { verifyRoute } from './routes/verify'
import { workspaceRoute } from './routes/workspace'
import { workspaceSettingsRoute } from './routes/workspace-settings'
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
    publicShareRoute,
    workspaceRoute,
    workspaceSettingsRoute,
    accountSettingsRoute,
    membersRoute,
    myTasksRoute,
    inboxRoute,
    projectsRoute,
    projectBriefRoute,
    projectPlanRoute,
    projectTasksRoute,
    projectDiagramsRoute,
    projectActivityRoute,
  ]),
  defaultPendingComponent: Loading,
  // App-level fallbacks: an unknown path, or a crash in any route without its own error screen.
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: LoadError,
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
)
