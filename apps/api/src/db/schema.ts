import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('avatar_url'),
  timezone: text('timezone'),
  ...timestamps(),
})
export const session = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)
export const account = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    ...timestamps(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
)
export const verification = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  isPersonal: boolean('is_personal').notNull().default(false),
  logo: text('logo'),
  ...timestamps(),
})
export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('memberships_user_id_idx').on(t.userId),
  ],
)
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['editor', 'viewer'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'revoked'] })
      .notNull()
      .default('pending'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('invites_pending_email_idx')
      .on(t.workspaceId, t.email)
      .where(sql`${t.status} = 'pending'`),
  ],
)
export const rateLimit = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('title').notNull(),
    status: text('status', { enum: ['draft', 'planning', 'in-progress', 'completed', 'archived'] })
      .notNull()
      .default('draft'),
    leadId: text('lead_id')
      .notNull()
      .references(() => user.id),
    targetDate: date('target_date'),
    brief: jsonb('brief')
      .$type<{ problem: string; goals?: string[]; constraints?: string; outOfScope?: string }>()
      .notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('projects_workspace_key_idx').on(t.workspaceId, t.key),
    index('projects_workspace_updated_idx').on(t.workspaceId, t.updatedAt, t.id),
  ],
)

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    target: text('target', { enum: ['project'] })
      .notNull()
      .default('project'),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    mentions: text('mentions').array().notNull().default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [index('comments_project_created_idx').on(t.projectId, t.createdAt, t.id)],
)

export const stars = pgTable(
  'stars',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
)
