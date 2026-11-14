import { api, call } from './api'

export type MyTasksView = 'assigned' | 'created' | 'completed'
export const myTasksKey = (slug: string) => ['my-tasks', slug] as const
export const getMyTasks = (
  slug: string,
  view: MyTasksView = 'assigned',
  project = '',
  cursor: string | null = null,
  limit = '50',
) =>
  call(
    api.me.tasks.$get({
      query: {
        ws: slug,
        view,
        limit,
        ...(project ? { project } : {}),
        ...(cursor ? { cursor } : {}),
      },
    }),
  )
