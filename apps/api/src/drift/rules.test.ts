import { describe, expect, it } from 'vitest'
import { evaluateDrift, findingsFingerprint } from './rules'

const now = new Date('2026-11-27T02:00:00Z')
const milestone = {
  id: 'milestone',
  code: 'M2',
  title: 'Billing',
  dueDate: '2026-11-25',
  status: 'in_progress' as const,
  done: 4,
  total: 11,
}
const risk = {
  id: 'risk',
  code: 'R1',
  title: 'SSO contract',
  severity: 'medium' as const,
  decideBy: '2026-11-26',
  ownerName: 'Maya',
}
const task = { id: 'task', key: 'PORT-51', title: 'Billing change' }
const empty = { milestones: [], risks: [], importedTasks: [], linearConnected: false }

describe('drift rules', () => {
  it('flags unfinished milestones at two UTC calendar days late, but not one day late', () => {
    expect(
      evaluateDrift({ ...empty, milestones: [{ ...milestone, dueDate: '2026-11-26' }] }, now)
        .findings,
    ).toEqual([])
    const plan = evaluateDrift({ ...empty, milestones: [milestone] }, now)
    expect(plan.findings).toEqual([
      {
        kind: 'milestone_late',
        milestoneId: milestone.id,
        code: 'M2',
        title: 'Billing',
        dueDate: '2026-11-25',
        done: 4,
        total: 11,
        daysLate: 2,
      },
    ])
    expect(plan.changes).toMatchObject([
      { kind: 'milestone_date', before: '2026-11-25', after: '2026-11-27' },
    ])
  })

  it('skips milestones whose tasks are all done, completed milestones, and undated milestones', () => {
    expect(
      evaluateDrift(
        {
          ...empty,
          milestones: [
            { ...milestone, done: 11 },
            { ...milestone, status: 'completed' },
            { ...milestone, dueDate: null },
            { ...milestone, done: 0, total: 0 },
          ],
        },
        now,
      ).findings,
    ).toEqual([])
  })

  it('reports unplanned Linear tasks only when connected and suggests the mapped milestone', () => {
    const input = {
      ...empty,
      milestones: [milestone],
      importedTasks: [
        { ...task, milestoneId: null, sourceMilestoneId: milestone.id },
        {
          ...task,
          id: 'already-planned',
          milestoneId: milestone.id,
          sourceMilestoneId: milestone.id,
        },
        { ...task, id: 'unmapped', key: 'PORT-52', milestoneId: null, sourceMilestoneId: null },
      ],
    }
    expect(evaluateDrift(input, now).findings).toHaveLength(1)
    const plan = evaluateDrift({ ...input, linearConnected: true }, now)
    expect(plan.findings).toContainEqual({
      kind: 'linear_tasks',
      milestoneId: milestone.id,
      milestoneCode: 'M2',
      tasks: [task],
    })
    expect(plan.findings).toContainEqual({
      kind: 'linear_tasks',
      milestoneId: null,
      milestoneCode: null,
      tasks: [{ ...task, id: 'unmapped', key: 'PORT-52' }],
    })
    expect(plan.changes.filter(({ kind }) => kind === 'milestone_tasks')).toMatchObject([
      { code: 'M2', title: 'Billing', tasks: [task] },
    ])
  })

  it('flags risks after the decision date and raises severity without exceeding critical', () => {
    expect(
      evaluateDrift({ ...empty, risks: [{ ...risk, decideBy: '2026-11-27' }] }, now).findings,
    ).toEqual([])
    const plan = evaluateDrift(
      { ...empty, risks: [risk, { ...risk, id: 'critical', severity: 'critical' }] },
      now,
    )
    expect(plan.findings).toHaveLength(2)
    expect(plan.changes).toMatchObject([
      { kind: 'risk_severity', before: 'medium', after: 'high', ownerName: 'Maya' },
    ])
  })

  it('keeps the dismissal fingerprint across passing days but changes it with task progress', () => {
    const input = { ...empty, milestones: [milestone] }
    const first = findingsFingerprint(evaluateDrift(input, now).findings)
    expect(
      findingsFingerprint(evaluateDrift(input, new Date('2026-11-28T02:00:00Z')).findings),
    ).toBe(first)
    expect(
      findingsFingerprint(
        evaluateDrift({ ...input, milestones: [{ ...milestone, done: 5 }] }, now).findings,
      ),
    ).not.toBe(first)
  })
})
