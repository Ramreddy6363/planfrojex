import { z } from '@hono/zod-openapi'
import { type DriftFinding, evaluateDrift } from '../drift/rules'

export const statusValues = ['on_track', 'at_risk', 'off_track'] as const
export const statusSchema = z.enum(statusValues)
export const bodySchema = z.object({
  projectName: z.string(),
  summary: z.string(),
  statusDetail: z.string().nullable(),
  milestones: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      dueDate: z.iso.date().nullable(),
      oldDueDate: z.iso.date().nullable(),
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  decisions: z.array(z.string()),
  nextWeek: z.string(),
  planUrl: z.httpUrl(),
})
export const reportSchema = z.object({
  week: z.iso.date(),
  status: statusSchema,
  subject: z.string(),
  body: bodySchema,
})
export type StatusReport = z.infer<typeof reportSchema>

export type StatusMilestone = {
  id: string
  code: string
  title: string
  dueDate: string | null
  oldDueDate: string | null
  done: number
  total: number
  status: 'planning' | 'in_progress' | 'completed'
}
export type StatusFacts = {
  projectName: string
  targetDate: string | null
  week: string
  asOf: string
  planUrl: string
  milestones: StatusMilestone[]
  findings: DriftFinding[]
  decisions: string[]
  upcomingTasks: string[]
  openRisks: string[]
}

const statuses = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' } as const
const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const list = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' })
export const formatReportDate = (value: string | Date) => monthDay.format(new Date(value))

function findingSentence(finding: DriftFinding) {
  switch (finding.kind) {
    case 'milestone_late':
      return `${finding.code} ${finding.title} is ${finding.daysLate} days behind, with ${finding.done} of ${finding.total} tasks done.`
    case 'linear_tasks':
      return finding.tasks.length === 1
        ? 'Linear has 1 new task outside the plan.'
        : `Linear has ${finding.tasks.length} new tasks outside the plan.`
    case 'risk_overdue':
      return `${finding.code} ${finding.title} still needs a decision, due ${formatReportDate(finding.decideBy)}.`
  }
}

export function buildStatusReport(facts: StatusFacts): StatusReport {
  const { projectName, week, asOf, targetDate, planUrl, milestones, decisions } = facts
  const currentLate = evaluateDrift(
    { milestones, risks: [], importedTasks: [], linearConnected: false },
    new Date(asOf),
  ).findings
  const findings = [
    ...facts.findings.filter(
      (finding) =>
        finding.kind !== 'milestone_late' ||
        !currentLate.some(
          (current) =>
            current.kind === 'milestone_late' && current.milestoneId === finding.milestoneId,
        ),
    ),
    ...currentLate,
  ]
  const missedTarget = Boolean(
    targetDate &&
      targetDate < asOf &&
      milestones.some(({ status, done, total }) => status !== 'completed' && done < total),
  )
  const severeDrift = findings.some(
    (finding) =>
      (finding.kind === 'milestone_late' && finding.daysLate >= 7) ||
      (finding.kind === 'risk_overdue' && finding.severity === 'critical'),
  )
  const status =
    missedTarget || severeDrift ? 'off_track' : findings.length ? 'at_risk' : 'on_track'
  const statusDetails = [
    targetDate && `Launch ${missedTarget ? 'was due' : 'still'} ${formatReportDate(targetDate)}.`,
    ...milestones.flatMap(({ code, dueDate, oldDueDate }) =>
      dueDate && oldDueDate && dueDate !== oldDueDate
        ? [`${code} moved to ${formatReportDate(dueDate)}.`]
        : [],
    ),
  ].filter(Boolean)
  const summary =
    [
      missedTarget
        ? `The project missed its ${formatReportDate(targetDate as string)} target date.`
        : '',
      ...findings.map(findingSentence),
    ]
      .filter(Boolean)
      .join(' ') || 'The plan is on track. No drift was found in the milestones, tasks, or risks.'
  const next = [
    facts.upcomingTasks.length ? `Due tasks: ${list.format(facts.upcomingTasks)}.` : '',
    facts.openRisks.length ? `Open risks: ${list.format(facts.openRisks)}.` : '',
  ].filter(Boolean)
  return {
    week,
    status,
    subject: `${projectName.replace(/\s+/g, ' ').trim()}: ${statuses[status].toLowerCase()}, week of ${formatReportDate(week)}`,
    body: {
      projectName,
      summary,
      statusDetail: statusDetails.join(' ') || null,
      milestones: milestones.map(({ code, title, dueDate, oldDueDate, done, total }) => ({
        code,
        title,
        dueDate,
        oldDueDate,
        done,
        total,
      })),
      decisions,
      nextWeek: next.join(' ') || 'No tasks are due next week, and there are no open risks.',
      planUrl,
    },
  }
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => entities[character] ?? '')

// Email clients need literal fallbacks for the app's light theme tokens.
const palette = {
  bg: 'rgb(255,255,255)',
  subtle: 'rgb(247,247,245)',
  muted: 'rgb(239,239,236)',
  border: 'rgb(228,228,224)',
  text: 'rgb(26,26,24)',
  mutedText: 'rgb(107,107,102)',
  accent: 'rgb(37,80,201)',
  success: 'rgb(31,122,77)',
  warning: 'rgb(161,92,7)',
  danger: 'rgb(196,50,31)',
}
const deliveryNote = 'Written from the plan and tracker activity. Sent every Monday.'
const noDecisions = 'No decisions this week.'
const dateLabel = (dueDate: string | null, oldDueDate: string | null) =>
  dueDate
    ? `${formatReportDate(dueDate)}${oldDueDate && oldDueDate !== dueDate ? `  (was ${formatReportDate(oldDueDate)})` : ''}`
    : 'No due date'

