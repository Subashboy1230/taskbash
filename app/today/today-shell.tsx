'use client'

// Client shell that wraps /today.
//
// Layout: sidebar | main task list | calendar column (always visible).
// Task detail opens in a shadcn Sheet that slides over from the right with a
// backdrop. The calendar stays present underneath so the user can see their
// agenda even while reading a task brief.

import { useState } from 'react'
import { AppSidebar } from '@/app/_components/app-sidebar'
import { TodayView, DetailPanel } from './today-view'
import { TodayCalendarColumn } from './today-calendar-column'
import { Sheet, SheetContent } from '@/app/_components/ui/sheet'
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

  const closeDetail = () => setSelectedItem(null)

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

      {/* Calendar column is always present so the user can see their agenda. */}
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

      {/* Task detail slides over from the right with a backdrop. Escape or
          backdrop-click closes the sheet. */}
      <Sheet open={!!selectedItem} onOpenChange={open => !open && closeDetail()}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-md md:max-w-lg"
        >
          {selectedItem && (
            <DetailPanel
              item={selectedItem}
              onClose={closeDetail}
              onComplete={closeDetail}
              allFunctions={functions}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
