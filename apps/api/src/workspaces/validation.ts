import { z } from 'zod'
import { validWorkspaceName, validWorkspaceSlug } from './rules'

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .refine((name) => validWorkspaceName(name)),
  slug: z.string().refine(validWorkspaceSlug),
  isPersonal: z.boolean(),
})

export const inviteSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1).max(20),
  role: z.enum(['editor', 'viewer']),
})
