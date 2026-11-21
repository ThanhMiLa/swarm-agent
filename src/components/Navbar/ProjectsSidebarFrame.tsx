import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { flushSync } from 'react-dom'
import {
  clampNavbarWidth,
  MAX_NAVBAR_WIDTH,
  MIN_NAVBAR_WIDTH,
  NAVBAR_WIDTH_STORAGE_KEY,
  readStoredNavbarWidth
} from '@/lib/navbar-width'
import { beginLayoutTransition, endLayoutTransition, suspendLayoutRefits } from '@/lib/terminal-registry'
import { cn } from '@/lib/utils'
import { useNavbarVisibilityStore } from '@/store/navbar-visibility-store'

interface ResizeGesture {
  pointerId: number
  startX: number
  startWidth: number
  width: number
  frame: number | null
  releaseRefits: () => void
}

export function ProjectsSidebarFrame({ children }: { children: ReactNode }): ReactElement {
  const visible = useNavbarVisibilityStore((s) => s.visible)
  const [width, setWidth] = useState(() => readStoredNavbarWidth(window.localStorage))
  const [dragging, setDragging] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const gesture = useRef<ResizeGesture | null>(null)
  const previousVisible = useRef(visible)
  const layoutTransition = useRef(0)

  function persistWidth(value: number): void {
    window.localStorage.setItem(NAVBAR_WIDTH_STORAGE_KEY, String(value))
  }

  function finishResize(event?: PointerEvent<HTMLDivElement>): void {
    const drag = gesture.current
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    gesture.current = null
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    if (event) {
      // Commit the last pointer coordinate before re-enabling the width
      // transition, even if the final animation frame didn't run yet.
      if (event.type === 'pointerup') {
        drag.width = clampNavbarWidth(drag.startWidth + event.clientX - drag.startX)
      }
      flushSync(() => setWidth(drag.width))
    } else {
      setWidth(drag.width)
    }
    setDragging(false)
    drag.releaseRefits()
    persistWidth(drag.width)
  }

  useLayoutEffect(() => {
    if (previousVisible.current === visible) return
    previousVisible.current = visible
    layoutTransition.current = beginLayoutTransition()
    if (!visible) finishResize()
  }, [visible])

  useLayoutEffect(() => () => {
    const drag = gesture.current
    if (!drag) return
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    drag.releaseRefits()
    gesture.current = null
  }, [])

  function startResize(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: navRef.current?.getBoundingClientRect().width ?? width,
      width,
      frame: null,
      releaseRefits: suspendLayoutRefits()
    }
    setDragging(true)
  }

  function moveResize(event: PointerEvent<HTMLDivElement>): void {
    const drag = gesture.current
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.width = clampNavbarWidth(drag.startWidth + event.clientX - drag.startX)
    if (drag.frame !== null) return
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null
      setWidth(drag.width)
    })
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 40 : 10
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = width - step; break
      case 'ArrowRight': next = width + step; break
      case 'Home': next = MIN_NAVBAR_WIDTH; break
      case 'End': next = MAX_NAVBAR_WIDTH; break
      default: return
    }
    event.preventDefault()
    next = clampNavbarWidth(next)
    if (next === width) return
    layoutTransition.current = beginLayoutTransition()
    setWidth(next)
    persistWidth(next)
  }

  return (
    <nav
      ref={navRef}
      aria-label="Projects"
      aria-hidden={!visible}
      inert={!visible}
      data-focus-return
      style={{ width: visible ? width : 0 }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'width') {
          endLayoutTransition(layoutTransition.current)
        }
      }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden border-r bg-card',
        dragging
          ? 'transition-none'
          : 'transition-[width,border-color] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        visible ? 'border-border' : 'border-transparent'
      )}
    >
      <div
        id="projects-sidebar-content"
        style={{ width }}
        className={cn(
          'flex h-full flex-col transition-[transform,opacity] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity] motion-reduce:transition-none',
          visible ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
        )}
      >
        {children}
      </div>
      {visible && (
        <div
          role="separator"
          aria-label="Resize Projects sidebar"
          aria-orientation="vertical"
          aria-controls="projects-sidebar-content"
          aria-valuemin={MIN_NAVBAR_WIDTH}
          aria-valuemax={MAX_NAVBAR_WIDTH}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onKeyDown={resizeWithKeyboard}
          className={cn(
            'absolute inset-y-0 right-0 z-10 w-1.5 touch-none select-none cursor-col-resize',
            'outline-none transition-colors hover:bg-ring/60 focus-visible:bg-ring/60 motion-reduce:transition-none',
            dragging && 'bg-ring/60'
          )}
        />
      )}
    </nav>
  )
}
