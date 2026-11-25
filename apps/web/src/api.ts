import type {
  AppType,
  IntegrationRoutes,
  ProjectDriftRoutes,
  ProjectStatusReportRoutes,
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
import { apiBase } from './api-base'
import { UserError } from './user-error'

const base = apiBase()
export const api = hc<AppType>(base, {
  init: { credentials: 'include' },
})
export const projectTasksApi = hc<ProjectTaskRoutes>(base, { init: { credentials: 'include' } })
export const tasksApi = hc<TaskRoutes>(base, { init: { credentials: 'include' } })
export const integrationsApi = hc<IntegrationRoutes>(base, { init: { credentials: 'include' } })
const projectDriftApi = hc<ProjectDriftRoutes>(base, { init: { credentials: 'include' } })
export const projectDriftClient = projectDriftApi.projects[':id'].drift
export type DriftResult = InferResponseType<typeof projectDriftClient.$get, 200>
export type DriftReport = NonNullable<DriftResult['report']>
export type DriftAction = InferRequestType<typeof projectDriftClient.check.$post>['json']
const projectStatusReportApi = hc<ProjectStatusReportRoutes>(base, {
  init: { credentials: 'include' },
})
export const projectStatusReportClient = projectStatusReportApi.projects[':id']['status-reports']
export type WeeklyStatusReport = InferResponseType<
  typeof projectStatusReportClient.preview.$post,
  200
>['report']
export type SentStatusReport = InferResponseType<
  typeof projectStatusReportClient.$get,
  200
>['reports'][number]
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
// Starting a draft can answer 503 "Drafting is not set up"; that text is written for people, so show it.
export const startDraftCall = <T extends ClientResponse<unknown>>(response: Promise<T>) =>
  call(response).catch((error) => {
    throw error instanceof RequestError && error.status === 503
      ? new UserError(error.message)
      : error
  })

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
