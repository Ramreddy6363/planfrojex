import { activity, milestones, projects, reviewRequests, shareLinks, tasks } from '../db/schema'
import { trackerFixture } from '../integrations/test-fixture'

export const monday = new Date('2026-11-23T09:00:00Z')
export const lastFriday = new Date('2026-11-20T12:00:00Z')

export async function statusFixture(url: string) {
  const fixture = await trackerFixture(url)
  const { db, workspace, other } = fixture
  const [project, quiet, archived, foreign] = await db
    .insert(projects)
    .values([
      {
        workspaceId: workspace.id,
        key: 'WP',
        name: 'Weekly portal',
        status: 'in-progress',
        brief: { problem: '' },
      },
      {
        workspaceId: workspace.id,
        key: 'QUIET',
        name: 'Quiet',
        status: 'in-progress',
        brief: { problem: '' },
      },
      {
        workspaceId: workspace.id,
        key: 'OLD',
        name: 'Archived',
        status: 'archived',
        brief: { problem: '' },
      },
      {
        workspaceId: other.id,
        key: 'SECRET',
        name: 'Other project',
        status: 'in-progress',
        brief: { problem: '' },
      },
    ])
    .returning()
  if (!project || !quiet || !archived || !foreign) throw new Error('Missing status projects')
  const addActivity = async (date: Date, projectId = project.id, workspaceId = workspace.id) =>
    db
      .insert(activity)
      .values({ projectId, workspaceId, type: 'plan.section_edited', payload: {}, createdAt: date })
  await addActivity(lastFriday)
  await addActivity(lastFriday, archived.id)
  await addActivity(new Date('2026-11-15T23:59:00Z'), quiet.id)
  const [milestone] = await db
    .insert(milestones)
    .values({
      projectId: project.id,
      code: 'M2',
      title: 'Billing',
      dueDate: '2026-11-26',
    })
    .returning()
  if (!milestone) throw new Error('Missing milestone')
  await db.insert(tasks).values([
    {
      projectId: project.id,
      milestoneId: milestone.id,
      number: 1,
      title: 'Send invoice',
      dueDate: '2026-11-26',
    },
    {
      projectId: project.id,
      milestoneId: milestone.id,
      number: 2,
      title: 'Update invoice',
      status: 'done',
    },
    {
      projectId: foreign.id,
      number: 1,
      title: 'SECRET Other workspace task',
      dueDate: '2026-11-26',
    },
  ])
  const addReview = async () => {
    const shareTokenHash = 'status-fixture-share-hash'
    await db.insert(shareLinks).values({
      workspaceId: workspace.id,
      projectId: project.id,
      tokenHash: shareTokenHash,
      include: ['brief', 'plan'],
    })
    const [review] = await db
      .insert(reviewRequests)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        shareTokenHash,
        expiresAt: new Date('2026-12-31T00:00:00Z'),
      })
      .returning()
    if (!review) throw new Error('Missing review')
    return review
  }
  const path = `/projects/${project.id}/status-reports`
  return {
    ...fixture,
    project,
    quiet,
    archived,
    foreign,
    milestone,
    addActivity,
    addReview,
    list: (user?: string | null) => fixture.request(path, 'GET', user),
    preview: (user?: string | null) => fixture.request(`${path}/preview`, 'POST', user),
  }
}
