import { z } from '@hono/zod-openapi'

export const diagramTypes = [
  'flowchart',
  'architecture',
  'sequence',
  'entity_relationship',
] as const
export const shapeTypes = ['rectangle', 'diamond', 'cylinder', 'actor', 'entity', 'text'] as const
export const sceneSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            type: z.enum(shapeTypes),
            position: z.object({ x: z.number().finite(), y: z.number().finite() }),
            data: z.object({ label: z.string().max(10000) }).strict(),
            width: z.number().positive().max(2000).optional(),
            height: z.number().positive().max(2000).optional(),
          })
          .strict(),
      )
      .max(5000),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            source: z.string().min(1).max(128),
            target: z.string().min(1).max(128),
            label: z.string().max(1000).optional(),
            sourceHandle: z.string().max(128).nullable().optional(),
            targetHandle: z.string().max(128).nullable().optional(),
          })
          .strict(),
      )
      .max(10000),
    viewport: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        zoom: z.number().positive().max(10),
      })
      .optional(),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const ids = new Set(scene.nodes.map((node) => node.id))
    if (
      ids.size !== scene.nodes.length ||
      new Set(scene.edges.map((edge) => edge.id)).size !== scene.edges.length
    )
      ctx.addIssue({ code: 'custom', message: 'Each shape and arrow needs a unique id' })
    if (scene.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target)))
      ctx.addIssue({ code: 'custom', message: 'Arrows must connect shapes in this diagram' })
  })
export type DiagramScene = z.infer<typeof sceneSchema>
export const sceneTooLarge = (scene: unknown) =>
  new TextEncoder().encode(JSON.stringify(scene)).byteLength > 1024 * 1024
