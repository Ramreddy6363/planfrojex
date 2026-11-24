import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { type ActivityTx, recordReviewActivity } from '../activity/service'
import type { Db } from '../db'
import {
  decisions,
  memberships,
  projects,
  reviewApprovals,
  reviewers,
  reviewRequests,
  shareLinks,
  user,
  workspaces,
} from '../db/schema'
import { readPublicDiagrams, readPublicSnapshot } from '../share/public-snapshot'

const day = 24 * 60 * 60 * 1000
const bytes = new TextEncoder()
const hex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')

export const hash = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', bytes.encode(value)))
const base64Url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
export const newToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)))

const diagramKey = async (requestId: string, diagramId: string) =>
  `diagram:${base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.encode(`${requestId}:${diagramId}`))))}`

const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

const codeData = (tokenHash: string, code: string) =>
  bytes.encode(`review-code:${tokenHash}:${code}`)

export async function codeHash(secret: string, tokenHash: string, code: string) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), codeData(tokenHash, code)))
}

export async function codeMatches(
  secret: string,
  tokenHash: string,
  code: string,
  expected: string,
) {
  const pairs = expected.match(/.{2}/g) ?? []
  const signature = Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16))
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature, codeData(tokenHash, code))
}

export function newCode() {
  // Drop values above the largest multiple of one million to keep all codes equally likely.
  const values = new Uint32Array(1)
  let value: number
  do {
    value = crypto.getRandomValues(values)[0] ?? 0
  } while (value >= 4_294_000_000)
  return String(value % 1_000_000).padStart(6, '0')
}

export function expiration(now: Date, dueDate: string | null) {
  return new Date(
    Math.max(now.getTime() + 14 * day, dueDate ? Date.parse(`${dueDate}T23:59:59.999Z`) : 0),
  )
}

export async function projectForMember(db: Db, id: string, userId: string, lock = false) {
  const query = db
    .select({
      id: projects.id,
      workspaceId: memberships.workspaceId,
      name: projects.name,
      role: memberships.role,
      requesterName: user.name,
    })
    .from(projects)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
  const [project] = await (lock ? query.for('share', { of: [projects, memberships] }) : query)
  return project
}

type ProjectScope = { id: string; workspaceId: string }

export async function activeLink(db: Db, project: ProjectScope, lock = false) {
  const query = db
    .select({ include: shareLinks.include, tokenHash: shareLinks.tokenHash })
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.projectId, project.id),
        eq(shareLinks.workspaceId, project.workspaceId),
        isNull(shareLinks.revokedAt),
      ),
    )
  const [link] = await (lock ? query.for('share') : query)
  return link
}

export async function requestForMember(db: Db, id: string, userId: string) {
  const [found] = await db
    .select({ id: reviewRequests.id, workspaceId: memberships.workspaceId, role: memberships.role })
    .from(projects)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .innerJoin(
      reviewRequests,
      and(
        eq(reviewRequests.projectId, projects.id),
        eq(reviewRequests.workspaceId, memberships.workspaceId),
      ),
    )
    .where(and(eq(reviewRequests.id, id), isNull(projects.deletedAt)))
    .for('share', { of: [projects, memberships] })
  return found
}

export async function reviewerContext(db: Db, tokenHash: string, lock = false) {
  const lead = alias(user, 'review_lead')
  const sharer = alias(user, 'review_sharer')
  const requester = alias(user, 'review_requester')
  const query = db
    .select({
      project: projects,
      request: reviewRequests,
      reviewer: reviewers,
      link: { include: shareLinks.include },
      requesterName: requester.name,
      sharedBy: sharer.name,
      leadName: lead.name,
      workspaceName: workspaces.name,
    })
    .from(projects)
    .innerJoin(
      reviewRequests,
      and(
        eq(reviewRequests.projectId, projects.id),
        eq(reviewRequests.workspaceId, projects.workspaceId),
      ),
    )
    .innerJoin(reviewers, eq(reviewers.requestId, reviewRequests.id))
    .innerJoin(
      shareLinks,
      and(
        eq(shareLinks.projectId, projects.id),
        eq(shareLinks.workspaceId, projects.workspaceId),
        eq(shareLinks.tokenHash, reviewRequests.shareTokenHash),
      ),
    )
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .leftJoin(lead, eq(lead.id, projects.leadId))
    .leftJoin(sharer, eq(sharer.id, shareLinks.createdBy))
    .leftJoin(requester, eq(requester.id, reviewRequests.createdBy))
    .where(
      and(
        eq(reviewers.tokenHash, tokenHash),
        isNull(projects.deletedAt),
        isNull(shareLinks.revokedAt),
        isNull(reviewRequests.cancelledAt),
        gt(reviewRequests.expiresAt, new Date()),
      ),
    )
  const [found] = await (lock
    ? query.for('no key update', { of: [projects, reviewRequests, reviewers, shareLinks] })
    : query)
  return found
}

