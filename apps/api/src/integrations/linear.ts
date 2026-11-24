import { z } from 'zod'
import type { TrackerState, TrackerStatusMapping } from '../db/schema'
import type { Env } from '../env'
import { type Credentials, digest } from './security'

const graphqlUrl = 'https://api.linear.app/graphql'
const tokenUrl = 'https://api.linear.app/oauth/token'
export const callbackPath = '/integrations/linear/callback'

const id = z.string().min(1).max(128)
const state = z.object({ id, name: z.string().max(200), type: z.string() })
type LinearState = z.infer<typeof state>

export type LinearAccount = {
  organizationId: string
  teamId: string
  name: string
  states: TrackerState[]
  statusMapping: TrackerStatusMapping
}

const date = z.iso.date().nullable()
const projectShape = z.object({
  id,
  name: z.string(),
  targetDate: date,
  lead: z.object({ id }).nullable(),
})
const issueShape = z.object({
  id,
  title: z.string(),
  description: z.string().nullable(),
  dueDate: date,
  updatedAt: z.iso.datetime({ offset: true }),
  state: z.object({ id }),
  project: z.object({ id }).nullable(),
  assignee: z.object({ id }).nullable(),
})
export type LinearProject = {
  id: string
  name: string
  targetDate: string | null
  leadId: string | null
}
export type LinearIssue = {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  stateId: string | null
  projectId: string | null
  assigneeId: string | null
  updatedAt: string
}
type IssueInput = Omit<LinearIssue, 'updatedAt' | 'stateId'> & { stateId?: string }
export type LinearProvider = {
  exchange(code: string, verifier: string, workspaceId: string): Promise<Credentials>
  refresh(refreshToken: string): Promise<Credentials>
  account(token: string, workspaceId: string): Promise<LinearAccount>
  users(token: string, emails: string[]): Promise<Map<string, string>>
  projectsInTeam(token: string, teamId: string, ids: string[]): Promise<LinearProject[]>
  issuesInTeam(
    token: string,
    teamId: string,
    projectIds: string[],
    issueIds: string[],
  ): Promise<LinearIssue[]>
  putProject(token: string, teamId: string, project: LinearProject, exists: boolean): Promise<void>
  putIssue(token: string, teamId: string, issue: IssueInput, exists: boolean): Promise<void>
}

function chooseMapping(states: LinearState[]): TrackerStatusMapping {
  const first = (types: string[]) =>
    types.map((type) => states.find((candidate) => candidate.type === type)).find(Boolean)?.id ??
    null
  return {
    planning: first(['unstarted', 'backlog', 'triage']),
    in_progress: first(['started']),
    completed: first(['completed']),
    archived: first(['canceled']),
  }
}

export async function authorizeUrl(
  env: Env['Bindings'],
  state: string,
  verifier: string,
  fake: boolean,
) {
  const callback = new URL(callbackPath, env.BETTER_AUTH_URL)
  if (fake) {
    callback.search = new URLSearchParams({ code: 'local-linear', state }).toString()
    return callback.href
  }
  const url = new URL('https://linear.app/oauth/authorize')
  url.search = new URLSearchParams({
    client_id: env.LINEAR_CLIENT_ID ?? '',
    redirect_uri: callback.href,
    response_type: 'code',
    scope: 'read,write',
    prompt: 'consent',
    state,
    code_challenge: await digest(verifier),
    code_challenge_method: 'S256',
  }).toString()
  return url.href
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
})
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const projectFields = 'id name targetDate lead { id }'
const issueFields =
  'id title description dueDate updatedAt state { id } project { id } assignee { id }'

function connection<T extends z.ZodType>(node: T) {
  return z.object({ nodes: z.array(node), pageInfo })
}

async function graphql<T extends z.ZodType>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error('Linear API request failed')
  const envelope = z
    .object({ data: z.unknown(), errors: z.array(z.unknown()).max(0).optional() })
    .safeParse(await response.json())
  const parsed = schema.safeParse(envelope.success ? envelope.data.data : undefined)
  if (!parsed.success || !envelope.success)
    throw new Error('Linear API returned an invalid response')
  return parsed.data
}

