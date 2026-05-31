'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/_components/ui/tabs'
import OverviewTab from './tabs/overview-tab'
import VoiceTab from './tabs/voice-tab'
import PromptsTab from './tabs/prompts-tab'
import StatsTab from './tabs/stats-tab'
import type { VoiceExamples } from '@/lib/types'
import type { PromptDef } from '@/lib/prompt-registry'

type SlopPoint = { date: string; source: string; slopPct: number }

interface Props {
  displayName: string
  email: string
  memberSince: string
  overview: {
    openCount: number
    clearedToday: number
    draftsReady: number
    connectedSources: string[]
  }
  voiceProfile: {
    voice: string | null
    examples: VoiceExamples | null
    updatedAt: string | null
  }
  prompts: (PromptDef & { slopRate: number | null })[]
  stats: {
    clearedToday: number
    clearedWeek: number
    clearedMonth: number
    slopTimeSeries: SlopPoint[]
    topFunction: { name: string; count: number; pct: number } | null
  }
}

const TABS = ['overview', 'voice', 'prompts', 'stats'] as const
type Tab = (typeof TABS)[number]

const LS_KEY = 'taskbash:profileTab'

export default function ProfileTabs(props: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const fromUrl = searchParams.get('tab') as Tab | null
  const [active, setActive] = useState<Tab>(() => {
    if (fromUrl && TABS.includes(fromUrl)) return fromUrl
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      if (saved && TABS.includes(saved as Tab)) return saved as Tab
    } catch { /* ignore */ }
    return 'overview'
  })

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, active) } catch { /* ignore */ }
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', active)
    router.replace(`/profile?${params.toString()}`, { scroll: false })
  }, [active, router, searchParams])

  return (
    <Tabs value={active} onValueChange={v => setActive(v as Tab)}>
      <TabsList className="mb-6 bg-surface border border-line h-auto p-0.5 gap-0.5">
        <TabsTrigger value="overview" className="text-[13px] px-4 py-1.5 data-[state=active]:bg-surface-muted data-[state=active]:text-ink text-ink-muted">
          Overview
        </TabsTrigger>
        <TabsTrigger value="voice" className="text-[13px] px-4 py-1.5 data-[state=active]:bg-surface-muted data-[state=active]:text-ink text-ink-muted">
          Voice
        </TabsTrigger>
        <TabsTrigger value="prompts" className="text-[13px] px-4 py-1.5 data-[state=active]:bg-surface-muted data-[state=active]:text-ink text-ink-muted">
          Prompts
        </TabsTrigger>
        <TabsTrigger value="stats" className="text-[13px] px-4 py-1.5 data-[state=active]:bg-surface-muted data-[state=active]:text-ink text-ink-muted">
          Stats
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab
          displayName={props.displayName}
          email={props.email}
          memberSince={props.memberSince}
          overview={props.overview}
        />
      </TabsContent>

      <TabsContent value="voice">
        <VoiceTab voiceProfile={props.voiceProfile} />
      </TabsContent>

      <TabsContent value="prompts">
        <PromptsTab prompts={props.prompts} />
      </TabsContent>

      <TabsContent value="stats">
        <StatsTab stats={props.stats} />
      </TabsContent>
    </Tabs>
  )
}
