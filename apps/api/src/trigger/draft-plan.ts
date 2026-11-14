import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { connect } from '../db'
import { drafts } from '../db/schema'
import { createAnthropicDiagramDraftModel, processDiagramDraft } from '../drafts/diagram-service'
import { createAnthropicDraftModel, processPlanDraft } from '../drafts/service'

type RuntimeProcess = { env?: Record<string, string | undefined> }

export const draftPlanTask = task({
  id: 'draft-plan',
  run: async ({ draftId }: { draftId: string }) => {
    const runtimeProcess = (globalThis as typeof globalThis & { process?: RuntimeProcess }).process
    const runtimeEnv = runtimeProcess?.env
    const databaseUrl = runtimeEnv?.DATABASE_URL
    const anthropicApiKey = runtimeEnv?.ANTHROPIC_API_KEY
    if (!databaseUrl || !anthropicApiKey) throw new Error('Draft worker is not configured')
    const db = connect(databaseUrl)
    const [draft] = await db
      .select({ kind: drafts.kind })
      .from(drafts)
      .where(eq(drafts.id, draftId))
    if (draft?.kind === 'diagram') {
      await processDiagramDraft(db, draftId, createAnthropicDiagramDraftModel(anthropicApiKey))
      return
    }
    await processPlanDraft(db, draftId, createAnthropicDraftModel(anthropicApiKey))
  },
})
