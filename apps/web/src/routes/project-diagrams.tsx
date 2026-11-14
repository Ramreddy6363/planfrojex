import { useQuery } from '@tanstack/react-query'
import { createRoute, Link, useBlocker, useLoaderData, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarDays,
  Diamond,
  Hand,
  Link as LinkIcon,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Shapes,
  Square,
  Star,
  Trash2,
  Type,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, call, RequestError } from '../api'
import { queryClient } from '../session'
import { Avatar, AvatarStack } from '../ui/avatar'
import { Button } from '../ui/button'
import type { DiagramScene, DiagramShape } from '../ui/diagram-canvas'
import { Dialog } from '../ui/dialog'
import { EmptyState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { Input } from '../ui/input'
import { Menu } from '../ui/menu'
import { Select } from '../ui/select'
import { StatusGlyph } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { Textarea } from '../ui/textarea'
import { ToastRegion } from '../ui/toast'
import { ActionError, useAction } from '../use-action'
import { UserError, userMessage } from '../user-error'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

const DiagramCanvas = lazy(() =>
  import('../ui/diagram-canvas').then((module) => ({ default: module.DiagramCanvas })),
)

const typeNames = {
  flowchart: 'Flowchart',
  architecture: 'Architecture',
  sequence: 'Sequence',
  entity_relationship: 'Entity relationship',
}
type DiagramType = keyof typeof typeNames
const emptyScene = (): DiagramScene => ({ nodes: [], edges: [] })
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
const clockLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(value),
  )