export function requestOutput(row: typeof reviewRequests.$inferSelect) {
  return {
    id: row.id,
    dueDate: row.dueDate,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}

type SharedDiagrams = Awaited<ReturnType<typeof readPublicDiagrams>>
type ReviewSection = {
  key: string
  storedKey: string
  label: string
  kind: 'brief' | 'milestones' | 'diagram'
  revision: string
}
function sectionKeys(includes: string[], diagrams: SharedDiagrams) {
  return [
    ...(includes.includes('brief') ? ['brief'] : []),
    ...(includes.includes('plan') ? ['milestones'] : []),
    ...diagrams.map(({ id }) => `diagram:${id}`),
  ]
}

export async function projectSectionKeys(db: Db, projectId: string, include: string[]) {
  return sectionKeys(include, await readPublicDiagrams(db, projectId, include))
}

export async function reviewSections(
  requestId: string,
  includes: string[],
  diagrams: SharedDiagrams,
  data: Awaited<ReturnType<typeof readPublicSnapshot>>['data'],
): Promise<ReviewSection[]> {
  const sections: ReviewSection[] = []
  if (includes.includes('brief'))
    sections.push({
      key: 'brief',
      storedKey: 'brief',
      label: 'Brief',
      kind: 'brief',
      revision: await hash(JSON.stringify({ section: 'brief', content: data.brief })),
    })
  if (includes.includes('plan'))
    sections.push({
      key: 'milestones',
      storedKey: 'milestones',
      label: 'Milestones',
      kind: 'milestones',
      revision: await hash(
        JSON.stringify({ section: 'milestones', content: data.plan?.milestones }),
      ),
    })
  for (const { id, diagram } of diagrams)
    sections.push({
      key: await diagramKey(requestId, id),
      storedKey: `diagram:${id}`,
      label: diagram.name,
      kind: 'diagram',
      revision: await hash(JSON.stringify({ section: `diagram:${id}`, content: diagram })),
    })
  return sections
}

export const reviewRevision = (sections: ReviewSection[]) =>
  hash(
    JSON.stringify(sections.map(({ storedKey, revision }) => ({ section: storedKey, revision }))),
  )

export async function requestProgress(db: Db, project: ProjectScope) {
  const scope = and(
    eq(reviewRequests.projectId, project.id),
    eq(reviewRequests.workspaceId, project.workspaceId),
  )
  const [link, requests] = await Promise.all([
    activeLink(db, project),
    db
      .select()
      .from(reviewRequests)
      .where(scope)
      .orderBy(desc(reviewRequests.createdAt), desc(reviewRequests.id)),
  ])
  if (!requests.length) return []
  const [currentProject] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, project.id), eq(projects.workspaceId, project.workspaceId)))
  if (!currentProject) return []
  const snapshot = await readPublicSnapshot(db, {
    project: currentProject,
    link: { include: link?.include ?? [] },
    workspaceName: '',
    sharedBy: null,
    leadName: null,
  })
  const sections = await reviewSections(
    '',
    link?.include ?? [],
    snapshot.sharedDiagrams,
    snapshot.data,
  )
  const [people, approved] = await Promise.all([
    db
      .select({
        id: reviewers.id,
        requestId: reviewers.requestId,
        email: reviewers.email,
        verifiedAt: reviewers.verifiedAt,
      })
      .from(reviewers)
      .innerJoin(reviewRequests, eq(reviewRequests.id, reviewers.requestId))
      .where(scope)
      .orderBy(asc(reviewers.email)),
    db
      .select({
        reviewerId: reviewApprovals.reviewerId,
        section: reviewApprovals.section,
        revision: reviewApprovals.revision,
      })
      .from(reviewApprovals)
      .innerJoin(reviewers, eq(reviewers.id, reviewApprovals.reviewerId))
      .innerJoin(reviewRequests, eq(reviewRequests.id, reviewers.requestId))
      .where(and(scope, eq(reviewApprovals.outcome, 'approved'))),
  ])
  const currentRevisions = new Map(sections.map((section) => [section.storedKey, section.revision]))
  const approvedCount = new Map<string, number>()
  for (const row of approved) {
    if (currentRevisions.get(row.section) === row.revision)
      approvedCount.set(row.reviewerId, (approvedCount.get(row.reviewerId) ?? 0) + 1)
  }
  return requests.map((request) => ({
    ...requestOutput(request),
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
    reviewers: people
      .filter((person) => person.requestId === request.id)
      .map((person) => ({
        id: person.id,
        email: person.email,
        verifiedAt: person.verifiedAt?.toISOString() ?? null,
        approvedCount: approvedCount.get(person.id) ?? 0,
        totalSections: sections.length,
      })),
  }))
}

