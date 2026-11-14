import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { recordActivity } from '../activity/service'
import { diagrams, diagramVersions, memberships, projects, user } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import { diagramTypes, sceneSchema, sceneTooLarge } from './schema'
import { createDiagramVersion, type DiagramDb } from './service'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const idParams = { params: z.object({ id: z.uuid() }) }
const diagramResponse = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  type: z.enum(diagramTypes),
  currentVersion: z.number().int(),
  scene: sceneSchema,
  sceneVersion: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const versionResponse = z.object({
  id: z.uuid(),
  version: z.number().int(),
  label: z.string().nullable(),
  createdBy: z.string().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
})
const readErrors = { 401: json(error, 'Sign in required'), 404: json(error, 'Diagram not found') }
const writeErrors = { ...readErrors, 403: json(error, 'Owner or editor required') }
const listRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/diagrams',
  request: idParams,
  responses: {
    200: json(
      z.object({ diagrams: z.array(diagramResponse.omit({ scene: true })) }),
      'Project diagrams',
    ),
    ...readErrors,
  },
})
const createDiagramRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/diagrams',
  request: {
    ...idParams,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ name: z.string().trim().min(1).max(160), type: z.enum(diagramTypes) })
            .strict(),
        },
      },
      required: true,
    },
  },
  responses: {
    201: json(z.object({ diagram: diagramResponse }), 'Created diagram'),
    ...writeErrors,
  },
})
const getRoute = createRoute({
  method: 'get',
  path: '/diagrams/{id}',
  request: idParams,
  responses: {
    200: json(z.object({ diagram: diagramResponse }), 'Diagram working copy'),
    ...readErrors,
  },
})
const putRoute = createRoute({
  method: 'put',
  path: '/diagrams/{id}',
  request: {
    ...idParams,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              scene: sceneSchema,
              sceneVersion: z.number().int().min(0),
              name: z.string().trim().min(1).max(160).optional(),
            })
            .strict(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: json(z.object({ diagram: diagramResponse }), 'Saved working copy'),
    ...writeErrors,
    409: json(error, 'The working copy has changed'),
    413: json(error, 'Scene exceeds 1 MB'),
  },
})
const deleteRoute = createRoute({
  method: 'delete',
  path: '/diagrams/{id}',
  request: idParams,
  responses: { 200: json(z.object({ ok: z.literal(true) }), 'Deleted diagram'), ...writeErrors },
})
const versionsRoute = createRoute({
  method: 'get',
  path: '/diagrams/{id}/versions',
  request: idParams,
  responses: {
    200: json(z.object({ versions: z.array(versionResponse) }), 'Saved versions'),
    ...readErrors,
  },
})
const saveVersionRoute = createRoute({
  method: 'post',
  path: '/diagrams/{id}/versions',
  request: {
    ...idParams,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ label: z.string().trim().min(1).max(160).nullable().optional() })
            .strict()
            .optional(),
        },
      },
      required: false,
    },
  },
  responses: { 201: json(z.object({ version: versionResponse }), 'Saved version'), ...writeErrors },
})
const restoreRoute = createRoute({
  method: 'post',
  path: '/diagrams/{id}/versions/{v}/restore',
  request: { params: z.object({ id: z.uuid(), v: z.coerce.number().int().positive() }) },
  responses: {
    201: json(
      z.object({ diagram: diagramResponse, version: versionResponse }),
      'Restored as a new version',
    ),
    ...writeErrors,
  },
})
const canWrite = (role: string) => role === 'owner' || role === 'editor'
const encodeDiagram = (row: typeof diagrams.$inferSelect) => ({
  ...row,
  scene: sceneSchema.parse(row.scene),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const encodeVersion = (row: typeof diagramVersions.$inferSelect, authorName: string | null) => ({
  id: row.id,
  version: row.version,
  label: row.label,
  createdBy: row.createdBy,
  authorName,
  createdAt: row.createdAt.toISOString(),
})
async function visibleProject(db: DiagramDb, id: string, actorId: string) {
  const [row] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId, role: memberships.role })
    .from(projects)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actorId)),
    )
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
  return row
}
async function visibleDiagram(db: DiagramDb, id: string, actorId: string) {
  const [row] = await db
    .select({ diagram: diagrams, role: memberships.role, workspaceId: projects.workspaceId })
    .from(diagrams)
    .innerJoin(projects, eq(projects.id, diagrams.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actorId)),
    )
    .where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt), isNull(projects.deletedAt)))
  return row
}
function base(options: { database?: DatabaseFactory; auth?: AuthFactory }) {
  const app = new OpenAPIHono<Env>()
  app.use(
    '*',
    async (c, next) => {
      if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
        return c.json({ error: 'Invalid origin' }, 403)
      return next()
    },
    useDb(options.database),
    requireSession(options.auth),
  )
  return app
}
export function createProjectDiagramRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  return base(options)
    .openapi(listRoute, async (c) => {
      const db = c.get('db'),
        project = await visibleProject(db, c.req.valid('param').id, c.get('user').id)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const rows = await db
        .select({
          id: diagrams.id,
          projectId: diagrams.projectId,
          name: diagrams.name,
          type: diagrams.type,
          currentVersion: diagrams.currentVersion,
          sceneVersion: diagrams.sceneVersion,
          createdBy: diagrams.createdBy,
          createdAt: diagrams.createdAt,
          updatedAt: diagrams.updatedAt,
        })
        .from(diagrams)
        .where(and(eq(diagrams.projectId, project.id), isNull(diagrams.deletedAt)))
        .orderBy(diagrams.createdAt, diagrams.id)
      return c.json(
        {
          diagrams: rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
        },
        200,
      )
    })
    .openapi(createDiagramRoute, async (c) => {
      const db = c.get('db'),
        actorId = c.get('user').id,
        project = await visibleProject(db, c.req.valid('param').id, actorId)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (!canWrite(project.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const diagram = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(diagrams)
          .values({ ...c.req.valid('json'), projectId: project.id, createdBy: actorId })
          .returning()
        if (!created) throw new Error('Diagram could not be created')
        await recordActivity(tx, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorId,
          type: 'diagram.created',
          subject: created.id,
          payload: {
            name: created.name,
            before: null,
            after: { name: created.name, type: created.type },
          },
        })
        return created
      })
      return c.json({ diagram: encodeDiagram(diagram) }, 201)
    })
}
export function createDiagramRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  return base(options)
    .openapi(getRoute, async (c) => {
      const visible = await visibleDiagram(c.get('db'), c.req.valid('param').id, c.get('user').id)
      if (!visible) return c.json({ error: 'Diagram not found' }, 404)
      return c.json({ diagram: encodeDiagram(visible.diagram) }, 200)
    })
    .openapi(putRoute, async (c) => {
      const db = c.get('db'),
        visible = await visibleDiagram(db, c.req.valid('param').id, c.get('user').id)
      if (!visible) return c.json({ error: 'Diagram not found' }, 404)
      if (!canWrite(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const input = c.req.valid('json')
      if (sceneTooLarge(input.scene))
        return c.json(
          { error: 'The diagram is larger than 1 MB. Remove some shapes or text.' },
          413,
        )
      const [diagram] = await db
        .update(diagrams)
        .set({
          scene: input.scene,
          sceneVersion: input.sceneVersion + 1,
          ...(input.name ? { name: input.name } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(diagrams.id, visible.diagram.id),
            eq(diagrams.projectId, visible.diagram.projectId),
            eq(diagrams.sceneVersion, input.sceneVersion),
            isNull(diagrams.deletedAt),
          ),
        )
        .returning()
      if (!diagram)
        return c.json(
          { error: 'This diagram changed in another session. Reload it before saving.' },
          409,
        )
      return c.json({ diagram: encodeDiagram(diagram) }, 200)
    })
    .openapi(deleteRoute, async (c) => {
      const db = c.get('db'),
        visible = await visibleDiagram(db, c.req.valid('param').id, c.get('user').id)
      if (!visible) return c.json({ error: 'Diagram not found' }, 404)
      if (!canWrite(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(diagrams)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(diagrams.id, visible.diagram.id),
              eq(diagrams.projectId, visible.diagram.projectId),
              isNull(diagrams.deletedAt),
            ),
          )
          .returning()
        if (!row) return false
        await recordActivity(tx, {
          workspaceId: visible.workspaceId,
          projectId: row.projectId,
          actorId: c.get('user').id,
          type: 'diagram.deleted',
          subject: row.id,
          payload: {
            name: row.name,
            before: { name: row.name, version: row.currentVersion },
            after: null,
          },
        })
        return true
      })
      if (!deleted) return c.json({ error: 'Diagram not found' }, 404)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(versionsRoute, async (c) => {
      const db = c.get('db'),
        visible = await visibleDiagram(db, c.req.valid('param').id, c.get('user').id)
      if (!visible) return c.json({ error: 'Diagram not found' }, 404)
      const rows = await db
        .select({ version: diagramVersions, authorName: user.name })
        .from(diagramVersions)
        .leftJoin(user, eq(user.id, diagramVersions.createdBy))
        .where(eq(diagramVersions.diagramId, visible.diagram.id))
        .orderBy(desc(diagramVersions.version))
      return c.json(
        { versions: rows.map((row) => encodeVersion(row.version, row.authorName)) },
        200,
      )
    })
    .openapi(saveVersionRoute, async (c) => {
      const db = c.get('db'),
        visible = await visibleDiagram(db, c.req.valid('param').id, c.get('user').id)
      if (!visible) return c.json({ error: 'Diagram not found' }, 404)
      if (!canWrite(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(diagrams)
          .where(
            and(
              eq(diagrams.id, visible.diagram.id),
              eq(diagrams.projectId, visible.diagram.projectId),
              isNull(diagrams.deletedAt),
            ),
          )
          .for('update')
        if (!locked) return null
        const saved = await createDiagramVersion(
          tx,
          locked,
          locked.scene,
          c.req.valid('json')?.label ?? null,
          c.get('user').id,
        )
        await recordActivity(tx, {
          workspaceId: visible.workspaceId,
          projectId: locked.projectId,
          actorId: c.get('user').id,
          type: 'diagram.version_saved',
          subject: locked.id,
          payload: {
            name: locked.name,
            before: locked.currentVersion,
            after: saved.diagram.currentVersion,
          },
        })
        return saved
      })
      if (!result) return c.json({ error: 'Diagram not found' }, 404)
      return c.json({ version: encodeVersion(result.version, c.get('user').name ?? null) }, 201)
    })
    .openapi(restoreRoute, async (c) => {
      const db = c.get('db'),
        visible = await visibleDiagram(db, c.req.valid('param').id, c.get('user').id)
      if (!visible) return c.json({ error: 'Diagram not found' }, 404)
      if (!canWrite(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(diagrams)
          .where(
            and(
              eq(diagrams.id, visible.diagram.id),
              eq(diagrams.projectId, visible.diagram.projectId),
              isNull(diagrams.deletedAt),
            ),
          )
          .for('update')
        if (!locked) return null
        const [old] = await tx
          .select()
          .from(diagramVersions)
          .where(
            and(
              eq(diagramVersions.diagramId, locked.id),
              eq(diagramVersions.version, c.req.valid('param').v),
            ),
          )
        if (!old) return null
        const restored = await createDiagramVersion(
          tx,
          locked,
          old.scene,
          null,
          c.get('user').id,
          true,
        )
        await recordActivity(tx, {
          workspaceId: visible.workspaceId,
          projectId: locked.projectId,
          actorId: c.get('user').id,
          type: 'diagram.restored',
          subject: locked.id,
          payload: {
            name: locked.name,
            before: locked.currentVersion,
            after: restored.diagram.currentVersion,
            restoredFrom: old.version,
          },
        })
        return restored
      })
      if (!result) return c.json({ error: 'Diagram version not found' }, 404)
      return c.json(
        {
          diagram: encodeDiagram(result.diagram),
          version: encodeVersion(result.version, c.get('user').name ?? null),
        },
        201,
      )
    })
}
