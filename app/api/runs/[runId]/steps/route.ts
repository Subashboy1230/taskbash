// Polled by the Agent Activity panel while a digest run is in flight.
// Returns the run's status + ordered steps as JSON, scoped to the caller.

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/supabase-server'
import { loadRunSteps } from '@/lib/load-run-steps'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    const userId = await resolveUserId()
    const result = await loadRunSteps(runId, userId)
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return NextResponse.json(
      { run: null, steps: [], error: err instanceof Error ? err.message : 'error' },
      { status: 500 }
    )
  }
}
