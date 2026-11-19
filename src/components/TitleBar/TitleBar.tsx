import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Square,
  X
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useNavbarVisibilityStore } from '@/store/navbar-visibility-store'
import { useTeamPanelStore } from '@/store/team-panel-store'
import { minimize, toggleMaximize, closeWindow, onMaximizedChanged } from '@/tauri/window'
import { isMacPlatform } from '@/lib/platform'
import { needsTrafficLightInset } from '@/lib/titlebar-chrome'

// On macOS the OS draws native traffic lights over this header (titleBarStyle
// Overlay — see tauri.macos.conf.json): hide the custom window buttons and
// inset the left cluster so it clears the lights. Platform never changes at
// runtime, so a module-level constant is fine — but full screen does change at
// runtime, and it takes the lights away with it (see lib/titlebar-chrome.ts).
const isMac = isMacPlatform()
// Tooltip hints must match the platform binding (mac convention: ⇧ before ⌘).
const navbarHint = isMac ? '⌘B' : 'Ctrl+B'

interface TitleBarProps {
  /** Native full screen, owned by App — it drives the system-chrome dodge too. */
  fullscreen: boolean
}

/**
 * Centered app branding with sidebar and window controls on either side.
 * macOS draws its native window controls over the left edge.
 */
export function TitleBar({ fullscreen }: TitleBarProps): ReactElement {
  const [isMaximized, setIsMaximized] = useState(false)
  const visible = useNavbarVisibilityStore((s) => s.visible)
  const toggleNavbar = useNavbarVisibilityStore((s) => s.toggle)
  const rightPanelOpen = useTeamPanelStore((s) => s.open)
  const toggleRightPanel = useTeamPanelStore((s) => s.toggle)
  // Home view = Welcome focused, or no workspaces yet (matches App's showWelcome).
  const onHome = useAppStore((s) => s.welcomeFocused || s.workspaces.length === 0)

  useEffect(() => {
    if (isMac) return // maximize icon swap only exists on the custom buttons
    let unlisten: (() => void) | undefined
    onMaximizedChanged(setIsMaximized).then((un) => (unlisten = un))
    return () => unlisten?.()
  }, [])

  return (
    <div
      data-tauri-drag-region
      // Toggling a panel here must not strand the keyboard on the button that
      // was clicked. App.tsx hands it back (lib/terminal-focus.ts).
      data-focus-return
      className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-card"
    >
      <div
        data-tauri-drag-region
        className={cn('justify-self-start', needsTrafficLightInset(isMac, fullscreen) ? 'pl-20' : 'pl-1.5')}
      >
        <button
          type="button"
          data-tauri-drag-region="false"
          aria-label={visible ? `Hide sidebar (${navbarHint})` : `Show sidebar (${navbarHint})`}
          title={visible ? `Hide sidebar (${navbarHint})` : `Show sidebar (${navbarHint})`}
          onClick={toggleNavbar}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {visible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
      </div>

      <div
        data-tauri-drag-region
        className="flex h-full select-none items-center gap-2"
      >
        <Logo className="pointer-events-none size-6" />
        <span className="pointer-events-none text-xs font-semibold">SwarmAgent</span>
      </div>

      <div className="flex h-full items-center justify-self-end">
        {!onHome && (
          <button
            type="button"
            data-tauri-drag-region="false"
            aria-label="Toggle Agent Team"
            aria-pressed={rightPanelOpen}
            title="Toggle Agent Team"
            onClick={toggleRightPanel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground mr-1"
          >
            {rightPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        )}
        {!isMac && (
          <>
            <TitleBarButton label="Minimize" onClick={() => minimize()}>
              <Minus className="h-4 w-4" />
            </TitleBarButton>
            <TitleBarButton
              label={isMaximized ? 'Restore' : 'Maximize'}
              onClick={() => toggleMaximize()}
            >
              {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </TitleBarButton>
            <TitleBarButton
              label="Close"
              onClick={() => closeWindow()}
              className="hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="h-4 w-4" />
            </TitleBarButton>
          </>
        )}
      </div>
    </div>
  )
}

interface TitleBarButtonProps {
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}

/** A single window-control button: full-height, fixed width, hover-highlighted. */
function TitleBarButton({
  label,
  onClick,
  className,
  children
}: TitleBarButtonProps): ReactElement {
  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  )
}
