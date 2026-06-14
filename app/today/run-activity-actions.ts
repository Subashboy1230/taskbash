'use server'

// Server action for the Agent Activity panel's history mode. The live
// timeline is fetched via the polled GET /api/runs/[runId]/steps route;
// this just lists recent runs for the history picker.

import { resolveUserId } from '@/lib/supabase-server'
import { loadRecentRuns, type RecentRun } from '@/lib/load-run-steps'

export async function getRecentRunsAction(): Promise<RecentRun[]> {
  try {
    const userId = await resolveUserId()
    return await loadRecentRuns(userId, 20)
  } catch {
    return []
  }
}
