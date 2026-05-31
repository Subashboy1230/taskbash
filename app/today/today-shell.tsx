'use client'

// Client shell that wraps /today.
//
// Layout: sidebar | main task list | calendar column (always visible).
// Task detail opens in a shadcn Sheet that slides over from the right with a
// backdrop. The calendar stays present underneath so the user can see their
// agenda even while reading a task brief.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
import { cn } from '@/lib/utils'
import type { MockDigestSummary, MockItem } from '@/lib/mock-items'
import type { UserFunction } from '@/lib/types'

function PanelColumn({
  item, closing, onClose, onComplete, onDismiss, allFunctions,
}: {
  item: MockItem
  closing: boolean
  onClose: () => void
  onComplete: (id: string) => void
  onDismiss: (id: string) => void
  allFunctions: UserFunction[]
}) {
  return (
    <div className={cn(
      'sticky top-0 h-screen w-[384px] shrink-0 border-l border-line bg-canvas overflow-y-auto',
      closing ? 'animate-slide-out-right' : 'animate-slide-in-right'
    )}>
      <DetailPanel
        item={item}
        onClose={onClose}
        onComplete={() => onComplete(item.id)}
        onDismiss={() => onDismiss(item.id)}
        allFunctions={allFunctions}
      />
    </div>
  )
}
import type { DayEvent } from '@/lib/load-day-events'
import type { UnreadThread } from '@/lib/load-unread-gmail'

const CALENDAR_COLLAPSED_KEY = 'taskbash:calendarCollapsed'

export function TodayShell({
  digest,
  userEmail,
  functions,
  events,
  calendarConnected,
  unreadThreads = [],
}: {
  digest: MockDigestSummary
  userEmail?: string
  functions: UserFunction[]
  events: DayEvent[]
  calendarConnected: boolean
  unreadThreads?: UnreadThread[]
}) {
  const [selectedItem, setSelectedItem] = useState<MockItem | null>(null)
  const lastSelectedItem = useRef<MockItem | null>(null)
  const [panelClosing, setPanelClosing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [shellHiddenIds, setShellHiddenIds] = useState<Set<string>>(new Set())
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Lift calendar collapsed state so the main column can claim the freed
  // width when it's collapsed.
  const [calendarCollapsed, setCalendarCollapsed] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CALENDAR_COLLAPSED_KEY)
      if (saved === '1') setCalendarCollapsed(true)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_COLLAPSED_KEY, calendarCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [calendarCollapsed])

  const closeDetail = () => {
    lastSelectedItem.current = selectedItem
    setPanelClosing(true)
    setTimeout(() => {
      setSelectedItem(null)
      setPanelClosing(false)
      lastSelectedItem.current = null
    }, 180)
  }

  // Thread IDs already tracked as items (open or cleared today) — filtered out of Unread tab.
  const clearedThreadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of [...digest.open_items, ...digest.completed_today]) {
      if (item.gmail_thread_id) ids.add(item.gmail_thread_id)
    }
    // Also include threads we completed this session (optimistic)
    for (const hiddenId of shellHiddenIds) {
      const item = digest.open_items.find(i => i.id === hiddenId)
      if (item?.gmail_thread_id) ids.add(item.gmail_thread_id)
    }
    return ids
  }, [digest, shellHiddenIds])

  const filteredUnread = useMemo(
    () => unreadThreads.filter(t => !clearedThreadIds.has(t.id)),
    [unreadThreads, clearedThreadIds]
  )

  const filteredDigest = useMemo(() => shellHiddenIds.size > 0 ? {
    ...digest,
    open_items: digest.open_items.filter(i => !shellHiddenIds.has(i.id)),
  } : digest, [digest, shellHiddenIds])

  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar
        userEmail={userEmail}
        userInitial={digest.user_initials.charAt(0)}
      />

      {/* Task list — always full width, never resizes */}
      <main className="flex-1 min-w-0 pl-8 pr-0 pt-4 pb-16 overflow-y-auto">
        <TodayView
          digest={filteredDigest}
          userEmail={userEmail}
          functions={functions}
          hideHeader
          hideDetailPanel
          onSelectItem={setSelectedItem}
          externalSelectedItemId={selectedItem?.id ?? null}
          onAddTask={() => setAddOpen(true)}
          mainExpanded={calendarCollapsed || !!selectedItem}
          unreadThreads={filteredUnread}
        />
      </main>

      {/* Right column — detail panel replaces calendar when a task is open */}
      {(selectedItem || panelClosing) ? (
        <PanelColumn
          item={(selectedItem ?? lastSelectedItem.current)!}
          closing={panelClosing}
          onClose={closeDetail}
          onComplete={id => {
            setShellHiddenIds(s => new Set(s).add(id))
            closeDetail()
            completeItem(id).then(() => router.refresh()).catch(() => {
              setShellHiddenIds(s => { const n = new Set(s); n.delete(id); return n })
            })
          }}
          onDismiss={id => {
            setShellHiddenIds(s => new Set(s).add(id))
            closeDetail()
            dismissItem(id).then(() => router.refresh()).catch(() => {
              setShellHiddenIds(s => { const n = new Set(s); n.delete(id); return n })
            })
          }}
          allFunctions={functions}
        />
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

      {/* Add-task panel — still uses Sheet overlay */}
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