async function fetchPages<T>(
  fetchPage: (after: string | null) => Promise<{ nodes: T[]; pageInfo: z.infer<typeof pageInfo> }>,
) {
  const values: T[] = []
  let after: string | null = null
  const cursors = new Set<string>()
  do {
    const result = await fetchPage(after)
    values.push(...result.nodes)
    if (!result.pageInfo.hasNextPage) break
    const next = result.pageInfo.endCursor
    if (!next || cursors.has(next)) throw new Error('Invalid Linear pagination')
    cursors.add(next)
    after = next
  } while (after !== null)
  return values
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error('Linear authorization failed')
  const parsed = tokenSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error('Linear returned invalid credentials')
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  }
}

export function createLinearProvider(env: Env['Bindings']): LinearProvider {
  const clientId = env.LINEAR_CLIENT_ID ?? ''
  const clientSecret = env.LINEAR_CLIENT_SECRET ?? ''
  return {
    exchange: (code, verifier) =>
      tokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: new URL(callbackPath, env.BETTER_AUTH_URL).href,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    refresh: (refreshToken) =>
      tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    async account(token) {
      const { organization } = await graphql(
        token,
        'query { organization { id name } }',
        {},
        z.object({ organization: z.object({ id, name: z.string().max(200) }) }),
      )
      const teams = await fetchPages(async (after) => {
        const result = await graphql(
          token,
          'query($after: String) { teams(first: 50, after: $after) { nodes { id key } pageInfo { hasNextPage endCursor } } }',
          { after },
          z.object({ teams: connection(z.object({ id, key: z.string().max(50) })) }),
        )
        return result.teams
      })
      const team = teams.sort((a, b) => a.key.localeCompare(b.key))[0]
      if (!team) throw new Error('Linear account has no accessible team')
      const states = await fetchPages(async (after) => {
        const result = await graphql(
          token,
          'query($teamId: String!, $after: String) { team(id: $teamId) { states(first: 50, after: $after) { nodes { id name type } pageInfo { hasNextPage endCursor } } } }',
          { teamId: team.id, after },
          z.object({ team: z.object({ states: connection(state) }) }),
        )
        return result.team.states
      })
      return {
        organizationId: organization.id,
        teamId: team.id,
        name: `team ${team.key} in ${organization.name}'s Linear workspace`,
        states: states.map(({ id, name }) => ({ id, name })),
        statusMapping: chooseMapping(states),
      }
    },
    async users(token, emails) {
      if (!emails.length) return new Map()
      const values = await fetchPages(async (after) => {
        const result = await graphql(
          token,
          'query($filter: UserFilter!, $after: String) { users(filter: $filter, first: 100, after: $after) { nodes { id email } pageInfo { hasNextPage endCursor } } }',
          { filter: { email: { in: emails }, active: { eq: true } }, after },
          z.object({ users: connection(z.object({ id, email: z.string() })) }),
        )
        return result.users
      })
      return new Map(values.map((user) => [user.email.toLowerCase(), user.id]))
    },
    async projectsInTeam(token, teamId, ids) {
      if (!ids.length) return []
      const values = await fetchPages(async (after) => {
        const result = await graphql(
          token,
          `query($teamId: String!, $filter: ProjectFilter!, $after: String) {
            team(id: $teamId) { projects(filter: $filter, first: 100, after: $after) {
              nodes { ${projectFields} } pageInfo { hasNextPage endCursor }
            } }
          }`,
          { teamId, filter: { id: { in: ids } }, after },
          z.object({ team: z.object({ projects: connection(projectShape) }) }),
        )
        return result.team.projects
      })
      return values.map(({ lead, ...project }) => ({ ...project, leadId: lead?.id ?? null }))
    },
    async issuesInTeam(token, teamId, projectIds, issueIds) {
      if (!projectIds.length && !issueIds.length) return []
      const or = [
        ...(projectIds.length ? [{ project: { id: { in: projectIds } } }] : []),
        ...(issueIds.length ? [{ id: { in: issueIds } }] : []),
      ]
      const values = await fetchPages(async (after) => {
        const result = await graphql(
          token,
          `query($teamId: String!, $filter: IssueFilter!, $after: String) {
            team(id: $teamId) { issues(filter: $filter, first: 100, after: $after) {
              nodes { ${issueFields} } pageInfo { hasNextPage endCursor }
            } }
          }`,
          { teamId, filter: { or }, after },
          z.object({ team: z.object({ issues: connection(issueShape) }) }),
        )
        return result.team.issues
      })
      return values.map(({ project, state, assignee, ...issue }) => ({
        ...issue,
        projectId: project?.id ?? null,
        stateId: state.id,
        assigneeId: assignee?.id ?? null,
      }))
    },
    async putProject(token, teamId, { id, ...input }, exists) {
      if (exists) {
        await graphql(
          token,
          'mutation($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { success } }',
          { id, input },
          z.object({ projectUpdate: z.object({ success: z.literal(true) }) }),
        )
      } else {
        await graphql(
          token,
          'mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { success } }',
          { input: { ...input, id, teamIds: [teamId] } },
          z.object({ projectCreate: z.object({ success: z.literal(true) }) }),
        )
      }
    },
    async putIssue(token, teamId, { id, ...input }, exists) {
      if (exists) {
        await graphql(
          token,
          'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }',
          { id, input },
          z.object({ issueUpdate: z.object({ success: z.literal(true) }) }),
        )
      } else {
        await graphql(
          token,
          'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success } }',
          { input: { ...input, id, teamId } },
          z.object({ issueCreate: z.object({ success: z.literal(true) }) }),
        )
      }
    },
  }
}