function ProjectDiagrams() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects/$projectId/diagrams' })
  const { projectId } = projectDiagramsRoute.useParams()
  const navigate = useNavigate()
  const editable = workspace.role === 'owner' || workspace.role === 'editor'
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scene, setScene] = useState<DiagramScene>(emptyScene)
  const [sceneVersion, setSceneVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'conflict' | 'error'>('saved')
  const [saveError, setSaveError] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)
  const [tool, setTool] = useState<'select' | 'pan' | 'arrow'>('select')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [diagramType, setDiagramType] = useState<DiagramType>('flowchart')
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionName, setVersionName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const latest = useRef({ scene, sceneVersion, dirty, selectedId })
  const saveInFlight = useRef<Promise<void> | null>(null)
  latest.current = { scene, sceneVersion, dirty, selectedId }
  const action = useAction()
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => call(api.projects[':id'].$get({ param: { id: projectId } })),
  })
  const diagramsQuery = useQuery({
    queryKey: ['diagrams', projectId],
    queryFn: () => call(api.projects[':id'].diagrams.$get({ param: { id: projectId } })),
  })
  const diagramQuery = useQuery({
    queryKey: ['diagram', selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => {
      if (!selectedId) throw new Error('Choose a diagram')
      return call(api.diagrams[':id'].$get({ param: { id: selectedId } }))
    },
  })
  const versionsQuery = useQuery({
    queryKey: ['diagram-versions', selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => {
      if (!selectedId) throw new Error('Choose a diagram')
      return call(api.diagrams[':id'].versions.$get({ param: { id: selectedId } }))
    },
  })
  const draftQuery = useQuery({
    queryKey: ['draft', draftId],
    enabled: Boolean(draftId),
    queryFn: () => {
      if (!draftId) throw new Error('No draft')
      return call(api.drafts[':id'].$get({ param: { id: draftId } }))
    },
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.draft.status ?? '') ? 2_000 : false,
  })
  const project = projectQuery.data?.project
  const diagrams = diagramsQuery.data?.diagrams ?? []
  const diagram = diagramQuery.data?.diagram
  useEffect(() => {
    if (!selectedId && diagrams[0]) setSelectedId(diagrams[0].id)
  }, [diagrams, selectedId])
  useEffect(() => {
    if (!diagram || dirty) return
    setScene(diagram.scene as DiagramScene)
    setSceneVersion(diagram.sceneVersion)
    setSavedAt(diagram.updatedAt)
  }, [diagram, dirty])
  const save = useCallback(async () => {
    if (saveInFlight.current) await saveInFlight.current
    const pending = latest.current
    if (!pending.selectedId || !pending.dirty || saveState === 'conflict' || draftId) return
    const perform = async () => {
      setSaveState('saving')
      try {
        const result = await call(
          api.diagrams[':id'].$put({
            param: { id: pending.selectedId as string },
            json: { scene: pending.scene, sceneVersion: pending.sceneVersion },
          }),
        )
        if (latest.current.selectedId !== pending.selectedId) return
        queryClient.setQueryData(['diagram', pending.selectedId], result)
        setSceneVersion(result.diagram.sceneVersion)
        latest.current.sceneVersion = result.diagram.sceneVersion
        if (latest.current.scene === pending.scene) {
          setDirty(false)
          latest.current.dirty = false
        }
        setSavedAt(result.diagram.updatedAt)
        setSaveState('saved')
        setSaveError('')
      } catch (error) {
        setSaveState(error instanceof RequestError && error.status === 409 ? 'conflict' : 'error')
        setSaveError(
          error instanceof RequestError && error.status === 409
            ? 'This diagram changed in another window. Reload it before editing.'
            : error instanceof RequestError && error.status === 413
              ? 'This diagram is too large. Remove some shapes or text and try again.'
              : userMessage(error),
        )
        throw error
      }
    }
    const promise = perform()
    saveInFlight.current = promise
    try {
      await promise
    } finally {
      saveInFlight.current = null
    }
  }, [saveState, draftId])
  // Every scene edit restarts the autosave delay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scene is the debounce trigger
  useEffect(() => {
    if (!dirty || !editable || saveState === 'conflict' || saveState === 'error' || draftId) return
    const timer = setTimeout(() => void save().catch(() => {}), 600)
    return () => clearTimeout(timer)
  }, [dirty, scene, editable, save, saveState, draftId])
  useBlocker({
    shouldBlockFn: async () => {
      if (!latest.current.dirty) return false
      try {
        await save()
        return latest.current.dirty
      } catch {
        return true
      }
    },
    enableBeforeUnload: () => latest.current.dirty,
  })
  const changeScene = (next: DiagramScene) => {
    if (!editable || draftId || saveState === 'conflict') return
    setScene(next)
    setDirty(true)
  }
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['diagrams', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['diagram', selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['diagram-versions', selectedId] }),
    ])
  }
  const choose = async (id: string) => {
    await save()
    if (latest.current.dirty)
      throw new UserError('Save or reload this diagram before opening another one.')
    setSelectedId(id)
    setDirty(false)
    setDraftId(null)
    setSaveState('saved')
    setSaveError('')
    setScene(emptyScene())
  }
  const create = async () => {
    await save()
    if (latest.current.dirty)
      throw new UserError('Save or reload this diagram before creating another one.')
    const result = await call(
      api.projects[':id'].diagrams.$post({
        param: { id: projectId },
        json: { name, type: diagramType },
      }),
    )
    setSelectedId(result.diagram.id)
    setScene(emptyScene())
    setDirty(false)
    setSceneVersion(result.diagram.sceneVersion)
    setCreateOpen(false)
    setName('')
    setDraftId(null)
    await queryClient.invalidateQueries({ queryKey: ['diagrams', projectId] })
  }
  const addShape = (type: DiagramShape) => {
    const index = scene.nodes.length
    changeScene({
      ...scene,
      nodes: [
        ...scene.nodes,
        {
          id: crypto.randomUUID(),
          type,
          position: { x: 100 + (index % 2) * 200, y: 80 + Math.floor(index / 2) * 140 },
          data: {
            label: {
              rectangle: 'New step',
              diamond: 'Decision?',
              cylinder: 'Database',
              actor: 'Actor',
              entity: 'Entity\nid\nname',
              text: 'Add a note',
            }[type],
          },
        },
      ],
    })
    setTool('select')
  }
  const tidy = async () => {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
    const elk = new ELK()
    const layout = await elk.layout({
      id: 'diagram',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      },
      children: scene.nodes.map((node) => ({
        id: node.id,
        width: 180,
        height: node.type === 'diamond' ? 100 : 60,
      })),
      edges: scene.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    })
    changeScene({
      ...scene,
      viewport: undefined,
      nodes: scene.nodes.map((node) => {
        const position = layout.children?.find((child) => child.id === node.id)
        return { ...node, position: { x: position?.x ?? 0, y: position?.y ?? 0 } }
      }),
    })
  }
  const saveVersion = async () => {
    await save()
    if (latest.current.dirty || !selectedId)
      throw new UserError('Save your changes before saving a version.')
    await call(
      api.diagrams[':id'].versions.$post({
        param: { id: selectedId },
        json: { label: versionName.trim() || null },
      }),
    )
    setVersionOpen(false)
    setVersionName('')
    setToast('Version saved')
    await refresh()
  }
  const restore = async (version: number) => {
    await save()
    if (latest.current.dirty || !selectedId)
      throw new UserError('Save your changes before restoring a version.')
    await call(
      api.diagrams[':id'].versions[':v'].restore.$post({
        param: { id: selectedId, v: String(version) },
      }),
    )
    setDirty(false)
    setDraftId(null)
    setToast(`Restored v${version} as a new version`)
    await refresh()
  }
  const startDraft = async () => {
    await save()
    if (latest.current.dirty || !selectedId)
      throw new UserError('Save your changes before drafting.')
    const result = await call(
      api.projects[':id'].drafts.$post({
        param: { id: projectId },
        json: { kind: 'diagram', diagramId: selectedId, prompt },
      }),
    )
    setDraftId(result.draft.id)
  }
  const discard = async () => {
    if (draftId) await call(api.drafts[':id'].$delete({ param: { id: draftId } }))
    setDraftId(null)
    setToast('Draft discarded')
  }
  const change = draftQuery.data?.draft.changes.find(
    (item) => item.kind === 'diagram' && item.status === 'pending',
  )
  const preview =
    draftQuery.data?.draft.status === 'ready' && change ? (change.after as DiagramScene) : null
  const accept = async () => {
    if (!draftId || !change) return
    await call(
      api.drafts[':id'].changes[':changeId'].accept.$post({
        param: { id: draftId, changeId: change.id },
        json: {},
      }),
    )
    setDraftId(null)
    setDirty(false)
    setToast('Diagram draft accepted as a new version')
    await refresh()
  }
  const reload = async () => {
    setDirty(false)
    latest.current.dirty = false
    setSaveState('saved')
    setSaveError('')
    await queryClient.invalidateQueries({ queryKey: ['diagram', selectedId] })
  }
  if (!project)
    return (
      <WorkspaceShell workspace={workspace} me={me} active="projects">
        <div className="p-8 text-text-muted">
          {projectQuery.isLoading ? 'Loading diagrams…' : 'Diagrams could not be loaded.'}
        </div>
      </WorkspaceShell>
    )
  return (
    <WorkspaceShell workspace={workspace} me={me} active="projects">
      <div className="flex min-h-screen flex-col text-ui">
        <div className="flex items-center gap-2 border-b border-border px-8 py-3">
          <Link
            to="/$ws/projects"
            params={{ ws: workspace.slug }}
            className="text-text-muted hover:text-text"
          >
            Projects
          </Link>
          <span className="text-text-faint">›</span>
          <Link
            to="/$ws/projects/$projectId"
            params={{ ws: workspace.slug, projectId }}
            className="truncate font-medium"
          >
            {project.name}
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <AvatarStack people={[{ id: project.leadId, name: project.leadName }]} />
            <Button disabled icon={LinkIcon}>
              Share
            </Button>
            <Button
              variant="ghost"
              icon={Star}
              aria-label={project.starred ? 'Unstar project' : 'Star project'}
              aria-pressed={project.starred}
              className="!text-warning"
              onClick={() =>
                void action.run(async () => {
                  if (project.starred)
                    await call(api.projects[':id'].star.$delete({ param: { id: projectId } }))
                  else await call(api.projects[':id'].star.$put({ param: { id: projectId } }))
                  await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
                })
              }
            />
            <Button variant="ghost" aria-label="Project actions unavailable" disabled>
              <Icon icon={MoreHorizontal} />
            </Button>
          </div>
        </div>
        <div className="border-b border-border px-8 pt-4">
          <h1 className="text-display font-semibold">{project.name}</h1>
          <div className="flex h-10 items-center gap-6">
            <span className="flex items-center gap-2">
              <StatusGlyph status={project.status} />
              {project.status.replace('-', ' ')}
            </span>
            <span className="flex items-center gap-2">
              <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
              {project.leadName}
            </span>
            <span className="flex items-center gap-2 text-text-muted">
              <Icon icon={CalendarDays} />
              {project.targetDate
                ? `Due ${dateLabel(`${project.targetDate}T00:00:00`)}`
                : 'No target date'}
            </span>
            <span className="text-text-muted">
              {project.taskProgress.done}/{project.taskProgress.total} tasks
            </span>
          </div>
        </div>
        <div className="border-b border-border px-8 pt-1">
          <Tabs
            value="diagrams"
            onChange={(tab) => {
              if (tab === 'brief')
                void navigate({
                  to: '/$ws/projects/$projectId',
                  params: { ws: workspace.slug, projectId },
                })
              if (tab === 'plan')
                void navigate({
                  to: '/$ws/projects/$projectId/plan',
                  params: { ws: workspace.slug, projectId },
                })
              if (tab === 'tasks')
                void navigate({
                  to: '/$ws/projects/$projectId/tasks',
                  params: { ws: workspace.slug, projectId },
                  search: { view: 'list' },
                })
            }}
            tabs={[
              { id: 'brief', label: 'Brief' },
              { id: 'plan', label: 'Plan' },
              { id: 'tasks', label: `Tasks ${project.taskProgress.total}` },
              { id: 'diagrams', label: `Diagrams ${diagrams.length}` },
              { id: 'activity', label: 'Activity', disabled: true },
            ]}
          />
        </div>
        <div className="grid min-h-[calc(100vh-187px)] flex-1 grid-cols-[240px_minmax(320px,1fr)_300px]">
          <aside className="border-r border-border p-2">
            <div className="flex h-8 items-center justify-between px-2 text-caption text-text-muted">
              <span>Diagrams</span>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Plus}
                  aria-label="New diagram"
                  className="px-1"
                  onClick={() => setCreateOpen(true)}
                />
              )}
            </div>
            {diagramsQuery.isError ? (
              <p role="alert" className="p-2 text-danger">
                Could not load diagrams.{' '}
                <Button size="sm" onClick={() => void diagramsQuery.refetch()}>
                  Try again
                </Button>
              </p>
            ) : (
              diagrams.map((item) => (
                <Button
                  key={item.id}
                  size="auto"
                  variant="ghost"
                  aria-label={`${item.name}, ${typeNames[item.type as DiagramType]}, v${item.currentVersion}`}
                  aria-pressed={selectedId === item.id}
                  onClick={() => void action.run(() => choose(item.id))}
                  className={`!flex w-full !flex-col !items-start !gap-0 px-2 py-2 text-left !font-normal ${selectedId === item.id ? '!bg-accent-subtle' : ''}`}
                >
                  <span className={selectedId === item.id ? 'font-medium' : ''}>{item.name}</span>
                  <span className="text-caption text-text-muted">
                    {typeNames[item.type as DiagramType]}{' '}
                    <span className="ml-2 text-text-faint">v{item.currentVersion}</span>
                  </span>
                </Button>
              ))
            )}
          </aside>
          <section
            className="flex min-w-0 flex-col border-r border-border"
            aria-label="Diagram editor"
          >
            <div className="flex min-h-12 flex-wrap items-center gap-0.5 border-b border-border px-2 py-2">
              {editable && selectedId && !draftId ? (
                <>
                  <Button
                    size="sm"
                    variant={tool === 'select' ? 'secondary' : 'ghost'}
                    icon={MousePointer2}
                    aria-label="Select"
                    className="px-1.5"
                    onClick={() => setTool('select')}
                  />
                  <Button
                    size="sm"
                    variant={tool === 'pan' ? 'secondary' : 'ghost'}
                    icon={Hand}
                    aria-label="Pan"
                    className="px-1.5"
                    onClick={() => setTool('pan')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Square}
                    aria-label="Rectangle"
                    className="px-1.5"
                    onClick={() => addShape('rectangle')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Diamond}
                    aria-label="Diamond"
                    className="px-1.5"
                    onClick={() => addShape('diamond')}
                  />
                  <Button
                    size="sm"
                    variant={tool === 'arrow' ? 'secondary' : 'ghost'}
                    icon={ArrowRight}
                    aria-label="Arrow"
                    className="px-1.5"
                    onClick={() => setTool('arrow')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Type}
                    aria-label="Text"
                    className="px-1.5"
                    onClick={() => addShape('text')}
                  />
                  <Menu
                    label="More diagram tools"
                    triggerContent={<Icon icon={Shapes} />}
                    triggerClassName="px-2"
                    items={[
                      { label: 'Cylinder', onSelect: () => addShape('cylinder') },
                      { label: 'Actor', onSelect: () => addShape('actor') },
                      { label: 'Entity table', onSelect: () => addShape('entity') },
                      { label: 'Tidy up', separated: true, onSelect: () => void action.run(tidy) },
                      {
                        label: 'Delete diagram',
                        icon: Trash2,
                        danger: true,
                        separated: true,
                        onSelect: () =>
                          void action.run(async () => {
                            if (!selectedId) return
                            await call(api.diagrams[':id'].$delete({ param: { id: selectedId } }))
                            setSelectedId(null)
                            setScene(emptyScene())
                            setDirty(false)
                            await refresh()
                          }),
                      },
                    ]}
                  />
                </>
              ) : (
                <span className="text-caption text-text-muted">
                  {draftId ? 'Draft preview' : selectedId ? 'Read only · pan and zoom' : 'Canvas'}
                </span>
              )}
              <span className="ml-auto whitespace-nowrap text-caption text-text-muted">
                {saveState === 'saving'
                  ? 'Saving…'
                  : dirty
                    ? 'Unsaved changes'
                    : savedAt
                      ? `Saved ${clockLabel(savedAt)}`
                      : ''}
              </span>
              <span className="ml-2 text-caption text-text-muted">{zoom}%</span>
              {editable && selectedId && !draftId && (
                <Button
                  size="sm"
                  disabled={saveState === 'conflict' || action.busy}
                  onClick={() => setVersionOpen(true)}
                >
                  Save version
                </Button>
              )}
            </div>
            {saveError && (
              <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-3">
                <p role="alert" className="text-danger">
                  {saveError}
                </p>
                <Button
                  size="sm"
                  onClick={() => void action.run(saveState === 'conflict' ? reload : save)}
                >
                  {saveState === 'conflict' ? 'Reload diagram' : 'Try again'}
                </Button>
              </div>
            )}
            {selectedId ? (
              diagramQuery.isLoading ? (
                <div className="flex-1 p-8 text-text-muted">Loading diagram…</div>
              ) : diagramQuery.isError ? (
                <div className="flex-1 p-8">
                  <EmptyState
                    title="Diagram could not be loaded"
                    body="Try loading it again."
                    action={<Button onClick={() => void diagramQuery.refetch()}>Try again</Button>}
                  />
                </div>
              ) : (
                <div className="min-h-100 flex-1">
                  <Suspense
                    fallback={
                      <div
                        role="status"
                        className="flex h-full min-h-100 items-center justify-center bg-bg-subtle text-text-muted"
                      >
                        Loading diagram canvas…
                      </div>
                    }
                  >
                    <DiagramCanvas
                      key={selectedId}
                      scene={preview ?? scene}
                      onChange={changeScene}
                      readOnly={!editable || Boolean(draftId) || saveState === 'conflict'}
                      tool={editable ? tool : 'pan'}
                      onZoomChange={setZoom}
                    />
                  </Suspense>
                </div>
              )
            ) : (
              <div className="flex flex-1 items-center justify-center bg-bg-subtle p-8">
                <EmptyState
                  title="No diagrams yet"
                  body={
                    editable
                      ? 'Create a diagram to map a flow, system or data model.'
                      : 'Diagrams will appear here when your team adds one.'
                  }
                  action={
                    editable ? (
                      <Button onClick={() => setCreateOpen(true)}>New diagram</Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </section>
          <aside className="px-5 py-5">
            {editable && selectedId && (
              <section className="mb-6 border-b border-border pb-6">
                <h2 className="mb-2 font-semibold">Draft a diagram</h2>
                {draftId ? (
                  <>
                    <p className="mb-3 text-caption text-text-muted">
                      {draftQuery.data?.draft.status === 'failed'
                        ? 'The draft could not be created. Discard it and try again.'
                        : preview
                          ? 'Review this preview. Your diagram changes only after you accept it.'
                          : 'Drafting your diagram…'}
                    </p>
                    {draftQuery.isError && (
                      <p role="alert" className="mb-3 text-danger">
                        Could not load the draft.{' '}
                        <Button size="sm" onClick={() => void draftQuery.refetch()}>
                          Try again
                        </Button>
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={action.busy}
                        onClick={() => void action.run(discard)}
                      >
                        Discard
                      </Button>
                      {preview && (
                        <Button
                          size="sm"
                          disabled={action.busy}
                          onClick={() => void action.run(accept)}
                        >
                          Accept draft
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mb-3 text-caption text-text-muted">
                      Describe what it should show. Review the draft before accepting it as a new
                      version.
                    </p>
                    <Select aria-label="Diagram type" value={diagram?.type ?? diagramType} disabled>
                      <option value={diagram?.type ?? diagramType}>
                        {typeNames[(diagram?.type ?? diagramType) as DiagramType]}
                      </option>
                    </Select>
                    <Textarea
                      aria-label="Diagram instructions"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the flow, system or data model."
                      className="my-2 h-24"
                      maxLength={4000}
                    />
                    <Button
                      className="w-full"
                      disabled={action.busy || saveState === 'conflict'}
                      onClick={() => void action.run(startDraft)}
                    >
                      Draft diagram
                    </Button>
                  </>
                )}
              </section>
            )}
            <h2 className="mb-2 text-caption text-text-muted">Versions</h2>
            {versionsQuery.isError && (
              <p role="alert" className="text-danger">
                Versions could not be loaded.
              </p>
            )}
            {!selectedId || !versionsQuery.data?.versions.length ? (
              <p className="text-caption text-text-muted">No saved versions yet</p>
            ) : (
              versionsQuery.data.versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center gap-3 border-b border-border py-3 text-caption"
                >
                  <span className="font-mono">v{version.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {version.label || version.authorName || 'Team member'}
                    </p>
                    {version.label && (
                      <p className="text-text-muted">{version.authorName || 'Team member'}</p>
                    )}
                    <p className="text-text-muted">
                      {dateLabel(version.createdAt)} {clockLabel(version.createdAt)}
                    </p>
                  </div>
                  {version.version === diagram?.currentVersion ? (
                    <span className="text-text-muted">Current</span>
                  ) : editable && !draftId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Restore v${version.version}`}
                      className="px-1 text-caption"
                      onClick={() => void action.run(() => restore(version.version))}
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </aside>
        </div>
        <ActionError error={action.error} />
        <ToastRegion message={toast} />
        <Dialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="New diagram"
          footer={
            <>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name.trim() || action.busy}
                onClick={() => void action.run(create)}
              >
                Create diagram
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <label htmlFor="diagram-name" className="block">
              Diagram name
              <Input
                id="diagram-name"
                aria-label="Diagram name"
                className="mt-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={160}
                placeholder="e.g. Checkout flow"
              />
            </label>
            <label htmlFor="diagram-type" className="block">
              Type
              <Select
                id="diagram-type"
                aria-label="New diagram type"
                className="mt-1"
                value={diagramType}
                onChange={(event) => setDiagramType(event.target.value as DiagramType)}
              >
                {Object.entries(typeNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <ActionError error={action.error} />
          </div>
        </Dialog>
        <Dialog
          open={versionOpen}
          onClose={() => setVersionOpen(false)}
          title="Save version"
          footer={
            <>
              <Button onClick={() => setVersionOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={action.busy}
                onClick={() => void action.run(saveVersion)}
              >
                Save version
              </Button>
            </>
          }
        >
          <label htmlFor="version-name" className="block">
            Version name <span className="text-text-muted">(optional)</span>
            <Input
              id="version-name"
              aria-label="Version name"
              className="mt-1"
              value={versionName}
              onChange={(event) => setVersionName(event.target.value)}
              maxLength={160}
              placeholder="e.g. Checkout baseline"
            />
          </label>
          <ActionError error={action.error} />
        </Dialog>
      </div>
    </WorkspaceShell>
  )
}

export const projectDiagramsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/projects/$projectId/diagrams',
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: ProjectDiagrams,
})
