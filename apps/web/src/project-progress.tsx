import { useQuery } from '@tanstack/react-query'
import { api, call } from './api'

// ponytail: reads the project detail per row (cached under ['project', id]); fold into the list endpoint if lists grow.
export function ProjectProgress({ id, name }: { id: string; name: string }) {
  const detail = useQuery({
    queryKey: ['project', id],
    queryFn: () => call(api.projects[':id'].$get({ param: { id } })),
  })
  if (detail.isError) return <span className="text-text-muted">Couldn’t load progress</span>
  if (!detail.data) return <span className="text-text-muted">Loading progress…</span>
  const { done, total } = detail.data.project.taskProgress
  if (!total) return <span className="text-text-muted">No plan yet</span>
  return (
    <span className="inline-flex items-center gap-2 text-text-muted">
      <span
        role="progressbar"
        aria-label={`${name} task progress`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1 w-14 shrink-0 overflow-hidden rounded-control bg-bg-muted"
      >
        <span
          className="block h-full rounded-control bg-accent"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </span>
      <span className="font-mono">
        {done}/{total}
      </span>
    </span>
  )
}
