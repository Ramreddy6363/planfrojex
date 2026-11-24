import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
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

export type TrackerOptions = {
  pushMilestones: boolean
  pullStatus: boolean
  importIssues: boolean
}
export type TrackerStatusMapping = Record<
  'planning' | 'in_progress' | 'completed' | 'archived',
  string | null
>
export type TrackerState = { id: string; name: string }

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['linear'] })
      .notNull()
      .default('linear'),
    encryptedCredentials: text('encrypted_credentials'),
    organizationId: text('organization_id'),
    teamId: text('team_id'),
    name: text('name'),
    states: jsonb('states').$type<TrackerState[]>().notNull().default([]),
    statusMapping: jsonb('status_mapping').$type<TrackerStatusMapping>().notNull().default({
      planning: null,
      in_progress: null,
      completed: null,
      archived: null,
    }),
    options: jsonb('options').$type<TrackerOptions>().notNull().default({
      pushMilestones: false,
      pullStatus: true,
      importIssues: false,
    }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    oauthStateHash: text('oauth_state_hash'),
    oauthExpiresAt: timestamp('oauth_expires_at', { withTimezone: true }),
    oauthUserId: text('oauth_user_id').references(() => user.id, { onDelete: 'set null' }),
    webhookReceipts: jsonb('webhook_receipts')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('integrations_workspace_provider_idx').on(t.workspaceId, t.provider),
    uniqueIndex('integrations_oauth_state_idx').on(t.oauthStateHash),
    index('integrations_provider_org_idx').on(t.provider, t.organizationId),
  ],
)

export const externalLinks = pgTable(
  'external_links',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    source: text('source', { enum: ['pushed', 'imported'] }).notNull(),
    ...timestamps(),
  },
  (t) => [
    check('external_links_one_target', sql`num_nonnulls(${t.milestoneId}, ${t.taskId}) = 1`),
    uniqueIndex('external_links_integration_external_idx').on(t.integrationId, t.externalId),
    uniqueIndex('external_links_integration_milestone_idx').on(t.integrationId, t.milestoneId),
    uniqueIndex('external_links_integration_task_idx').on(t.integrationId, t.taskId),
  ],
)

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
      .references(() => user.id, { onDelete: 'cascade' }),
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
    leadId: text('lead_id').references(() => user.id, { onDelete: 'set null' }),
    targetDate: date('target_date'),
    brief: jsonb('brief')
      .$type<{ problem: string; goals?: string[]; constraints?: string; outOfScope?: string }>()
      .notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("key", '')), 'A') || setweight(to_tsvector('simple', coalesce("brief", '{}'::jsonb)), 'B') || setweight(to_tsvector('simple', planfrojex_search_tags("tags")), 'C')`,
    ),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    planUpdatedAt: timestamp('plan_updated_at', { withTimezone: true }),
    planUpdatedBy: text('plan_updated_by').references(() => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('projects_workspace_key_idx').on(t.workspaceId, t.key),
    index('projects_workspace_updated_idx').on(t.workspaceId, t.updatedAt, t.id),
    index('projects_search_idx').using('gin', t.search),
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
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce("title", '')), 'A') || setweight(to_tsvector('simple', coalesce("description", '')), 'B')`,
    ),
    status: text('status', { enum: ['todo', 'in_progress', 'done'] })
      .notNull()
      .default('todo'),
    priority: text('priority', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    assigneeDeleted: boolean('assignee_deleted').notNull().default(false),
    dueDate: date('due_date'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
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
    index('tasks_assignee_status_due_date_idx').on(t.assigneeId, t.status, t.dueDate),
    index('tasks_created_by_status_idx').on(t.createdBy, t.status),
    index('tasks_search_idx').using('gin', t.search),
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
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    mentions: text('mentions').array().notNull().default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    index('comments_project_created_idx').on(t.projectId, t.createdAt, t.id),
    index('comments_task_created_idx').on(t.taskId, t.createdAt, t.id),
  ],
)

