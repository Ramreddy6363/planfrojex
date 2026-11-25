import type { Page } from '@playwright/test'
import type { DriftAction, DriftReport, DriftResult } from '../src/api'
import { webOrigin } from './test-origin'

const reportId = 'd3fa72bc-b233-4682-a721-3a41d8474ae0'
const milestoneId = '61fb8f41-adb4-4f98-844f-70853ec3fade'
const milestoneTitle = 'Billing details and invoice download'
const tasks = [
  { id: 'task-51', key: 'PORT-51', title: 'Add billing address' },
  { id: 'task-52', key: 'PORT-52', title: 'Verify invoice migration' },
  { id: 'task-53', key: 'PORT-53', title: 'Update tax rates' },
]
const findings: DriftReport['findings'] = [
  {
    kind: 'milestone_late',
    milestoneId,
    code: 'M2',
    title: milestoneTitle,
    dueDate: '2026-11-21',
    done: 4,
    total: 11,
    daysLate: 6,
  },
  { kind: 'linear_tasks', milestoneId, milestoneCode: 'M2', tasks },
  {
    kind: 'risk_overdue',
    riskId: 'risk-1',
    code: 'R1',
    title: 'SSO vendor contract',
    decideBy: '2026-10-10',
    severity: 'medium',
  },
]
const changes: DriftReport['changes'] = [
  {
    id: 'date-change',
    kind: 'milestone_date',
    status: 'pending',
    code: 'M2',
    title: milestoneTitle,
    before: '2026-11-21',
    after: '2026-11-27',
  },
  {
    id: 'tasks-change',
    kind: 'milestone_tasks',
    status: 'pending',
    code: 'M2',
    title: milestoneTitle,
    tasks,
  },
  {
    id: 'risk-change',
    kind: 'risk_severity',
    status: 'pending',
    code: 'R1',
    title: 'SSO vendor contract',
    before: 'medium',
    after: 'high',
    ownerName: 'Maya Chen',
  },
]

export async function mockDrift(
  page: Page,
  projectId: string,
  {
    canManage = true,
    linearConnected = true,
    onAccept,
  }: {
    canManage?: boolean
    linearConnected?: boolean
    onAccept?: (reason: string | undefined) => void
  } = {},
) {
  const headers = {
    'access-control-allow-origin': webOrigin(),
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  const report: DriftReport = {
    id: reportId,
    checkedAt: new Date().toISOString(),
    checkedAgainstLinearAt: linearConnected
      ? new Date(Date.now() - 4 * 60_000).toISOString()
      : null,
    findings: findings.filter((item) => linearConnected || item.kind !== 'linear_tasks'),
    changes: changes
      .filter((item) => linearConnected || item.kind !== 'milestone_tasks')
      .map((change) => ({ ...change })),
  }
  let open = true
  const requests: NonNullable<DriftAction>[] = []
  const result = (): DriftResult => ({ report: open ? report : null, linearConnected, canManage })
  await page.route(`http://localhost:8787/projects/${projectId}/drift`, (route) =>
    route.fulfill({ headers, json: result() }),
  )
  await page.route(`http://localhost:8787/projects/${projectId}/drift/check`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
    const body = route.request().postDataJSON() as NonNullable<DriftAction>
    requests.push(body)
    if (body.action === 'accept' || body.action === 'dismiss') open = false
    if (body.action === 'accept') onAccept?.(body.reason)
    if (body.action === 'accept_change' || body.action === 'reject_change') {
      const change = report.changes.find((item) => item.id === body.changeId)
      if (!change) return route.fulfill({ headers, status: 404 })
      change.status = body.action === 'accept_change' ? 'accepted' : 'rejected'
    }
    return route.fulfill({ headers, json: result() })
  })
  return { reportId, requests }
}
