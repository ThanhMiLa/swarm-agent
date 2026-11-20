import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen, MoreVertical, Pencil, Plus, Settings, X } from 'lucide-react'
import { DndContext, closestCenter, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { confirm } from '@tauri-apps/plugin-dialog'
import { GuardedPointerSensor } from '@/lib/dnd-sensors'
import { collectLeaves, type LeafNode } from '@/lib/layout-tree'
import { useAppStore, type Project, type Workspace } from '@/store/app-store'
import { useNavbarVisibilityStore } from '@/store/navbar-visibility-store'
import { useTerminalActivityStore } from '@/store/terminal-activity-store'
import { useAgentStateStore } from '@/store/agent-state-store'
import { displayState, workspaceDot } from '@/lib/agent-state/rollup'
import { ActivityDot } from '@/components/ActivityDot'
import { StateDot } from '@/components/StateDot'
import { AttentionBadge } from '@/components/Navbar/AttentionBadge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { TerminalList } from './TerminalList'
import { UpdateButton } from './UpdateButton'
import { getAppVersion } from '@/tauri/app'
import { beginLayoutTransition, endLayoutTransition } from '@/lib/terminal-registry'

interface NavbarProps {
  settingsOpen: boolean
  onToggleSettings: () => void
}

// Projects sort among projects; workspaces sort only among siblings.
const branchCollision: CollisionDetection = (args) => closestCenter({
  ...args,
  droppableContainers: args.droppableContainers.filter(
    (container) => container.data.current?.sortGroup === args.active.data.current?.sortGroup
  )
})

export function Navbar({ settingsOpen, onToggleSettings }: NavbarProps): ReactElement {
  const visible = useNavbarVisibilityStore((s) => s.visible)
  const previousVisible = useRef(visible)
  const layoutTransition = useRef(0)
  useLayoutEffect(() => {
    if (previousVisible.current === visible) return
    previousVisible.current = visible
    layoutTransition.current = beginLayoutTransition(220)
  }, [visible])

  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.welcomeFocused ? '' : s.activeWorkspaceId)
  const welcomeFocused = useAppStore((s) => s.welcomeFocused)
  const welcomeProjectId = useAppStore((s) => s.welcomeProjectId)
  const openWelcome = useAppStore((s) => s.openWelcome)
  const closeWelcome = useAppStore((s) => s.closeWelcome)
  const sensors = useSensors(useSensor(GuardedPointerSensor, { activationConstraint: { distance: 5 } }))
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAppVersion()
      .then((v) => { if (active) setVersion(v) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return
    const { moveProject, moveWorkspace } = useAppStore.getState()
    const move = active.data.current?.sortGroup === 'projects' ? moveProject : moveWorkspace
    move(String(active.id), String(over.id))
  }

  return (
    <nav
      aria-label="Projects"
      aria-hidden={!visible}
      inert={!visible}
      data-focus-return
      style={{ width: visible ? 'var(--workspace-sidebar-width)' : 0 }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'width') endLayoutTransition(layoutTransition.current)
      }}
      className={cn(
        'h-full shrink-0 overflow-hidden border-r bg-card transition-[width,border-color] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        visible ? 'border-border' : 'border-transparent'
      )}
    >
      <div className={cn(
        'flex h-full w-[var(--workspace-sidebar-width)] flex-col transition-[transform,opacity] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity] motion-reduce:transition-none',
        visible ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
      )}>
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">Projects</p>
          <AttentionBadge />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <DndContext sensors={sensors} collisionDetection={branchCollision} onDragEnd={handleDragEnd}>
            <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1">
                {projects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    workspaces={workspaces.filter((w) => w.projectId === project.id)}
                    activeWorkspaceId={activeWorkspaceId}
                    composing={welcomeFocused && welcomeProjectId === project.id}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="mt-1 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'flex-1 justify-start text-muted-foreground',
                welcomeFocused && welcomeProjectId === null && 'bg-accent text-accent-foreground'
              )}
              onClick={() => openWelcome()}
            >
              <Plus className="h-4 w-4" />
              New project
            </Button>
            {welcomeFocused && projects.length > 0 && (
              <button
                type="button"
                aria-label="Close composer"
                title="Close composer"
                onClick={closeWelcome}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="shrink-0 space-y-0.5 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSettings}
            className={cn(
              'w-full justify-start',
              settingsOpen
                ? 'bg-accent text-accent-foreground hover:bg-accent'
                : 'text-muted-foreground'
            )}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
          <UpdateButton />
          {version && (
            <p className="mt-1 border-t border-border pt-2 text-center text-[11px] tracking-wider text-muted-foreground/70">
              v{version}
            </p>
          )}
        </div>
      </div>
    </nav>
  )
}

function BranchDot({ leaves }: { leaves: LeafNode[] }): ReactElement | null {
  const activity = useTerminalActivityStore((s) => s.active)
  const agentStates = useAgentStateStore((s) => s.byId)
  const dot = workspaceDot(leaves.map((leaf) => ({
    display: displayState(agentStates[leaf.terminalId]),
    outputActive: activity[leaf.terminalId] === true
  })))
  return dot === 'activity' ? <ActivityDot /> : dot ? <StateDot state={dot} /> : null
}

