import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { memberships, milestones, planSections, projects, risks, tasks, user } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const idParams = { params: z.object({ id: z.uuid() }) }
const sectionKind = z.enum(['requirements', 'stories', 'stack', 'estimate'])
const sectionPatch = z.object({ version: z.number().int().min(0), content: z.json() }).strict()
const sectionContent = {
  requirements: z.array(z.string().trim().min(1).max(2_000)).max(50),
  stories: z.array(z.string().trim().min(1).max(2_000)).max(50),
  stack: z.array(z.string().trim().min(1).max(80)).max(40),
  estimate: z
    .object({ value: z.string().trim().min(1).max(80), note: z.string().trim().max(5_000) })
    .strict(),
}
const milestoneInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    status: z.enum(['planning', 'in_progress', 'completed']).default('planning'),
    dueDate: z.iso.date().nullable().optional(),
  })
  .strict()
const milestonePatch = milestoneInput.partial().refine((x) => Object.keys(x).length > 0)
const riskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    ownerId: z.string().min(1).max(128).nullable().optional(),
    decideBy: z.iso.date().nullable().optional(),
  })
  .strict()
const riskPatch = riskInput.partial().refine((x) => Object.keys(x).length > 0)
const milestoneResponse = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  code: z.string(),
  title: z.string(),
  status: z.enum(['planning', 'in_progress', 'completed']),
  dueDate: z.string().nullable(),
  position: z.number().int(),
})
const riskResponse = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  code: z.string(),
  title: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  ownerId: z.string().nullable(),
  decideBy: z.string().nullable(),
})
const sectionResponse = z.object({
  kind: sectionKind,
  content: z.unknown(),
  version: z.number().int(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
})
const getPlan = createRoute({
  method: 'get',
  path: '/projects/{id}/plan',
  request: idParams,
  responses: {
    200: json(
      z.object({
        sections: z.array(sectionResponse),
        milestones: z.array(milestoneResponse),
        risks: z.array(riskResponse),
        lastChanged: z.object({ at: z.string(), by: z.string().nullable() }).nullable(),
      }),
      'Project plan',
    ),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const patchSection = createRoute({
  method: 'patch',
  path: '/projects/{id}/plan/sections/{kind}',
  request: {
    params: z.object({ id: z.uuid(), kind: sectionKind }),
    body: { content: { 'application/json': { schema: sectionPatch } }, required: true },
  },
  responses: {
    200: json(z.object({ section: sectionResponse }), 'Updated section'),
    400: json(error, 'Invalid section'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
    409: json(error, 'Section changed since it was loaded'),
  },
})
const createMilestoneRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/milestones',
  request: {
    ...idParams,
    body: { content: { 'application/json': { schema: milestoneInput } }, required: true },
  },
  responses: {
    201: json(z.object({ milestone: milestoneResponse }), 'Created milestone'),
    400: json(error, 'Invalid milestone'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
  },
})
const patchMilestoneRoute = createRoute({
  method: 'patch',
  path: '/milestones/{id}',
  request: {
    ...idParams,
    body: { content: { 'application/json': { schema: milestonePatch } }, required: true },
  },
  responses: {
    200: json(z.object({ milestone: milestoneResponse }), 'Updated milestone'),
    400: json(error, 'Invalid milestone'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Milestone not found'),
  },
})
const deleteMilestoneRoute = createRoute({
  method: 'delete',
  path: '/milestones/{id}',
  request: idParams,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Deleted milestone'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Milestone not found'),
  },
})
const createRiskRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/risks',
  request: {
    ...idParams,
    body: { content: { 'application/json': { schema: riskInput } }, required: true },
  },
  responses: {
    201: json(z.object({ risk: riskResponse }), 'Created risk'),
    400: json(error, 'Invalid risk'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
  },
})
const patchRiskRoute = createRoute({
  method: 'patch',
  path: '/risks/{id}',
  request: {
    ...idParams,
    body: { content: { 'application/json': { schema: riskPatch } }, required: true },
  },
  responses: {
    200: json(z.object({ risk: riskResponse }), 'Updated risk'),
    400: json(error, 'Invalid risk'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Risk not found'),
  },
})
const deleteRiskRoute = createRoute({
  method: 'delete',
  path: '/risks/{id}',
  request: idParams,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Deleted risk'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Risk not found'),
  },
})

type Db = ReturnType<DatabaseFactory>
const writable = (role: string) => role === 'owner' || role === 'editor'
async function visibleProject(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      role: memberships.role,
      planUpdatedAt: projects.planUpdatedAt,
      planUpdatedBy: projects.planUpdatedBy,
    })
    .from(projects)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
  return row
}
async function visibleRecord(
  db: Db,
  table: typeof milestones | typeof risks,
  id: string,
  userId: string,
) {
  const [row] = await db
    .select({
      id: table.id,
      projectId: table.projectId,
      workspaceId: projects.workspaceId,
      role: memberships.role,
    })
    .from(table)
    .innerJoin(projects, eq(projects.id, table.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(table.id, id), isNull(projects.deletedAt)))
  return row
}