export function createFakeLinearProvider() {
  const projects = new Map<string, LinearProject>()
  const issues = new Map<string, LinearIssue>()
  const projectTeams = new Map<string, string>()
  const issueTeams = new Map<string, string>()
  const states = [
    { id: 'fake-todo', name: 'Todo', type: 'unstarted' },
    { id: 'fake-in-progress', name: 'In Progress', type: 'started' },
    { id: 'fake-done', name: 'Done', type: 'completed' },
    { id: 'fake-canceled', name: 'Canceled', type: 'canceled' },
  ]
  const provider: LinearProvider = {
    async exchange(code, _verifier, workspaceId) {
      if (code !== 'local-linear') throw new Error('Invalid local authorization code')
      return {
        accessToken: `fake-linear-token-${workspaceId}`,
        refreshToken: null,
        expiresAt: 8.64e15,
      }
    },
    async refresh() {
      throw new Error('Fake credentials do not expire')
    },
    async account(_token, workspaceId) {
      return {
        organizationId: `fake-org-${workspaceId}`,
        teamId: `fake-team-${workspaceId}`,
        name: "team PORT in Northwind's Linear workspace",
        states: states.map(({ id, name }) => ({ id, name })),
        statusMapping: chooseMapping(states),
      }
    },
    async users(_token, emails) {
      return new Map(emails.map((email) => [email, `fake-user-${email}`]))
    },
    async projectsInTeam(_token, teamId, ids) {
      return ids.flatMap((id) => {
        const project = projects.get(id)
        return project && projectTeams.get(id) === teamId ? [project] : []
      })
    },
    async issuesInTeam(_token, teamId, projectIds, issueIds) {
      return [...issues.values()].filter((issue) => {
        const issueTeam =
          issueTeams.get(issue.id) ??
          (issue.projectId ? projectTeams.get(issue.projectId) : undefined)
        return (
          issueTeam === teamId &&
          (issueIds.includes(issue.id) || (issue.projectId && projectIds.includes(issue.projectId)))
        )
      })
    },
    async putProject(_token, teamId, project) {
      projects.set(project.id, project)
      projectTeams.set(project.id, teamId)
    },
    async putIssue(_token, teamId, issue) {
      issues.set(issue.id, {
        ...issue,
        stateId: issue.stateId ?? issues.get(issue.id)?.stateId ?? 'fake-todo',
        updatedAt: new Date().toISOString(),
      })
      issueTeams.set(issue.id, teamId)
    },
  }
  return { provider, projects, issues }
}
