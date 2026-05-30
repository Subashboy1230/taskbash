'use client'

// Client shell that wraps /today. Holds the right-slot state:
//   - selectedItem → renders DetailPanel
//   - dayFilter   → narrows TodayView's task list
// When neither is set, the right column is the interactive
// TodayCalendarColumn.
//
// Bug we fixed by lifting state: the previous version had TodayView
// render DetailPanel inline AND the page rendered CalendarColumn at the
// same level. Both ended up visible at once, bleeding into each other.
// The shell picks ONE of {DetailPanel, CalendarColumn} based on whether
// an item is selected.

import { useState } from 'react'
import { AppSidebar } from '@/app/_components/app-sidebar'
import { TodayView, DetailPanel } from './today-view'
import { TodayCalendarColumn } from './today-calendar-column'
import type { MockDigestSummary, MockItem } from '@/lib/mock-items'
import type { UserFunction } from '@/lib/types'
import type { DayEvent } from '@/lib/load-day-events'

export function TodayShell({
  digest,
  userEmail,
  functions,
  events,
  calendarConnected,
}: {
  digest: MockDigestSummary
  userEmail?: string
  functions: UserFunction[]
  events: DayEvent[]
  calendarConnected: boolean
}) {
  const [selectedItem, setSelectedItem] = useState<MockItem | null>(null)
  const [dayFilter, setDayFilter] = useState<string | null>(null)

  // Hide-id helper so TodayView's optimistic completion still works:
  // when the user marks an item done from the DetailPanel we close the
  // panel here AND let TodayView drop the row.
  const closeDetailAfter = (id: string) => {
    void id
    setSelectedItem(null)
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar
        userEmail={userEmail}
        userInitial={digest.user_initials.charAt(0)}
      />
      <main className="flex-1 min-w-0 px-8 pt-4 pb-16">
        <TodayView
          digest={digest}
          userEmail={userEmail}
          functions={functions}
          hideHeader
          hideDetailPanel
          onSelectItem={setSelectedItem}
          externalSelectedItemId={selectedItem?.id ?? null}
          dayFilter={dayFilter}
          onClearDayFilter={() => setDayFilter(null)}
        />
      </main>
      {selectedItem ? (
        <DetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onComplete={() => closeDetailAfter(selectedItem.id)}
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
          selectedDay={dayFilter}
          onSelectDay={setDayFilter}
        />
      )}
    </div>
  )
}
