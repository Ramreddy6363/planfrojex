import { milestones, projects, risks, tasks } from '../db/schema'
import { trackerFixture } from '../integrations/test-fixture'

export async function driftFixture(url: string) {
  const fixture = await trackerFixture(url)
  const { db, workspace } = fixture
  const [project, sibling] = await db
    .insert(projects)
    .values([
      { workspaceId: workspace.id, key: 'PORT', name: 'Portal', brief: { problem: '' } },
      { workspaceId: workspace.id, key: 'SHOP', name: 'Shop', brief: { problem: '' } },
    ])
    .returning()
  if (!project || !sibling) throw new Error('Missing fixture projects')
  const [milestone] = await db
    .insert(milestones)
    .values({ projectId: project.id, code: 'M1', title: 'Billing', dueDate: '2020-11-21' })
    .returning()
  const [risk] = await db
    .insert(risks)
    .values({ projectId: project.id, code: 'R1', title: 'SSO', decideBy: '2020-11-22' })
    .returning()
  if (!milestone || !risk) throw new Error('Missing fixture milestone or risk')
  await db.insert(tasks).values({
    projectId: project.id,
    milestoneId: milestone.id,
    number: 1,
    title: 'Fix billing',
  })
  return {
    ...fixture,
    project,
    sibling,
    milestone,
    risk,
    get: (actor?: string | null) => fixture.request(`/projects/${project.id}/drift`, 'GET', actor),
    action: (body?: unknown, actor?: string | null) =>
      fixture.request(`/projects/${project.id}/drift/check`, 'POST', actor, body),
  }
}
