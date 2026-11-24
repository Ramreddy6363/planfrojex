const severities = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof severities)[number]

type Milestone = {
  id: string
  code: string
  title: string
  dueDate: string | null
  status: 'planning' | 'in_progress' | 'completed'
  done: number
  total: number
}
type Risk = {
  id: string
  code: string
  title: string
  severity: Severity
  decideBy: string | null
  ownerName: string | null
}
export type DriftTask = { id: string; key: string; title: string }
type ImportedTask = DriftTask & { milestoneId: string | null; sourceMilestoneId: string | null }
export type DriftFacts = {
  milestones: Milestone[]
  risks: Risk[]
  importedTasks: ImportedTask[]
  linearConnected: boolean
}
export type DriftFinding =
  | {
      kind: 'milestone_late'
      milestoneId: string
      code: string
      title: string
      dueDate: string
      done: number
      total: number
      daysLate: number
    }
  | {
      kind: 'linear_tasks'
      milestoneId: string | null
      milestoneCode: string | null
      tasks: DriftTask[]
    }
  | {
      kind: 'risk_overdue'
      riskId: string
      code: string
      title: string
      decideBy: string
      severity: Severity
    }
export type ProposedChange =
  | {
      kind: 'milestone_date'
      targetId: string
      code: string
      title: string
      before: string
      after: string
    }
  | {
      kind: 'milestone_tasks'
      targetId: string
      code: string
      title: string
      tasks: DriftTask[]
    }
  | {
      kind: 'risk_severity'
      targetId: string
      code: string
      title: string
      before: Severity
      after: Severity
      decideBy: string
      ownerName: string | null
    }

const millisecondsPerDay = 86_400_000
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id)

export function evaluateDrift(facts: DriftFacts, now: Date) {
  const today = now.toISOString().slice(0, 10)
  const findings: DriftFinding[] = []
  const changes: ProposedChange[] = []
  const milestones = [...facts.milestones].sort(byId)
  for (const milestone of milestones) {
    const { id, code, title, dueDate, status, done, total } = milestone
    if (!dueDate || status === 'completed' || done >= total) continue
    const daysLate = (Date.parse(today) - Date.parse(dueDate)) / millisecondsPerDay
    if (daysLate < 2) continue
    findings.push({
      kind: 'milestone_late',
      milestoneId: id,
      code,
      title,
      dueDate,
      done,
      total,
      daysLate,
    })
    changes.push({
      kind: 'milestone_date',
      targetId: id,
      code,
      title,
      before: dueDate,
      after: today,
    })
  }

  if (facts.linearConnected) {
    const byMilestone = new Map(milestones.map((milestone) => [milestone.id, milestone]))
    const groups = new Map<string | null, DriftTask[]>()
    for (const task of [...facts.importedTasks].sort(byId)) {
      if (task.milestoneId) continue
      const source = task.sourceMilestoneId ? byMilestone.get(task.sourceMilestoneId) : undefined
      const id = source?.id ?? null
      const group = groups.get(id) ?? []
      group.push({ id: task.id, key: task.key, title: task.title })
      groups.set(id, group)
    }
    for (const [id, tasks] of groups) {
      const milestone = id ? byMilestone.get(id) : undefined
      findings.push({
        kind: 'linear_tasks',
        milestoneId: id,
        milestoneCode: milestone?.code ?? null,
        tasks,
      })
      if (milestone && milestone.status !== 'completed')
        changes.push({
          kind: 'milestone_tasks',
          targetId: milestone.id,
          code: milestone.code,
          title: milestone.title,
          tasks,
        })
    }
  }

  for (const risk of [...facts.risks].sort(byId)) {
    const { id, code, title, severity, decideBy, ownerName } = risk
    if (!decideBy || decideBy >= today) continue
    findings.push({ kind: 'risk_overdue', riskId: id, code, title, severity, decideBy })
    const next = severities[severities.indexOf(severity) + 1]
    if (next)
      changes.push({
        kind: 'risk_severity',
        targetId: id,
        code,
        title,
        before: severity,
        after: next,
        decideBy,
        ownerName,
      })
  }
  return { findings, changes }
}

export function findingsFingerprint(findings: DriftFinding[]) {
  return JSON.stringify(
    findings
      .map((finding) => {
        if (finding.kind === 'milestone_late')
          return [finding.kind, finding.milestoneId, finding.dueDate, finding.done, finding.total]
        if (finding.kind === 'linear_tasks')
          return [finding.kind, finding.milestoneId, finding.tasks.map(({ id }) => id).sort()]
        // Raising severity does not resolve an overdue decision.
        return [finding.kind, finding.riskId, finding.decideBy]
      })
      .map((item) => JSON.stringify(item))
      .sort(),
  )
}
