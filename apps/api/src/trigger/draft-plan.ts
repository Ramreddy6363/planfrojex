import { task } from '@trigger.dev/sdk'
import { connect } from '../db'
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
    await processPlanDraft(
      connect(databaseUrl),
      draftId,
      createAnthropicDraftModel(anthropicApiKey),
    )
  },
})
