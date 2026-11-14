import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { diagrams, diagramVersions } from '../db/schema'
import type { DatabaseFactory } from '../workspaces/permissions'

export type DiagramDb = ReturnType<DatabaseFactory>
export type DiagramTx = Parameters<Parameters<DiagramDb['transaction']>[0]>[0]
export async function createDiagramVersion(
  tx: DiagramTx,
  diagram: typeof diagrams.$inferSelect,
  scene: unknown,
  label: string | null,
  actorId: string,
  replaceScene = false,
) {
  const versionNumber = diagram.currentVersion + 1
  const [version] = await tx
    .insert(diagramVersions)
    .values({ diagramId: diagram.id, version: versionNumber, scene, label, createdBy: actorId })
    .returning()
  const [updated] = await tx
    .update(diagrams)
    .set({
      currentVersion: versionNumber,
      ...(replaceScene ? { scene, sceneVersion: diagram.sceneVersion + 1 } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(diagrams.id, diagram.id),
        eq(diagrams.projectId, diagram.projectId),
        isNull(diagrams.deletedAt),
      ),
    )
    .returning()
  const unnamed = await tx
    .select({ id: diagramVersions.id })
    .from(diagramVersions)
    .where(and(eq(diagramVersions.diagramId, diagram.id), isNull(diagramVersions.label)))
    .orderBy(desc(diagramVersions.version))
  const pruned = unnamed.slice(50).map((row) => row.id)
  if (pruned.length)
    await tx
      .delete(diagramVersions)
      .where(and(eq(diagramVersions.diagramId, diagram.id), inArray(diagramVersions.id, pruned)))
  if (!version || !updated) throw new Error('Diagram version could not be saved')
  return { diagram: updated, version }
}
