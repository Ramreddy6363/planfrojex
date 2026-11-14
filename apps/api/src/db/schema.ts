import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  foreignKey,
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
    planUpdatedAt: timestamp('plan_updated_at', { withTimezone: true }),
    planUpdatedBy: text('plan_updated_by').references(() => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('projects_workspace_key_idx').on(t.workspaceId, t.key),
    index('projects_workspace_updated_idx').on(t.workspaceId, t.updatedAt, t.id),
  ],
)

export const planSections = pgTable(
  'plan_sections',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['requirements', 'stories', 'stack', 'estimate'] }).notNull(),
    content: jsonb('content').$type<unknown>().notNull().default(sql`'null'::jsonb`),
    version: integer('version').notNull().default(0),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.kind] })],
)

export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: ['planning', 'in_progress', 'completed'] })
      .notNull()
      .default('planning'),
    dueDate: date('due_date'),
    position: integer('position').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('milestones_project_code_idx').on(t.projectId, t.code),
    uniqueIndex('milestones_project_id_idx').on(t.projectId, t.id),
  ],
)

export const risks = pgTable(
  'risks',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] })
      .notNull()
      .default('medium'),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    decideBy: date('decide_by'),
    ...timestamps(),
  },
  (t) => [
    index('risks_project_idx').on(t.projectId),
    uniqueIndex('risks_project_code_idx').on(t.projectId, t.code),
  ],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id'),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: ['todo', 'in_progress', 'done'] })
      .notNull()
      .default('todo'),
    priority: text('priority', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.milestoneId],
      foreignColumns: [milestones.projectId, milestones.id],
      name: 'tasks_project_milestone_fk',
    }).onDelete('no action'),
    uniqueIndex('tasks_project_number_idx').on(t.projectId, t.number),
    index('tasks_project_status_position_idx').on(t.projectId, t.status, t.position, t.id),
    index('tasks_assignee_idx').on(t.assigneeId),
  ],
)

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    target: text('target', { enum: ['project', 'task'] })
      .notNull()
      .default('project'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    mentions: text('mentions').array().notNull().default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    index('comments_project_created_idx').on(t.projectId, t.createdAt, t.id),
    index('comments_task_created_idx').on(t.taskId, t.createdAt, t.id),
  ],
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
