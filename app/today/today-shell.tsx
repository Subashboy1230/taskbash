'use client'

import React, { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AppSidebar } from '@/app/_components/app-sidebar'
import { TodayView, DetailPanel } from './today-view'
import { completeItem, dismissItem } from './actions'
import { TodayCalendarColumn } from './today-calendar-column'
import { AddTaskPanel } from './add-task-panel'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/app/_components/ui/sheet'
import type { MockDigestSummary, MockItem } from '@/lib/mock-items'
import type { UserFunction } from '@/lib/types'
import type { DayEvent } from '@/lib/load-day-events'
import type { UnreadThread } from '@/lib/load-unread-gmail'

const CALENDAR_COLLAPSED_KEY = 'taskbash:calendarCollapsed'

// Stable wrapper whose animation is driven by data-panel attribute only.
// React owns className (layout only) but never touches data-panel,
// so item switches never replay the slide-in animation.
function PanelColumn({ closing, children }: { closing: boolean; children: React.ReactNode }) {
  const divRef = useRef<HTMLDivElement>(null)
  const prevClosing = useRef<boolean | null>(null)

  useEffect(() => {
    const el = divRef.current
    if (!el) return
    if (prevClosing.current === null) {
      // First mount — play the opening animation once
      el.dataset.panel = 'opening'
      const onEnd = () => { el.dataset.panel = 'open' }
      el.addEventListener('animationend', onEnd, { once: true })
    } else if (closing && !prevClosing.current) {
      el.dataset.panel = 'closing'
    } else if (!closing && prevClosing.current) {
      el.dataset.panel = 'opening'
      const onEnd = () => { el.dataset.panel = 'open' }
      el.addEventListener('animationend', onEnd, { once: true })
    }
    prevClosing.current = closing
  }, [closing])

  return (
    <div
      ref={divRef}
      className="sticky top-0 h-screen w-[384px] shrink-0 border-l border-line bg-canvas overflow-y-auto"
    >
      {children}
    </div>
  )
}

export function TodayShell({
  digest,
  userEmail,
  functions,
  events,
  calendarConnected,
  unreadThreads = [],
  nowFromServer,
}: {
  digest: MockDigestSummary
  userEmail?: string
  functions: UserFunction[]
  events: DayEvent[]
  calendarConnected: boolean
  unreadThreads?: UnreadThread[]
  nowFromServer?: string
}) {
  // `displayedItem` is what the panel renders. It lags behind during close
  // so the panel content doesn't vanish before the slide-out finishes.
  const [displayedItem, setDisplayedItem] = useState<MockItem | null>(null)
  // `panelOpen` drives the open/close animation independently of content.
  const [panelOpen, setPanelOpen] = useState(false)
  // While closing, we hold the panel in the DOM with slide-out animation.
  const [panelClosing, setPanelClosing] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [shellHiddenIds, setShellHiddenIds] = useState<Set<string>>(new Set())
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [calendarCollapsed, setCalendarCollapsed] = useState(false)

  // Buffer unread threads in state so a transient empty server re-render
  // (e.g. immediately after sending an email) never wipes the visible list.
  const [bufferedUnread, setBufferedUnread] = useState<UnreadThread[]>(unreadThreads)
  useEffect(() => {
    if (unreadThreads.length > 0) setBufferedUnread(unreadThreads)
  }, [unreadThreads])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CALENDAR_COLLAPSED_KEY)
      if (saved === '1') setCalendarCollapsed(true)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_COLLAPSED_KEY, calendarCollapsed ? '1' : '0')
    } catch { /* ignore */ }
  }, [calendarCollapsed])

  // Close the detail panel on Esc — matches Radix Dialog convention.
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Skip when the user is editing inline text in the panel
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        closePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  function openPanel(item: MockItem) {
    // Cancel any in-progress close
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setDisplayedItem(item)
    setPanelOpen(true)
    setPanelClosing(false)
  }

  function closePanel() {
    setPanelClosing(true)
    setPanelOpen(false)
    closeTimerRef.current = setTimeout(() => {
      setDisplayedItem(null)
      setPanelClosing(false)
      closeTimerRef.current = null
    }, 200)
  }

  const clearedThreadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of [...digest.open_items, ...digest.completed_today]) {
      if (item.gmail_thread_id) ids.add(item.gmail_thread_id)
    }
    for (const hiddenId of shellHiddenIds) {
      const item = digest.open_items.find(i => i.id === hiddenId)
      if (item?.gmail_thread_id) ids.add(item.gmail_thread_id)
    }
    return ids
  }, [digest, shellHiddenIds])

  const filteredUnread = useMemo(
    () => bufferedUnread.filter(t => !clearedThreadIds.has(t.id)),
    [bufferedUnread, clearedThreadIds]
  )

  const filteredDigest = useMemo(() => shellHiddenIds.size > 0 ? {
    ...digest,
    open_items: digest.open_items.filter(i => !shellHiddenIds.has(i.id)),
  } : digest, [digest, shellHiddenIds])

  const panelVisible = panelOpen || panelClosing

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas">
      <AppSidebar
        userEmail={userEmail}
        userInitial={digest.user_initials.charAt(0)}
      />

      <main className="flex-1 min-w-0 pl-8 pr-0 pt-4 pb-16 overflow-y-auto">
        <TodayView
          digest={filteredDigest}
          userEmail={userEmail}
          functions={functions}
          hideHeader
          hideDetailPanel
          onSelectItem={(item) => { if (item) openPanel(item) }}
          externalSelectedItemId={displayedItem?.id ?? null}
          onAddTask={() => setAddOpen(true)}
          mainExpanded={calendarCollapsed || panelVisible}
          unreadThreads={filteredUnread}
          nowFromServer={nowFromServer}
        />
      </main>

      {/* Right column: detail panel or calendar */}
      {panelVisible ? (
        <PanelColumn closing={panelClosing}>
          {displayedItem && (
            <DetailPanel
              key={displayedItem.id}
              item={displayedItem}
              onClose={closePanel}
              now={nowFromServer ? new Date(nowFromServer) : undefined}
              onComplete={() => {
                if (!displayedItem) return
                const id = displayedItem.id
                setShellHiddenIds(s => new Set(s).add(id))
                closePanel()
                completeItem(id).then(() => router.refresh()).catch(() => {
                  setShellHiddenIds(s => { const n = new Set(s); n.delete(id); return n })
                })
              }}
              onDismiss={() => {
                if (!displayedItem) return
                const id = displayedItem.id
                setShellHiddenIds(s => new Set(s).add(id))
                closePanel()
                dismissItem(id).then(() => router.refresh()).catch(() => {
                  setShellHiddenIds(s => { const n = new Set(s); n.delete(id); return n })
                })
              }}
              allFunctions={functions}
            />
          )}
        </PanelColumn>
      ) : (
        <TodayCalendarColumn
          events={events}
          items={digest.open_items.map(i => ({
            id: i.id,
            title: i.title,
            due_at: i.due_at,
          }))}
          calendarConnected={calendarConnected}
          collapsed={calendarCollapsed}
          onToggleCollapsed={() => setCalendarCollapsed(c => !c)}
        />
      )}

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-md md:max-w-lg"
        >
          <SheetTitle className="sr-only">Add a manual task</SheetTitle>
          <SheetDescription className="sr-only">
            Create a new task with optional due date and function tags.
          </SheetDescription>
          <AddTaskPanel
            allFunctions={functions}
            onClose={() => setAddOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}
