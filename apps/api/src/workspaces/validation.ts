import { z } from 'zod'
import { nameHasLink, reservedSlugs } from './rules'

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((name) => !nameHasLink(name)),
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((slug) => !reservedSlugs.has(slug)),
  isPersonal: z.boolean(),
})

export const inviteSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1).max(20),
  role: z.enum(['editor', 'viewer']),
})
