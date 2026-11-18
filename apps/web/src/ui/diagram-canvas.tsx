import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { Minus, Plus, Scan, UserRound } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Button } from './button'
import { Icon } from './icon'
import { Input } from './input'
import '@xyflow/react/dist/base.css'

export type DiagramShape = 'rectangle' | 'diamond' | 'cylinder' | 'actor' | 'entity' | 'text'
export type DiagramNode = Node<{ label: string }, DiagramShape> & { type: DiagramShape }
export type DiagramEdge = Edge & { label?: string }
export type DiagramScene = {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  viewport?: { x: number; y: number; zoom: number }
}
const EditContext = createContext<{
  editable: boolean
  rename: (id: string, label: string) => void
}>({ editable: false, rename: () => {} })

const Shape = ({ id, data, type, selected }: NodeProps<DiagramNode>) => {
  const { editable, rename } = useContext(EditContext)
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label)
  useEffect(() => setLabel(data.label), [data.label])
  const save = () => {
    rename(id, label.trim() || 'Untitled')
    setEditing(false)
  }
  const lines = data.label.split('\n')
  return (
    // biome-ignore lint/a11y/useSemanticElements: editable nodes contain a text input and connection handles
    <div
      className={`diagram-shape diagram-shape-${type} ${selected ? 'diagram-shape-selected' : ''}`}
      role="button"
      tabIndex={editable ? 0 : -1}
      aria-label={data.label}
      onKeyDown={(event) => {
        if (editable && event.key === 'Enter') setEditing(true)
      }}
      onDoubleClick={() => editable && setEditing(true)}
    >
      <Handle type="target" position={Position.Top} isConnectable={editable} />
      {type === 'actor' && <Icon icon={UserRound} className="mx-auto mb-1 size-8" />}
      {editing ? (
        <Input
          autoFocus
          aria-label="Shape label"
          className="nodrag min-w-36"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') save()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : type === 'entity' ? (
        <>
          <strong className="block border-b border-border px-3 py-2 font-medium">{lines[0]}</strong>
          <span className="block whitespace-pre-line px-3 py-2 text-caption">
            {lines.slice(1).join('\n') || 'id'}
          </span>
        </>
      ) : (
        <span className="block whitespace-pre-line">{data.label}</span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={editable} />
      <Handle id="right" type="source" position={Position.Right} isConnectable={editable} />
      <Handle id="left" type="target" position={Position.Left} isConnectable={editable} />
    </div>
  )
}
const nodeTypes = {
  rectangle: Shape,
  diamond: Shape,
  cylinder: Shape,
  actor: Shape,
  entity: Shape,
  text: Shape,
}

function Canvas({
  scene,
  onChange,
  readOnly,
  tool = 'select',
  onZoomChange,
  showControls = true,
  hideAttribution = false,
}: {
  scene: DiagramScene
  onChange?: (scene: DiagramScene) => void
  readOnly: boolean
  tool?: 'select' | 'pan' | 'arrow'
  onZoomChange?: (zoom: number) => void
  showControls?: boolean
  hideAttribution?: boolean
}) {
  const [nodes, setNodes] = useState(scene.nodes)
  const [edges, setEdges] = useState(scene.edges)
  const currentNodes = useRef(nodes)
  const currentEdges = useRef(edges)
  const [arrowStart, setArrowStart] = useState<string | null>(null)
  const flow = useReactFlow<DiagramNode, DiagramEdge>()
  useEffect(() => {
    setNodes(scene.nodes)
    setEdges(scene.edges)
    currentNodes.current = scene.nodes
    currentEdges.current = scene.edges
  }, [scene])
  const persist = (nextNodes: DiagramNode[], nextEdges: DiagramEdge[]) => {
    onChange?.({
      nodes: nextNodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      edges: nextEdges.map(({ id, source, target, label, sourceHandle, targetHandle }) => ({
        id,
        source,
        target,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        ...(typeof label === 'string' ? { label } : {}),
      })),
      viewport: flow.getViewport(),
    })
  }
  const connect = (connection: Connection) => {
    const next = addEdge<DiagramEdge>(
      { ...connection, id: crypto.randomUUID() },
      currentEdges.current,
    )
    setEdges(next)
    currentEdges.current = next
    persist(currentNodes.current, next)
  }
  return (
    <EditContext.Provider
      value={{
        editable: !readOnly,
        rename: (id, label) => {
          const next = currentNodes.current.map((node) =>
            node.id === id ? { ...node, data: { ...node.data, label } } : node,
          )
          setNodes(next)
          currentNodes.current = next
          persist(next, currentEdges.current)
        },
      }}
    >
      <section
        className="diagram-canvas relative h-full min-h-100 bg-bg-subtle"
        aria-label={readOnly ? 'Read-only diagram canvas' : 'Diagram canvas'}
      >
        <ReactFlow<DiagramNode, DiagramEdge>
          proOptions={{ hideAttribution: hideAttribution || !showControls }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-text)' },
            type: 'smoothstep',
          }}
          onNodesChange={(changes) => {
            const next = applyNodeChanges(changes, currentNodes.current)
            setNodes(next)
            currentNodes.current = next
            if (!readOnly && changes.some((change) => change.type === 'remove')) {
              const ids = new Set(next.map((node) => node.id))
              const nextEdges = currentEdges.current.filter(
                (edge) => ids.has(edge.source) && ids.has(edge.target),
              )
              setEdges(nextEdges)
              currentEdges.current = nextEdges
              persist(next, nextEdges)
            } else if (
              !readOnly &&
              changes.some((change) => change.type === 'position' && !change.dragging)
            ) {
              persist(next, currentEdges.current)
            }
          }}
          onEdgesChange={(changes) => {
            const next = applyEdgeChanges<DiagramEdge>(changes, currentEdges.current)
            setEdges(next)
            currentEdges.current = next
            if (!readOnly && changes.some((change) => change.type === 'remove'))
              persist(currentNodes.current, next)
          }}
          onNodeDragStop={(_, node) => {
            const next = currentNodes.current.map((item) => (item.id === node.id ? node : item))
            currentNodes.current = next
            persist(next, currentEdges.current)
          }}
          onNodeClick={(_, node) => {
            if (readOnly || tool !== 'arrow') return
            if (arrowStart && arrowStart !== node.id) {
              connect({
                source: arrowStart,
                target: node.id,
                sourceHandle: null,
                targetHandle: null,
              })
              setArrowStart(null)
            } else setArrowStart(node.id)
          }}
          onConnect={readOnly ? undefined : connect}
          onMoveEnd={(_, viewport) => onZoomChange?.(Math.round(viewport.zoom * 100))}
          zoomOnDoubleClick={false}
          nodesFocusable={!readOnly}
          edgesFocusable={!readOnly}
          nodesDraggable={!readOnly && tool === 'select'}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly && tool !== 'pan'}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          panOnDrag={readOnly || tool === 'pan'}
          defaultViewport={scene.viewport ?? { x: 0, y: 0, zoom: 1 }}
          fitView={scene.nodes.length > 0 && !scene.viewport}
          fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
          minZoom={0.2}
          maxZoom={2}
        />
        {showControls && (
          <div className="absolute bottom-4 left-4 z-10 flex rounded-control border border-border bg-bg">
            <Button
              variant="ghost"
              size="sm"
              icon={Minus}
              aria-label="Zoom out"
              onClick={() => void flow.zoomOut()}
              className="px-2"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              aria-label="Zoom in"
              onClick={() => void flow.zoomIn()}
              className="px-2"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Scan}
              aria-label="Fit diagram"
              onClick={() => void flow.fitView({ padding: 0.25, maxZoom: 1 })}
              className="px-2"
            />
          </div>
        )}
        {tool === 'arrow' && !readOnly && (
          <p className="absolute bottom-4 right-4 rounded-control border border-border bg-bg px-3 py-1.5 text-caption text-text-muted">
            {arrowStart ? 'Choose the destination shape' : 'Choose the starting shape'}
          </p>
        )}
      </section>
    </EditContext.Provider>
  )
}

export const DiagramCanvas = (props: Parameters<typeof Canvas>[0]) => (
  <ReactFlowProvider>
    <Canvas {...props} />
  </ReactFlowProvider>
)
