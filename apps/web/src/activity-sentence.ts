// Wording matches the project Activity page, without the per-event details the home feed doesn't carry.
const sentences: Record<string, string> = {
  'review.approved': 'approved the plan',
  'review.changes_requested': 'requested changes to the plan',
  'comment.added': 'commented',
  'comment.mentioned': 'added mentions to a comment',
  'project.status_changed': 'changed the project status',
  'project.lead_changed': 'changed the project lead',
  'project.target_date_changed': 'changed the target date',
  'project.name_changed': 'renamed the project',
  'project.brief_edited': 'edited the brief',
  'task.created': 'created a task',
  'task.deleted': 'deleted a task',
  'task.status_changed': 'changed the status of a task',
  'task.assignee_changed': 'changed the assignee of a task',
  'task.priority_changed': 'changed the priority of a task',
  'task.due_date_changed': 'changed the due date of a task',
  'task.milestone_changed': 'changed the milestone of a task',
  'plan.section_edited': 'edited a plan section',
  'draft.started': 'started a plan draft',
  'draft.accepted': 'accepted a section of the plan draft',
  'draft.rejected': 'rejected a section of the plan draft',
  'draft.accepted_all': 'accepted the remaining sections of the plan draft',
  'draft.undone': 'undid an accepted change',
  'diagram.created': 'created a diagram',
  'diagram.deleted': 'deleted a diagram',
  'diagram.version_saved': 'saved a new version of a diagram',
  'diagram.restored': 'restored a diagram version',
  'diagram.draft_accepted': 'accepted a diagram draft',
}

export function activitySentence(type: string) {
  const match = /^plan\.(milestone|risk)_(created|updated|deleted)$/.exec(type)
  if (match) return `${match[2] === 'updated' ? 'edited' : match[2]} a ${match[1]}`
  return sentences[type] ?? 'updated the project'
}
