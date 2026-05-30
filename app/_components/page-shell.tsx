'use client'

// Reusable 3-column layout: sidebar + main content + calendar column.
// Use on every page so the navigation chrome (sidebar) and the
// right-rail calendar are consistent across the app.
//
// Server pages stay server-rendered — they pass their content as
// `children`, and only the calendar selection state lives in this
// client wrapper.

import { useState } from 'react'
import { AppSidebar } from './app-sidebar'
import { TodayCalendarColumn } from '@/app/today/today-calendar-column'
import type { DayEvent } from '@/lib/load-day-events'

export function PageShell({
  userEmail,
  userInitial,
  events,
  calendarConnected,
  children,
}: {
  userEmail?: string
  userInitial?: string
  events: DayEvent[]
  calendarConnected: boolean
  children: React.ReactNode
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar userEmail={userEmail} userInitial={userInitial} />
      <main className="flex-1 min-w-0 px-8 pt-4 pb-16">{children}</main>
      <TodayCalendarColumn
        events={events}
        items={[]}
        calendarConnected={calendarConnected}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />
    </div>
  )
}
