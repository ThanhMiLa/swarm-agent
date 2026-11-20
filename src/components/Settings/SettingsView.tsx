import { useEffect, useState, type ReactElement } from 'react'
import { BarChart3, Bell, ChevronDown, ChevronRight, History, Keyboard, Palette, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { AppearancePanel } from './AppearancePanel'
import { TerminalPanel } from './TerminalPanel'
import { NotificationsPanel } from './NotificationsPanel'
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel'
import { TokenUsagePanel } from './TokenUsagePanel'
import { RunHistoryPanel } from './RunHistoryPanel'

export type CategoryId =
  | 'appearance'
  | 'terminal'
  | 'notifications'
  | 'shortcuts'
  | 'token-usage'
  | 'run-history'

interface Category {
  id: CategoryId
  label: string
  Icon: typeof Palette
}

const CATEGORIES: Category[] = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'terminal', label: 'Terminal', Icon: Terminal },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', Icon: Keyboard },
  { id: 'token-usage', label: 'Token Usage', Icon: BarChart3 },
  { id: 'run-history', label: 'Run History', Icon: History },
]

interface SettingsViewProps {
  onClose: () => void
  initialCategory?: CategoryId
}

/**
 * Centered modal Settings dialog over a dimmed backdrop. A left nav rail picks
 * the active category; the right pane renders its panel. Click the backdrop,
 * press Esc, or click the close button to dismiss.
 */
export function SettingsView({ onClose, initialCategory }: SettingsViewProps): ReactElement {
  const [activeCategory, setActiveCategory] = useState<CategoryId>(initialCategory ?? 'appearance')
  const projects = useAppStore((s) => s.projects)
  const workspaceModels = useAppStore((s) => s.workspaces)
  const workspaces = projects.flatMap((project) =>
    workspaceModels.filter((ws) => ws.projectId === project.id).map((ws) => ({
      id: ws.id,
      name: `${project.name} / ${ws.name}`,
      cwd: project.cwd
    }))
  )
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    () => workspaceModels.find((w) => w.id === activeWorkspaceId)?.projectId
  )
  const [tokenUsageExpanded, setTokenUsageExpanded] = useState<boolean>(true)

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6 animate-in fade-in duration-150 motion-reduce:animate-none"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-full max-w-6xl 2xl:max-w-7xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none"
      >
        <nav className="flex w-56 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border px-3 py-3">
            <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          </div>

          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {CATEGORIES.map((cat) => {
              const isTokenUsage = cat.id === 'token-usage'
              const active = cat.id === activeCategory
              const Icon = cat.Icon

              if (isTokenUsage) {
                return (
                  <div key={cat.id} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCategory('token-usage')
                        if (activeCategory === 'token-usage') {
                          setTokenUsageExpanded((prev) => !prev)
                        } else {
                          setTokenUsageExpanded(true)
                        }
                      }}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{cat.label}</span>
                      </div>
                      {tokenUsageExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                      )}
                    </button>

                    {/* Token usage is aggregated by project folder, not by workspace. */}
                    {tokenUsageExpanded && (
                      <div className="ml-4 flex flex-col gap-0.5 border-l border-border/60 pl-2 pt-0.5 pb-1">
                        {projects.map((project) => {
                          const isSelected =
                            activeCategory === 'token-usage' &&
                            selectedProject?.id === project.id
                          return (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => {
                                setActiveCategory('token-usage')
                                setSelectedProjectId(project.id)
                              }}
                              className={cn(
                                'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors text-left',
                                isSelected
                                  ? 'bg-accent font-medium text-accent-foreground'
                                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                              )}
                              title={project.cwd || project.name}
                            >
                              <span className="truncate">{project.name}</span>
                            </button>
                          )
                        })}

                        {projects.length === 0 && (
                          <span className="px-2 py-1 text-[11px] text-muted-foreground italic">
                            No projects
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{cat.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close settings"
            title="Close (Esc)"
            className="absolute right-4 top-4 z-10 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>

          <div className="flex-1 overflow-y-auto">
            <div
              className={cn(
                'mx-auto px-6 py-8 sm:px-8',
                activeCategory === 'token-usage' ? 'max-w-5xl 2xl:max-w-6xl' : 'max-w-3xl'
              )}
            >
              {activeCategory === 'appearance' && <AppearancePanel />}
              {activeCategory === 'terminal' && <TerminalPanel />}
              {activeCategory === 'notifications' && <NotificationsPanel />}
              {activeCategory === 'shortcuts' && <KeyboardShortcutsPanel />}
              {activeCategory === 'token-usage' && (
                <TokenUsagePanel selectedProject={selectedProject} />
              )}
              {activeCategory === 'run-history' && <RunHistoryPanel workspaces={workspaces} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
