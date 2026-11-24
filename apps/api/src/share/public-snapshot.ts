import { z } from '@hono/zod-openapi'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import {
  diagrams,
  diagramVersions,
  milestones,
  planSections,
  type projects,
  tasks,
} from '../db/schema'
import { sceneSchema } from '../diagrams/schema'

const publicScene = z.object({
  nodes: z.array(
    z.object({
      type: z.enum(['rectangle', 'diamond', 'cylinder', 'actor', 'entity', 'text']),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.object({ label: z.string() }),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.number().int(),
      target: z.number().int(),
      label: z.string().optional(),
      sourceHandle: z.string().nullable().optional(),
      targetHandle: z.string().nullable().optional(),
    }),
  ),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
})
export const publicSchema = z.object({
  workspaceName: z.string(),
  sharedBy: z.string(),
  project: z.object({
    name: z.string(),
    status: z.enum(['draft', 'planning', 'in-progress', 'completed', 'archived']),
    leadName: z.string().nullable(),
    targetDate: z.string().nullable(),
    updatedAt: z.string(),
  }),
  brief: z
    .object({
      problem: z.string(),
      goals: z.array(z.string()).optional(),
      constraints: z.string().optional(),
      outOfScope: z.string().optional(),
    })
    .optional(),
  plan: z
    .object({
      milestones: z.array(
        z.object({
          code: z.string(),
          title: z.string(),
          status: z.enum(['planning', 'in_progress', 'completed']),
          dueDate: z.string().nullable(),
        }),
      ),
      estimate: z.object({ value: z.string(), note: z.string() }).nullable(),
    })
    .optional(),
  diagrams: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['flowchart', 'architecture', 'sequence', 'entity_relationship']),
        scene: publicScene,
      }),
    )
    .optional(),
  tasks: z
    .array(
      z.object({
        key: z.string(),
        title: z.string(),
        status: z.enum(['todo', 'in_progress', 'done']),
      }),
    )
    .optional(),
})

type SharedDiagram = NonNullable<z.infer<typeof publicSchema>['diagrams']>[number]

export async function readPublicDiagrams(db: Db, projectId: string, includes: string[]) {
  if (!includes.includes('diagrams')) return []
  const rows = await db
    .select({
      id: diagrams.id,
      name: diagrams.name,
      type: diagrams.type,
      scene: diagramVersions.scene,
    })
    .from(diagrams)
    .innerJoin(
      diagramVersions,
      and(
        eq(diagramVersions.diagramId, diagrams.id),
        eq(diagramVersions.version, diagrams.currentVersion),
      ),
    )
    .where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt)))
    .orderBy(asc(diagrams.createdAt), asc(diagrams.id))
  return rows.flatMap((row) => {
    const scene = sceneSchema.safeParse(row.scene)
    if (!scene.success) return []
    const indices = new Map(scene.data.nodes.map((node, index) => [node.id, index]))
    const diagram: SharedDiagram = {
      name: row.name,
      type: row.type,
      scene: {
        nodes: scene.data.nodes.map(({ id: _id, ...node }) => node),
        edges: scene.data.edges.map(({ id: _id, source, target, ...edge }) => ({
          ...edge,
          source: indices.get(source) as number,
          target: indices.get(target) as number,
        })),
        ...(scene.data.viewport ? { viewport: scene.data.viewport } : {}),
      },
    }
    return [{ id: row.id, diagram }]
  })
}

export async function readPublicSnapshot(
  db: Db,
  found: {
    project: typeof projects.$inferSelect
    link: { include: string[] }
    workspaceName: string
    leadName: string | null
    sharedBy: string | null
  },
) {
  const p = found.project,
    includes = found.link.include
  const response: z.infer<typeof publicSchema> = {
    workspaceName: found.workspaceName,
    sharedBy: found.sharedBy ?? 'Deleted user',
    project: {
      name: p.name,
      status: p.status,
      leadName: found.leadName,
      targetDate: p.targetDate,
      updatedAt: p.updatedAt.toISOString(),
    },
  }
  if (includes.includes('brief')) {
    const { problem, goals, constraints, outOfScope } = p.brief
    response.brief = {
      problem,
      ...(goals ? { goals } : {}),
      ...(constraints !== undefined ? { constraints } : {}),
      ...(outOfScope !== undefined ? { outOfScope } : {}),
    }
  }
  if (includes.includes('plan')) {
    const [ms, estimate] = await Promise.all([
      db
        .select({
          code: milestones.code,
          title: milestones.title,
          status: milestones.status,
          dueDate: milestones.dueDate,
        })
        .from(milestones)
        .where(eq(milestones.projectId, p.id))
        .orderBy(asc(milestones.position)),
      db
        .select({ content: planSections.content })
        .from(planSections)
        .where(and(eq(planSections.projectId, p.id), eq(planSections.kind, 'estimate'))),
    ])
    const parsed = z.object({ value: z.string(), note: z.string() }).safeParse(estimate[0]?.content)
    response.plan = { milestones: ms, estimate: parsed.success ? parsed.data : null }
  }
  if (includes.includes('tasks')) {
    const rows = await db
      .select({ number: tasks.number, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.projectId, p.id))
      .orderBy(asc(tasks.position))
    response.tasks = rows.map((t) => ({
      key: `${p.key}-${t.number}`,
      title: t.title,
      status: t.status,
    }))
  }

  const sharedDiagrams = await readPublicDiagrams(db, p.id, includes)
  if (includes.includes('diagrams'))
    response.diagrams = sharedDiagrams.map(({ diagram }) => diagram)
  return { data: response, sharedDiagrams }
}
