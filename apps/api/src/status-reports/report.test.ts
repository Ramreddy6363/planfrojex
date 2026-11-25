import { describe, expect, it } from 'vitest'
import { buildStatusReport, renderStatusEmail, type StatusFacts } from './report'

const facts = {
  projectName: 'Customer portal rebuild',
  targetDate: '2026-12-12',
  week: '2026-10-12',
  asOf: '2026-11-27',
  planUrl: 'https://plan.example/northwind/projects/portal/plan',
  milestones: [
    {
      id: 'billing',
      code: 'M2',
      title: 'Billing details and invoices',
      dueDate: '2026-11-27',
      oldDueDate: '2026-11-21',
      done: 4,
      total: 14,
      status: 'in_progress',
    },
  ],
  findings: [],
  decisions: [],
  upcomingTasks: ['Finish the sign-in page'],
  openRisks: ['SSO contract'],
} satisfies StatusFacts

describe('weekly status copy', () => {
  it('describes a week with no drift as on track and provides a no-decisions state', () => {
    const report = buildStatusReport(facts)
    expect(report.status).toBe('on_track')
    expect(report.subject).toBe('Customer portal rebuild: on track, week of Oct 12')
    expect(report.body.summary).toMatch(/on track/i)
    expect(report.body.nextWeek).toContain('Finish the sign-in page')
    expect(report.body.nextWeek).toContain('SSO contract')
    const message = renderStatusEmail(report, 'https://api.example/public/unsubscribe/test')
    expect(message.text).toContain('No decisions this week.')
    expect(message.html).toContain('No decisions this week.')
    expect(message.html).toContain('was Nov 21')
    expect(message.html).toContain('4/14')
    expect(message.html).toContain('Open the plan')
    expect(message.html).toContain('Unsubscribe')
  })

  it('describes six days of milestone drift and imported tasks as at risk', () => {
    const report = buildStatusReport({
      ...facts,
      findings: [
        {
          kind: 'milestone_late',
          milestoneId: 'billing',
          code: 'M2',
          title: 'Billing details and invoices',
          dueDate: '2026-11-21',
          daysLate: 6,
          done: 4,
          total: 14,
        },
        {
          kind: 'linear_tasks',
          milestoneId: 'billing',
          milestoneCode: 'M2',
          tasks: [{ id: 'todo', key: 'PORT-51', title: 'Send invoice' }],
        },
      ],
    })
    expect(report.status).toBe('at_risk')
    expect(report.body.summary).toContain('6 days behind')
    expect(report.body.summary).toContain('4 of 14 tasks done')
    expect(report.body.summary).toContain('Linear')
    expect(report.body.statusDetail).toContain('M2 moved to Nov 27')
  })

  it('reports an unfinished milestone a week overdue as off track', () => {
    const [milestone] = facts.milestones
    if (!milestone) throw new Error('Missing fixture milestone')
    const report = buildStatusReport({
      ...facts,
      milestones: [{ ...milestone, dueDate: '2026-11-20' }],
    })
    expect(report.status).toBe('off_track')
    expect(report.subject).toContain('off track')
    expect(report.body.summary).toContain('7 days behind')
  })

  it('escapes user content and keeps link secrets out of the snapshot', () => {
    const report = buildStatusReport({
      ...facts,
      projectName: '<script>alert(1)</script>',
      decisions: ['Maya accepted <img src=x onerror=alert(1)>'],
    })
    const link = 'https://api.example/public/unsubscribe/test'
    const email = renderStatusEmail(report, link)
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('&lt;img')
    expect(email.text).toContain(link)
    expect(JSON.stringify(report)).not.toContain(link)
  })
})