function ProjectItem({
  project, workspaces, activeWorkspaceId, composing
}: {
  project: Project
  workspaces: Workspace[]
  activeWorkspaceId: string
  composing: boolean
}): ReactElement {
  const openWelcome = useAppStore((s) => s.openWelcome)
  const renameProject = useAppStore((s) => s.renameProject)
  const closeProject = useAppStore((s) => s.closeProject)
  const activeChild = workspaces.find((w) => w.id === activeWorkspaceId)?.id
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (activeChild || composing) setExpanded(true)
  }, [activeChild, composing])

  async function close(): Promise<void> {
    if (workspaces.length > 0 && !await confirm(
      `Close “${project.name}” and stop all of its running terminals?`,
      { title: 'Close project?', kind: 'warning', okLabel: 'Close project' }
    )) return
    closeProject(project.id)
  }

  const Icon = expanded ? FolderOpen : Folder
  return (
    <Branch
      id={project.id}
      kind="Project"
      sortGroup="projects"
      name={project.name}
      title={project.cwd || project.name}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onRename={(name) => renameProject(project.id, name)}
      onClose={() => void close().catch(console.error)}
      icon={<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      count={workspaces.length}
      dot={!expanded && <BranchDot leaves={workspaces.flatMap((w) => collectLeaves(w.layout))} />}
    >
      <SortableContext items={workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        <ul hidden={!expanded} className="ml-3 space-y-0.5 border-l border-border pl-1">
          {workspaces.map((workspace) => (
            <WorkspaceItem key={workspace.id} workspace={workspace} active={workspace.id === activeWorkspaceId} />
          ))}
          <li>
            <button
              type="button"
              aria-label={`New workspace in ${project.name}`}
              onClick={() => openWelcome(project.id)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                composing && 'bg-accent text-accent-foreground'
              )}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New workspace
            </button>
          </li>
        </ul>
      </SortableContext>
    </Branch>
  )
}

function WorkspaceItem({ workspace, active }: { workspace: Workspace; active: boolean }): ReactElement {
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace)
  const renameWorkspace = useAppStore((s) => s.renameWorkspace)
  const closeWorkspace = useAppStore((s) => s.closeWorkspace)
  const [expanded, setExpanded] = useState(active)
  const leaves = collectLeaves(workspace.layout)

  useEffect(() => {
    if (active) setExpanded(true)
  }, [active])

  return (
    <Branch
      id={workspace.id}
      kind="Workspace"
      sortGroup={workspace.projectId}
      name={workspace.name}
      active={active}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onSelect={() => {
        setActiveWorkspace(workspace.id)
        setExpanded(true)
      }}
      onRename={(name) => renameWorkspace(workspace.id, name)}
      onClose={() => closeWorkspace(workspace.id)}
      count={leaves.length}
      dot={(!active || !expanded) && <BranchDot leaves={leaves} />}
    >
      <TerminalList
        leaves={leaves}
        expanded={expanded}
        focusedLeafId={active ? workspace.focusedLeafId : undefined}
      />
    </Branch>
  )
}

interface BranchProps {
  id: string
  kind: 'Project' | 'Workspace'
  sortGroup: string
  name: string
  title?: string
  active?: boolean
  expanded: boolean
  onToggle: () => void
  onSelect?: () => void
  onRename: (name: string) => void
  onClose: () => void
  icon?: ReactNode
  dot: ReactNode
  count: number
  children: ReactNode
}

function Branch({
  id, kind, sortGroup, name, title, active, expanded, onToggle, onSelect,
  onRename, onClose, icon, dot, count, children
}: BranchProps): ReactElement {
  const [renaming, setRenaming] = useState(false)
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { sortGroup },
    disabled: renaming
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-70')}
    >
      {renaming ? (
        <RenameInput
          initialValue={name}
          kind={kind}
          onCommit={(value) => { onRename(value); setRenaming(false) }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div className={cn(
          'group flex min-h-7 items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent/50 hover:text-foreground',
          active ? 'bg-accent text-accent-foreground' : kind === 'Project' ? 'text-foreground' : 'text-muted-foreground'
        )}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
            onClick={onToggle}
            className="flex h-7 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
          </button>
          <button
            {...listeners}
            type="button"
            aria-current={active ? 'true' : undefined}
            aria-expanded={onSelect ? undefined : expanded}
            title={title ?? name}
            onClick={onSelect ?? onToggle}
            onDoubleClick={() => setRenaming(true)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          >
            {icon}
            <span className={cn('flex-1 truncate', kind === 'Project' && 'font-medium')}>{name}</span>
          </button>
          {dot}
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${kind} actions for ${name}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-background/80 hover:text-foreground"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Rename {kind.toLowerCase()}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onClose} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                <X className="h-3.5 w-3.5" />
                Close {kind.toLowerCase()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {children}
    </li>
  )
}

function RenameInput({
  initialValue, kind, onCommit, onCancel
}: {
  initialValue: string
  kind: string
  onCommit: (name: string) => void
  onCancel: () => void
}): ReactElement {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  function finish(commit: boolean): void {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) onCommit(value)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      aria-label={`${kind} name`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(e.key === 'Enter')
        }
      }}
      onBlur={() => finish(true)}
      className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
    />
  )
}
