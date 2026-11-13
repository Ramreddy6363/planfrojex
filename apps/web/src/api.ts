import type { AppType, ProjectTaskRoutes, TaskRoutes } from '@planfrojex/api'
import { type ClientResponse, DetailedError, hc, parseResponse } from 'hono/client'

export const api = hc<AppType>(import.meta.env.VITE_API_URL ?? 'http://localhost:8787', {
  init: { credentials: 'include' },
})
const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
export const projectTasksApi = hc<ProjectTaskRoutes>(apiBase, { init: { credentials: 'include' } })
export const tasksApi = hc<TaskRoutes>(apiBase, { init: { credentials: 'include' } })
type ProjectTaskEndpoint = NonNullable<typeof projectTasksApi.projects>[':id']
type TaskEndpoint = NonNullable<typeof tasksApi.tasks>
// OpenAPIHono's route merger flattens these two path segments in its inferred
// client type. The hc proxy still needs both segments at runtime.
export const projectTasksClient = projectTasksApi as unknown as {
  projects: { ':id': { tasks: ProjectTaskEndpoint } }
}
export const tasksClient = tasksApi as unknown as { tasks: { ':id': TaskEndpoint } }

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
