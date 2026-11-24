import type {
  AppType,
  IntegrationRoutes,
  ProjectDriftRoutes,
  ProjectTaskRoutes,
  TaskRoutes,
} from '@planfrojex/api'
import {
  type ClientResponse,
  DetailedError,
  hc,
  type InferRequestType,
  type InferResponseType,
  parseResponse,
} from 'hono/client'

export const api = hc<AppType>(import.meta.env.VITE_API_URL ?? 'http://localhost:8787', {
  init: { credentials: 'include' },
})
const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
export const projectTasksApi = hc<ProjectTaskRoutes>(apiBase, { init: { credentials: 'include' } })
export const tasksApi = hc<TaskRoutes>(apiBase, { init: { credentials: 'include' } })
export const integrationsApi = hc<IntegrationRoutes>(apiBase, { init: { credentials: 'include' } })
const projectDriftApi = hc<ProjectDriftRoutes>(apiBase, { init: { credentials: 'include' } })
export const projectDriftClient = projectDriftApi.projects[':id'].drift
export type DriftResult = InferResponseType<typeof projectDriftClient.$get, 200>
export type DriftReport = NonNullable<DriftResult['report']>
export type DriftAction = InferRequestType<typeof projectDriftClient.check.$post>['json']
type ProjectTaskEndpoint = NonNullable<typeof projectTasksApi.projects>[':id']
type TaskEndpoint = NonNullable<typeof tasksApi.tasks>
export type TrackerIntegration = {
  id: string
  provider: 'linear'
  name: string
  options: { pushMilestones: boolean; pullStatus: boolean; importIssues: boolean }
  statusMapping: {
    planning: string | null
    in_progress: string | null
    completed: string | null
    archived: string | null
  }
  states: { id: string; name: string }[]
  lastSyncedAt: string | null
}
type TrackerResponse<T> = Promise<ClientResponse<T, 200, 'json'>>
// OpenAPIHono's route merger flattens these two path segments in its inferred
// client type. The hc proxy still needs both segments at runtime.
export const projectTasksClient = projectTasksApi as unknown as {
  projects: { ':id': { tasks: ProjectTaskEndpoint } }
}
export const tasksClient = tasksApi as unknown as { tasks: { ':id': TaskEndpoint } }
export const integrationsClient = integrationsApi as unknown as {
  workspaces: {
    ':ws': {
      integrations: {
        $get: (input: {
          param: { ws: string }
        }) => TrackerResponse<{ configured: boolean; integration: TrackerIntegration | null }>
        ':provider': {
          connect: {
            $post: (input: {
              param: { ws: string; provider: 'linear' }
            }) => TrackerResponse<{ authorizationUrl: string }>
          }
        }
      }
    }
  }
  integrations: {
    ':id': {
      $patch: (input: {
        param: { id: string }
        json: {
          options?: Partial<TrackerIntegration['options']>
          statusMapping?: Partial<TrackerIntegration['statusMapping']>
        }
      }) => TrackerResponse<{ integration: TrackerIntegration }>
      $delete: (input: { param: { id: string } }) => TrackerResponse<{ ok: true }>
      sync: {
        $post: (input: {
          param: { id: string }
        }) => TrackerResponse<{ integration: TrackerIntegration }>
      }
    }
  }
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

// Unwraps a typed client call: the success body, or a RequestError with the API's message.
export async function call<T extends ClientResponse<unknown>>(
  response: T | Promise<T>,
): ReturnType<typeof parseResponse<T>> {
  try {
    return await parseResponse(response)
  } catch (error) {
    if (!(error instanceof DetailedError)) throw error
    throw new RequestError(
      error.detail?.data?.error ?? 'Something went wrong. Please try again.',
      error.statusCode,
    )
  }
}
