import type { Page } from '@playwright/test'
import { webOrigin } from './test-origin'

const headers = {
  'access-control-allow-origin': webOrigin(),
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const preview = {
  week: '2025-10-13',
  status: 'at_risk',
  subject: 'Customer portal rebuild: at risk, week of Oct 13',
  body: {
    projectName: 'Customer portal rebuild',
    summary:
      'Sign-in work is on track. Billing is 6 days behind after three invoice tasks were added this week, so the team moved M2 by six days and kept the launch date. The SSO contract is the open risk.',
    statusDetail: 'Launch still Dec 12. M2 moved to Nov 27.',
    milestones: [
      {
        code: 'M1',
        title: 'Sign-in, SSO and account settings',
        dueDate: '2025-10-31',
        oldDueDate: null,
        done: 9,
        total: 14,
      },
      {
        code: 'M2',
        title: 'Billing details and invoices',
        dueDate: '2025-11-27',
        oldDueDate: '2025-11-21',
        done: 4,
        total: 14,
      },
      {
        code: 'M3',
        title: 'Teammates and public launch',
        dueDate: '2025-12-12',
        oldDueDate: null,
        done: 0,
        total: 9,
      },
    ],
    decisions: [
      'Moved M2 to Nov 27 and kept the launch date. Maya Chen, Oct 13',
      'Accepted the Milestones section. Sofia Alvarez, Oct 12',
      'Raised R1 SSO contract to High. Maya Chen, Oct 13',
    ],
    nextWeek:
      'Finish the sign-in page, set up SAML connections, and get a decision on the SSO contract.',
  },
}

const sent = {
  ...preview,
  id: '8eb27814-e73b-4d7c-94b0-b13835460577',
  week: '2025-10-06',
  status: 'on_track',
  subject: 'Customer portal rebuild: on track, week of Oct 6',
  sentAt: '2025-10-06T09:00:00.000Z',
  recipientsCount: 2,
  body: {
    ...preview.body,
    summary: 'Milestones are on track for the planned dates.',
    statusDetail: null,
    milestones: [],
    decisions: [],
  },
}

export async function mockStatusEmail(page: Page, projectId: string) {
  const path = `http://localhost:8787/projects/${projectId}/status-reports`
  const planUrl = `/northwind/projects/${projectId}/plan`
  const withPlanUrl = (report: typeof preview | typeof sent) => ({
    ...report,
    body: { ...report.body, planUrl },
  })
  const requests: string[] = []
  await page.route(path, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    requests.push(route.request().method())
    return route.fulfill({ headers, json: { reports: [withPlanUrl(sent)] } })
  })
  await page.route(`${path}/preview`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    requests.push(`${route.request().method()} preview`)
    return route.fulfill({ headers, json: { report: withPlanUrl(preview) } })
  })
  return requests
}
