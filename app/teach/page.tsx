// Prototype — Mass auto-teach.
// Pure UI prototype, no DB writes. Mock candidates + suggested rules.

import { TeachView } from './teach-view'
import { getTeachCandidates, getSuggestedRules } from '@/lib/mock-teach'

export const dynamic = 'force-dynamic'

export default function TeachPage() {
  const candidates = getTeachCandidates()
  const rules = getSuggestedRules()
  return <TeachView candidates={candidates} rules={rules} />
}