export function renderStatusEmail(report: StatusReport, unsubscribeUrl: string) {
  const { body, week, status, subject } = report
  const { projectName, summary, statusDetail, milestones, decisions, nextWeek, planUrl } = body
  const weekLabel = `Week of ${formatReportDate(week)}`
  const tone = { on_track: palette.success, at_risk: palette.warning, off_track: palette.danger }[
    status
  ]
  const statusGlyph = { on_track: '&#10003;', at_risk: '&#9888;&#65038;', off_track: '&#8855;' }[
    status
  ]
  const label = (title: string) =>
    `<h2 style="font:400 11px/18px 'IBM Plex Mono',monospace;letter-spacing:0.04em;color:${palette.mutedText};text-transform:uppercase;margin:24px 0 12px">${title}</h2>`
  const progressRows = milestones.map((milestone) => {
    const { code, title, dueDate, oldDueDate, done, total } = milestone
    const percent = total ? Math.max(0, Math.min(100, (done / total) * 100)) : 0
    const moved = oldDueDate && dueDate && oldDueDate !== dueDate
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;margin:0 0 16px;font-size:14px">
      <tr><td style="overflow-wrap:anywhere"><span style="font-family:'IBM Plex Mono',monospace;color:${palette.mutedText}">${escapeHtml(code)}</span>&nbsp; ${escapeHtml(title)}</td>
      <td width="145" align="right" style="font:400 12px/18px 'IBM Plex Mono',monospace;color:${moved ? palette.warning : palette.mutedText}">${dateLabel(dueDate, oldDueDate)}</td></tr>
      <tr><td style="padding:8px 8px 8px 0"><div style="background:${palette.muted};height:4px;border-radius:6px"><div style="width:${percent}%;height:4px;border-radius:6px;background:${moved ? palette.warning : palette.accent}"></div></div></td>
      <td style="font:400 12px/18px 'IBM Plex Mono',monospace;color:${palette.mutedText}">${done}/${total}</td></tr>
    </table>`
  })
  const decisionRows = decisions.map(
    (item) =>
      `<p style="margin:0 0 14px;font-size:14px;overflow-wrap:anywhere"><span aria-hidden="true" style="margin-right:10px;color:${palette.success}">&#10003;</span>${escapeHtml(item)}</p>`,
  )
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
  <body style="margin:0;background:${palette.muted};font:400 15px/1.5 'IBM Plex Sans',Arial,sans-serif;color:${palette.text}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
  <div style="width:100%;max-width:640px;margin:0 auto">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${palette.bg};border:1px solid ${palette.border};border-radius:8px;text-align:left;table-layout:fixed">
  <tr><td style="padding:18px 24px;border-bottom:1px solid ${palette.border}">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-weight:600">planfr&#x2299;jex</td><td align="right" style="font:400 12px/18px 'IBM Plex Mono',monospace;text-transform:uppercase;color:${palette.mutedText}">${weekLabel}</td></tr></table>
  </td></tr>
  <tr><td style="padding:20px 24px 24px">
    <h1 style="font-size:22px;line-height:1.3;font-weight:600;margin:0 0 20px;overflow-wrap:anywhere">${escapeHtml(projectName)}</h1>
    <p style="display:inline-block;margin:0;background:${palette.subtle};border-radius:6px;padding:7px 12px;font-size:14px;color:${palette.mutedText};overflow-wrap:anywhere"><strong style="color:${tone}"><span aria-hidden="true">${statusGlyph}</span>&nbsp; ${statuses[status]}</strong>${statusDetail ? `&nbsp; ${escapeHtml(statusDetail)}` : ''}</p>
    <p style="margin:20px 0 0;overflow-wrap:anywhere">${escapeHtml(summary)}</p>
    ${label('Milestones')}
    ${progressRows.join('') || '<p style="margin:0">No milestones yet.</p>'}
    ${label('Decisions this week')}
    ${decisionRows.join('') || `<p style="margin:0">${noDecisions}</p>`}
    ${label('Next week')}
    <p style="margin:0;overflow-wrap:anywhere">${escapeHtml(nextWeek)}</p>
    <a href="${escapeHtml(planUrl)}" style="display:inline-block;background:${palette.accent};color:${palette.bg};border-radius:6px;padding:10px 16px;margin-top:24px;font-size:14px;font-weight:600;text-decoration:none">Open the plan</a>
  </td></tr>
  <tr><td style="background:${palette.subtle};border-top:1px solid ${palette.border};border-radius:0 0 8px 8px;padding:14px 24px;color:${palette.mutedText};font-size:12px">${deliveryNote} <a href="${escapeHtml(unsubscribeUrl)}" style="color:inherit">Unsubscribe</a></td></tr>
  </table></div></td></tr></table></body></html>`
  const text = [
    `${projectName}\n${weekLabel}\n${statuses[status]}${statusDetail ? ` · ${statusDetail}` : ''}`,
    summary,
    `Milestones\n${milestones.map((milestone) => `${milestone.code} ${milestone.title}: ${milestone.done}/${milestone.total} · ${dateLabel(milestone.dueDate, milestone.oldDueDate)}`).join('\n') || 'No milestones yet.'}`,
    `Decisions this week\n${decisions.join('\n') || noDecisions}`,
    `Next week\n${nextWeek}`,
    `Open the plan: ${planUrl}`,
    `${deliveryNote}\nUnsubscribe: ${unsubscribeUrl}`,
  ].join('\n\n')
  return { text, html }
}