type ReviewAction = {
  section: string
  outcome: 'approved' | 'changes_requested'
  comment?: string
  revision: string
}
type ReviewerContext = NonNullable<Awaited<ReturnType<typeof reviewerContext>>>

export async function currentApprovals(db: Db, reviewerId: string) {
  return db.select().from(reviewApprovals).where(eq(reviewApprovals.reviewerId, reviewerId))
}

export async function writeApproval(
  tx: ActivityTx,
  context: ReviewerContext,
  action: ReviewAction,
) {
  const snapshot = await readPublicSnapshot(tx, context)
  const sections = await reviewSections(
    context.request.id,
    context.link.include,
    snapshot.sharedDiagrams,
    snapshot.data,
  )
  const revision = await reviewRevision(sections)
  const all = action.section === 'all'
  const currentRevision = all
    ? revision
    : sections.find((section) => section.key === action.section)?.revision
  if (!currentRevision || currentRevision !== action.revision) return { stale: true as const }
  const affected = all
    ? action.outcome === 'approved'
      ? sections
      : [{ storedKey: 'all', label: 'Plan', kind: 'plan' as const, revision }]
    : sections.filter((section) => section.key === action.section)
  if (!affected.length) return { stale: true as const }

  const existing = new Map(
    (await currentApprovals(tx, context.reviewer.id)).map((row) => [row.section, row]),
  )
  const comment = action.comment ?? null
  const changed = affected.filter(({ storedKey, revision }) => {
    const row = existing.get(storedKey)
    return (
      !row || row.revision !== revision || row.outcome !== action.outcome || row.comment !== comment
    )
  })
  if (changed.length) {
    const now = new Date()
    await tx
      .insert(reviewApprovals)
      .values(
        changed.map(({ storedKey, revision }) => ({
          reviewerId: context.reviewer.id,
          section: storedKey,
          revision,
          outcome: action.outcome,
          comment,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [reviewApprovals.reviewerId, reviewApprovals.section],
        set: {
          outcome: action.outcome,
          comment,
          revision: sql`excluded.revision`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
    await tx.insert(decisions).values(
      changed.map(({ kind }) => ({
        projectId: context.project.id,
        kind,
        outcome: action.outcome,
        reason: comment,
      })),
    )
    await recordReviewActivity(tx, {
      reviewerId: context.reviewer.id,
      type: action.outcome === 'approved' ? 'review.approved' : 'review.changes_requested',
      payload: { section: all ? 'Plan' : affected[0]?.label, after: action.outcome, comment },
    })
  }
  const rows = await currentApprovals(tx, context.reviewer.id)
  const approved = new Map(
    rows.filter((row) => row.outcome === 'approved').map((row) => [row.section, row.revision]),
  )
  return {
    approvedCount: sections.filter(
      ({ storedKey, revision }) => approved.get(storedKey) === revision,
    ).length,
    totalSections: sections.length,
  }
}