export function createProjectPlanRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  for (const path of ['/projects/*', '/milestones/*', '/risks/*']) {
    app.use(
      path,
      async (c, next) => {
        if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
          return c.json({ error: 'Invalid origin' }, 403)
        return next()
      },
      useDb(options.database),
      requireSession(options.auth),
    )
  }
  return app
    .openapi(getPlan, async (c) => {
      const db = c.get('db')
      const actor = c.get('user').id
      const projectId = c.req.valid('param').id
      const project = await visibleProject(db, projectId, actor)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const [sections, ms, rs] = await Promise.all([
        db
          .select()
          .from(planSections)
          .where(eq(planSections.projectId, projectId))
          .orderBy(asc(planSections.kind)),
        db
          .select()
          .from(milestones)
          .where(eq(milestones.projectId, projectId))
          .orderBy(asc(milestones.position), asc(milestones.id)),
        db
          .select()
          .from(risks)
          .where(eq(risks.projectId, projectId))
          .orderBy(asc(risks.createdAt), asc(risks.id)),
      ])
      const byKind = new Map(sections.map((section) => [section.kind, section]))
      const kinds = ['requirements', 'stories', 'stack', 'estimate'] as const
      const sectionValues = kinds.map((kind) => {
        const value = byKind.get(kind)
        return value
          ? {
              kind,
              content: value.content,
              version: value.version,
              updatedAt: value.updatedAt.toISOString(),
              updatedBy: value.updatedBy,
            }
          : { kind, content: null, version: 0, updatedAt: '', updatedBy: null }
      })
      const changes = [
        ...sections.map((section) => ({ at: section.updatedAt, by: section.updatedBy })),
        ...ms.map((milestone) => ({ at: milestone.updatedAt, by: null })),
        ...rs.map((risk) => ({ at: risk.updatedAt, by: null })),
        ...(project.planUpdatedAt
          ? [{ at: project.planUpdatedAt, by: project.planUpdatedBy }]
          : []),
      ]
      const latest = changes.reduce<(typeof changes)[number] | null>(
        (max, change) => (!max || change.at > max.at ? change : max),
        null,
      )
      const lastChangedBy = latest?.by
        ? ((await db.select({ name: user.name }).from(user).where(eq(user.id, latest.by)))[0]
            ?.name ?? null)
        : null
      return c.json(
        {
          sections: sectionValues,
          milestones: ms.map(({ id, projectId: pid, code, title, status, dueDate, position }) => ({
            id,
            projectId: pid,
            code,
            title,
            status,
            dueDate,
            position,
          })),
          risks: rs.map(({ id, projectId: pid, code, title, severity, ownerId, decideBy }) => ({
            id,
            projectId: pid,
            code,
            title,
            severity,
            ownerId,
            decideBy,
          })),
          lastChanged: latest ? { at: latest.at.toISOString(), by: lastChangedBy } : null,
        },
        200,
      )
    })
    .openapi(patchSection, async (c) => {
      const { id, kind } = c.req.valid('param')
      const input = c.req.valid('json')
      const db = c.get('db')
      const actor = c.get('user').id
      const project = await visibleProject(db, id, actor)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (!writable(project.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const content = sectionContent[kind].safeParse(input.content)
      if (!content.success) return c.json({ error: 'Invalid section content' }, 400)
      if (input.version > 0) {
        const [current] = await db
          .select({ version: planSections.version })
          .from(planSections)
          .where(and(eq(planSections.projectId, id), eq(planSections.kind, kind)))
        if (!current || current.version !== input.version)
          return c.json({ error: 'Section changed since it was loaded' }, 409)
      }
      const now = new Date()
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(planSections)
          .values({
            projectId: id,
            kind,
            content: content.data,
            version: 1,
            updatedBy: actor,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [planSections.projectId, planSections.kind],
            set: {
              content: content.data,
              version: sql`${planSections.version} + 1`,
              updatedBy: actor,
              updatedAt: now,
            },
            setWhere: eq(planSections.version, input.version),
          })
          .returning()
        if (!row) return null
        await tx
          .update(projects)
          .set({ planUpdatedAt: now, planUpdatedBy: actor })
          .where(and(eq(projects.id, id), eq(projects.workspaceId, project.workspaceId)))
        return row
      })
      if (!updated) return c.json({ error: 'Section changed since it was loaded' }, 409)
      return c.json(
        {
          section: {
            kind: updated.kind,
            content: updated.content,
            version: updated.version,
            updatedAt: updated.updatedAt.toISOString(),
            updatedBy: updated.updatedBy,
          },
        },
        200,
      )
    })
    .openapi(createMilestoneRoute, async (c) => {
      const projectId = c.req.valid('param').id
      const input = c.req.valid('json')
      const db = c.get('db')
      const actor = c.get('user').id
      const project = await visibleProject(db, projectId, actor)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (!writable(project.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const row = await db.transaction(async (tx) => {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.workspaceId, project.workspaceId)))
          .for('no key update')
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(milestones)
          .where(eq(milestones.projectId, projectId))
        const position = count?.count ?? 0
        const [lastCode] = await tx
          .select({
            max: sql<number>`coalesce(max(substring(${milestones.code} from 2)::int), 0)::int`,
          })
          .from(milestones)
          .where(eq(milestones.projectId, projectId))
        const now = new Date()
        const [created] = await tx
          .insert(milestones)
          .values({
            projectId,
            code: `M${Number(lastCode?.max ?? 0) + 1}`,
            title: input.title,
            status: input.status,
            dueDate: input.dueDate ?? null,
            position,
          })
          .returning()
        await tx
          .update(projects)
          .set({ planUpdatedAt: now, planUpdatedBy: actor })
          .where(and(eq(projects.id, projectId), eq(projects.workspaceId, project.workspaceId)))
        return created
      })
      if (!row) throw new Error('Milestone insert failed')
      return c.json(
        {
          milestone: {
            id: row.id,
            projectId: row.projectId,
            code: row.code,
            title: row.title,
            status: row.status,
            dueDate: row.dueDate,
            position: row.position,
          },
        },
        201,
      )
    })
    .openapi(patchMilestoneRoute, async (c) => {
      const id = c.req.valid('param').id
      const input = c.req.valid('json')
      const db = c.get('db')
      const actor = c.get('user').id
      const row = await visibleRecord(db, milestones, id, actor)
      if (!row) return c.json({ error: 'Milestone not found' }, 404)
      if (!writable(row.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const [updated] = await db
        .update(milestones)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(milestones.id, id))
        .returning()
      if (!updated) return c.json({ error: 'Milestone not found' }, 404)
      await db
        .update(projects)
        .set({ planUpdatedAt: new Date(), planUpdatedBy: actor })
        .where(and(eq(projects.id, row.projectId), eq(projects.workspaceId, row.workspaceId)))
      return c.json(
        {
          milestone: {
            id: updated.id,
            projectId: updated.projectId,
            code: updated.code,
            title: updated.title,
            status: updated.status,
            dueDate: updated.dueDate,
            position: updated.position,
          },
        },
        200,
      )
    })
    .openapi(deleteMilestoneRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const actor = c.get('user').id
      const row = await visibleRecord(db, milestones, id, actor)
      if (!row) return c.json({ error: 'Milestone not found' }, 404)
      if (!writable(row.role)) return c.json({ error: 'Owner or editor required' }, 403)
      await db.transaction(async (tx) => {
        await tx
          .update(tasks)
          .set({ milestoneId: null, updatedAt: new Date() })
          .where(and(eq(tasks.milestoneId, id), eq(tasks.projectId, row.projectId)))
        await tx
          .delete(milestones)
          .where(and(eq(milestones.id, id), eq(milestones.projectId, row.projectId)))
        await tx
          .update(projects)
          .set({ planUpdatedAt: new Date(), planUpdatedBy: actor })
          .where(and(eq(projects.id, row.projectId), eq(projects.workspaceId, row.workspaceId)))
      })
      return c.json({ ok: true as const }, 200)
    })
    .openapi(createRiskRoute, async (c) => {
      const projectId = c.req.valid('param').id
      const input = c.req.valid('json')
      const db = c.get('db')
      const actor = c.get('user').id
      const project = await visibleProject(db, projectId, actor)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (!writable(project.role)) return c.json({ error: 'Owner or editor required' }, 403)
      if (
        input.ownerId &&
        !(
          await db
            .select({ id: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, project.workspaceId),
                eq(memberships.userId, input.ownerId),
              ),
            )
        ).length
      )
        return c.json({ error: 'Risk owner must be a workspace member' }, 400)
      const row = await db.transaction(async (tx) => {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.workspaceId, project.workspaceId)))
          .for('no key update')
        const [count] = await tx
          .select({ max: sql<number>`coalesce(max(substring(${risks.code} from 2)::int), 0)::int` })
          .from(risks)
          .where(eq(risks.projectId, projectId))
        const now = new Date()
        const [created] = await tx
          .insert(risks)
          .values({
            projectId,
            code: `R${Number(count?.max ?? 0) + 1}`,
            title: input.title,
            severity: input.severity,
            ownerId: input.ownerId ?? null,
            decideBy: input.decideBy ?? null,
          })
          .returning()
        await tx
          .update(projects)
          .set({ planUpdatedAt: now, planUpdatedBy: actor })
          .where(and(eq(projects.id, projectId), eq(projects.workspaceId, project.workspaceId)))
        return created
      })
      if (!row) throw new Error('Risk insert failed')
      return c.json(
        {
          risk: {
            id: row.id,
            projectId: row.projectId,
            code: row.code,
            title: row.title,
            severity: row.severity,
            ownerId: row.ownerId,
            decideBy: row.decideBy,
          },
        },
        201,
      )
    })
    .openapi(patchRiskRoute, async (c) => {
      const id = c.req.valid('param').id
      const input = c.req.valid('json')
      const db = c.get('db')
      const actor = c.get('user').id
      const row = await visibleRecord(db, risks, id, actor)
      if (!row) return c.json({ error: 'Risk not found' }, 404)
      if (!writable(row.role)) return c.json({ error: 'Owner or editor required' }, 403)
      if (
        input.ownerId &&
        !(
          await db
            .select({ id: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, row.workspaceId),
                eq(memberships.userId, input.ownerId),
              ),
            )
        ).length
      )
        return c.json({ error: 'Risk owner must be a workspace member' }, 400)
      const [updated] = await db
        .update(risks)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(risks.id, id))
        .returning()
      if (!updated) return c.json({ error: 'Risk not found' }, 404)
      await db
        .update(projects)
        .set({ planUpdatedAt: new Date(), planUpdatedBy: actor })
        .where(and(eq(projects.id, row.projectId), eq(projects.workspaceId, row.workspaceId)))
      return c.json(
        {
          risk: {
            id: updated.id,
            projectId: updated.projectId,
            code: updated.code,
            title: updated.title,
            severity: updated.severity,
            ownerId: updated.ownerId,
            decideBy: updated.decideBy,
          },
        },
        200,
      )
    })
    .openapi(deleteRiskRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const actor = c.get('user').id
      const row = await visibleRecord(db, risks, id, actor)
      if (!row) return c.json({ error: 'Risk not found' }, 404)
      if (!writable(row.role)) return c.json({ error: 'Owner or editor required' }, 403)
      await db.transaction(async (tx) => {
        await tx.delete(risks).where(and(eq(risks.id, id), eq(risks.projectId, row.projectId)))
        await tx
          .update(projects)
          .set({ planUpdatedAt: new Date(), planUpdatedBy: actor })
          .where(and(eq(projects.id, row.projectId), eq(projects.workspaceId, row.workspaceId)))
      })
      return c.json({ ok: true as const }, 200)
    })
}