export const diagrams = pgTable(
  'diagrams',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['flowchart', 'architecture', 'sequence', 'entity_relationship'],
    }).notNull(),
    currentVersion: integer('current_version').notNull().default(0),
    scene: jsonb('scene').$type<unknown>().notNull().default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
    sceneVersion: integer('scene_version').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('diagrams_project_idx').on(t.projectId, t.deletedAt)],
)

export const diagramVersions = pgTable(
  'diagram_versions',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    scene: jsonb('scene').$type<unknown>().notNull(),
    label: text('label'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('diagram_versions_diagram_version_idx').on(t.diagramId, t.version)],
)

export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    diagramId: uuid('diagram_id').references(() => diagrams.id, { onDelete: 'set null' }),
    prompt: text('prompt'),
    kind: text('kind', { enum: ['plan', 'diagram'] })
      .notNull()
      .default('plan'),
    status: text('status', { enum: ['queued', 'running', 'ready', 'failed', 'discarded'] })
      .notNull()
      .default('queued'),
    model: text('model').notNull(),
    error: text('error'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('drafts_project_created_idx').on(t.projectId, t.createdAt, t.id)],
)

export const draftChanges = pgTable(
  'draft_changes',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['requirements', 'stories', 'milestones', 'risks', 'stack', 'estimate', 'diagram'],
    }).notNull(),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>().notNull(),
    appliedSnapshot: jsonb('applied_snapshot').$type<unknown>(),
    baseVersion: integer('base_version'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('draft_changes_draft_kind_idx').on(t.draftId, t.kind)],
)

export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    draftChangeId: uuid('draft_change_id').references(() => draftChanges.id, {
      onDelete: 'set null',
    }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind', {
      enum: [
        'requirements',
        'stories',
        'milestones',
        'risks',
        'stack',
        'estimate',
        'diagram',
        'brief',
        'plan',
      ],
    }).notNull(),
    outcome: text('outcome', {
      enum: ['accepted', 'rejected', 'reversed', 'approved', 'changes_requested'],
    }).notNull(),
    reason: text('reason'),
    reversesDecisionId: uuid('reverses_decision_id'),
    ...timestamps(),
  },
  (t) => [
    index('decisions_project_created_idx').on(t.projectId, t.createdAt, t.id),
    uniqueIndex('decisions_reverse_once_idx').on(t.reversesDecisionId),
    foreignKey({
      columns: [t.reversesDecisionId],
      foreignColumns: [t.id],
      name: 'decisions_reverses_decision_id_decisions_id_fk',
    }).onDelete('set null'),
  ],
)

export const activity = pgTable(
  'activity',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    subject: text('subject'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('activity_project_created_idx').on(t.projectId, t.createdAt.desc(), t.id)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['mention', 'assigned', 'reply', 'draft_decision', 'review_decision'],
    }).notNull(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activity.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('notifications_user_activity_type_idx').on(t.userId, t.activityId, t.type),
    index('notifications_user_workspace_read_created_idx').on(
      t.userId,
      t.workspaceId,
      t.readAt,
      t.createdAt.desc(),
    ),
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

export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['mention', 'assigned', 'draft_ready', 'drift', 'weekly_summary'],
    }).notNull(),
    email: boolean('email').notNull(),
    inApp: boolean('in_app').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
)

export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  include: text('include').array().notNull(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    shareTokenHash: text('share_token_hash').notNull(),
    dueDate: date('due_date'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('review_requests_project_created_idx').on(t.projectId, t.createdAt, t.id)],
)

export const reviewers = pgTable(
  'reviewers',
  {
    id: uuid('id').primaryKey().default(sql`planfrojex_uuidv7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => reviewRequests.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationCodeHash: text('verification_code_hash'),
    verificationCodeExpiresAt: timestamp('verification_code_expires_at', { withTimezone: true }),
    verificationAttempts: integer('verification_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('reviewers_request_email_idx').on(t.requestId, t.email)],
)

export const reviewApprovals = pgTable(
  'review_approvals',
  {
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => reviewers.id, { onDelete: 'cascade' }),
    section: text('section').notNull(),
    revision: text('revision').notNull(),
    outcome: text('outcome', { enum: ['approved', 'changes_requested'] }).notNull(),
    comment: text('comment'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.reviewerId, t.section] })],
)
