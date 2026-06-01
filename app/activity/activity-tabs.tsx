'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/_components/ui/tabs'
import { AllTab, RunsTab, TasksTab, DataSourcesTab, ApprovalsTab, RecordsTab } from './tabs/tab-content'
import type { ActivityRow, EvalHealth } from './loaders'

const TAB_IDS = ['all', 'runs', 'tasks', 'sources', 'approvals', 'records'] as const
type TabId = typeof TAB_IDS[number]

const TAB_LABELS: Record<TabId, string> = {
  all:       'All Activity',
  runs:      'Agent Runs',
  tasks:     'Tasks',
  sources:   'Data Sources',
  approvals: 'Approvals',
  records:   'Records',
}

export function ActivityTabs({
  all, runs, tasks, sources, approvals, records, evalHealth,
}: {
  all: ActivityRow[]
  runs: ActivityRow[]
  tasks: ActivityRow[]
  sources: ActivityRow[]
  approvals: ActivityRow[]
  records: ActivityRow[]
  evalHealth: EvalHealth
}) {
  const router = useRouter()
  const params = useSearchParams()
  const tabFromUrl = (params.get('tab') ?? '') as TabId

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (TAB_IDS.includes(tabFromUrl)) return tabFromUrl
    try {
      const saved = localStorage.getItem('taskbash:activityTab') as TabId | null
      if (saved && TAB_IDS.includes(saved)) return saved
    } catch { /* ignore */ }
    return 'all'
  })

  useEffect(() => {
    try { localStorage.setItem('taskbash:activityTab', activeTab) } catch { /* ignore */ }
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeTab)
    router.replace(url.pathname + url.search, { scroll: false })
  }, [activeTab, router])

  return (
    <Tabs value={activeTab} onValueChange={v => setActiveTab(v as TabId)}>
      <TabsList className="mb-6 flex w-full gap-0 rounded-none border-b border-line bg-transparent p-0 justify-start">
        {TAB_IDS.map(id => (
          <TabsTrigger
            key={id}
            value={id}
            className="rounded-none border-b-2 border-transparent px-4 py-2 text-[13px] font-medium text-ink-muted data-[state=active]:border-ink data-[state=active]:text-ink"
          >
            {TAB_LABELS[id]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="all">       <AllTab rows={all} /></TabsContent>
      <TabsContent value="runs">      <RunsTab rows={runs} evalHealth={evalHealth} /></TabsContent>
      <TabsContent value="tasks">     <TasksTab rows={tasks} /></TabsContent>
      <TabsContent value="sources">   <DataSourcesTab rows={sources} /></TabsContent>
      <TabsContent value="approvals"> <ApprovalsTab rows={approvals} /></TabsContent>
      <TabsContent value="records">   <RecordsTab rows={records} /></TabsContent>
    </Tabs>
  )
}
