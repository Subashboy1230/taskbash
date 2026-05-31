'use client'

// Client shell that wraps /today.
//
// Layout: sidebar | main task list | calendar column (always visible).
// Task detail opens in a shadcn Sheet that slides over from the right with a
// backdrop. The calendar stays present underneath so the user can see their
// agenda even while reading a task brief.

import { useEffect, useState } from 'react'
import { AppSidebar } from '@/app/_components/app-sidebar'
import { TodayView, DetailPanel } from './today-view'
import { completeItem } from './actions'
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
  const [addOpen, setAddOpen] = useState(false)

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

  const closeDetail = () => setSelectedItem(null)

  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar
        userEmail={userEmail}
        userInitial={digest.user_initials.charAt(0)}
      />
      <main className="flex-1 min-w-0 pl-8 pr-0 pt-4 pb-16">
        <TodayView
          digest={digest}
          userEmail={userEmail}
          functions={functions}
          hideHeader
          hideDetailPanel
          onSelectItem={setSelectedItem}
          externalSelectedItemId={selectedItem?.id ?? null}
          onAddTask={() => setAddOpen(true)}
          mainExpanded={calendarCollapsed}
          unreadThreads={unreadThreads}
        />
      </main>

      {/* Calendar column is always present so the user can see their agenda.
          Controlled collapse state lives in the shell. */}
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

      {/* Task detail slides over from the right. The Sheet's overlay is
          transparent (see ui/sheet) so the task list stays fully visible.
          SheetTitle + SheetDescription are visually hidden but present for
          screen readers; Radix Dialog requires them. */}
      <Sheet open={!!selectedItem} onOpenChange={open => !open && closeDetail()}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-md md:max-w-lg"
        >
          <SheetTitle className="sr-only">
            {selectedItem?.title ?? 'Task details'}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Details, brief, and actions for the selected task.
          </SheetDescription>
          {selectedItem && (
            <DetailPanel
              item={selectedItem}
              onClose={closeDetail}
              onComplete={() => {
                completeItem(selectedItem.id).catch(() => {})
                closeDetail()
              }}
              allFunctions={functions}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Add-task panel uses the same slide-over pattern. */}
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
