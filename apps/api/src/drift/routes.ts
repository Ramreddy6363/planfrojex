import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, isNull } from 'drizzle-orm'
import { memberships, projects } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import {
  checkDrift,
  lockDriftConnection,
  lockDriftProject,
  readDrift,
  reviewDrift,
  StaleDriftReport,
} from './service'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const idParams = { params: z.object({ id: z.uuid() }) }
const severity = z.enum(['low', 'medium', 'high', 'critical'])
const task = z.object({ id: z.uuid(), key: z.string(), title: z.string() })
const finding = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('milestone_late'),
    milestoneId: z.uuid(),
    code: z.string(),
    title: z.string(),
    dueDate: z.iso.date(),
    done: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    daysLate: z.number().int().min(2),
  }),
  z.object({
    kind: z.literal('linear_tasks'),
    milestoneId: z.uuid().nullable(),
    milestoneCode: z.string().nullable(),
    tasks: z.array(task),
  }),
  z.object({
    kind: z.literal('risk_overdue'),
    riskId: z.uuid(),
    code: z.string(),
    title: z.string(),
    decideBy: z.iso.date(),
    severity,
  }),
])
const changeBase = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected']),
})
const change = z.discriminatedUnion('kind', [
  changeBase.extend({
    kind: z.literal('milestone_date'),
    before: z.iso.date(),
    after: z.iso.date(),
  }),
  changeBase.extend({ kind: z.literal('milestone_tasks'), tasks: z.array(task) }),
  changeBase.extend({
    kind: z.literal('risk_severity'),
    before: severity,
    after: severity,
    ownerName: z.string().nullable(),
  }),
])
const output = z.object({
  linearConnected: z.boolean(),
  canManage: z.boolean(),
  report: z
    .object({
      id: z.uuid(),
      checkedAt: z.iso.datetime(),
      checkedAgainstLinearAt: z.iso.datetime().nullable(),
      findings: z.array(finding),
      changes: z.array(change),
    })
    .nullable(),
})
const reason = z.string().trim().max(2000).optional()
const input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('check') }),
  z.strictObject({ action: z.literal('accept'), reportId: z.uuid(), reason }),
  z.strictObject({ action: z.literal('dismiss'), reportId: z.uuid() }),
  z.strictObject({
    action: z.enum(['accept_change', 'reject_change']),
    reportId: z.uuid(),
    changeId: z.uuid(),
    reason,
  }),
])
const responses = {
  200: json(output, 'Current project drift'),
  401: json(error, 'Sign in required'),
  404: json(error, 'Project not found'),
}
const getDriftRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/drift',
  request: idParams,
  responses,
})
const checkDriftRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/drift/check',
  request: {
    ...idParams,
    body: { content: { 'application/json': { schema: input.optional() } }, required: false },
  },
  responses: {
    ...responses,
    400: json(error, 'Invalid drift action'),
    403: json(error, 'Owner or editor required'),
    409: json(error, 'Drift report changed'),
  },
})

export function createProjectDriftRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: 'Invalid drift action' }, 400)
    },
  })
  for (const path of ['/projects/:id/drift', '/projects/:id/drift/check'])
    app.use(
      path,
      async (c, next) => {
        if (c.req.method === 'POST') {
          if (c.req.header('origin') !== c.env.WEB_ORIGIN)
            return c.json({ error: 'Invalid origin' }, 403)
          if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) {
            if (c.req.raw.body) return c.json({ error: 'Invalid drift action' }, 400)
            const headers = new Headers(c.req.raw.headers)
            headers.set('content-type', 'application/json')
            c.req.raw = new Request(c.req.raw, { headers, body: '{"action":"check"}' })
          }
        }
        return next()
      },
      useDb(options.database),
      requireSession(options.auth),
    )
  return app
    .openapi(getDriftRoute, async (c) => {
      const projectId = c.req.valid('param').id
      const actor = c.get('user').id
      const db = c.get('db')
      const [member] = await db
        .select({ workspaceId: projects.workspaceId, role: memberships.role })
        .from(projects)
        .innerJoin(
          memberships,
          and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actor)),
        )
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      if (!member) return c.json({ error: 'Project not found' }, 404)
      return c.json(
        await readDrift(
          db,
          { projectId, workspaceId: member.workspaceId },
          member.role !== 'viewer',
        ),
        200,
      )
    })
    .openapi(checkDriftRoute, async (c) => {
      const projectId = c.req.valid('param').id
      const actor = c.get('user').id
      const input = c.req.valid('json') ?? { action: 'check' as const }
      try {
        return await c.get('db').transaction(async (tx) => {
          const [member] = await tx
            .select({ workspaceId: projects.workspaceId, role: memberships.role })
            .from(projects)
            .innerJoin(
              memberships,
              and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actor)),
            )
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .for('share', { of: memberships })
          if (!member) return c.json({ error: 'Project not found' }, 404)
          if (member.role === 'viewer') return c.json({ error: 'Owner or editor required' }, 403)
          const scope = { projectId, workspaceId: member.workspaceId }
          const current =
            input.action === 'check' ? null : await lockDriftConnection(tx, scope.workspaceId)
          if (!(await lockDriftProject(tx, scope)))
            return c.json({ error: 'Project not found' }, 404)
          if (input.action === 'check') await checkDrift(tx, scope, actor)
          else await reviewDrift(tx, scope, actor, input, current?.destination ?? null)
          return c.json(await readDrift(tx, scope, true), 200)
        })
      } catch (error) {
        if (error instanceof StaleDriftReport)
          return c.json(
            { error: 'The plan changed. Check again to get the latest suggestions.' },
            409,
          )
        throw error
      }
    })
}
