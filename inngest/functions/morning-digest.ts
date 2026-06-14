// Morning digest cron + on-demand trigger.
// Delegates all extraction/diff/persist logic to runDigestForUser so
// this file stays thin and the two code paths (cron + Re-run button)
// are always in sync.

import { inngest, EVENTS } from '../client'
import { supabase } from '@/lib/supabase'
import { runDigestForUser } from '@/lib/digest/run'

export const morningDigest = inngest.createFunction(
  { id: 'morning-digest', name: 'Morning digest — run the diff' },
  [
    { cron: 'TZ=America/Los_Angeles 0 7 * * *' }, // 7:00 PT daily
    { event: EVENTS.digestRequested },             // also manual
  ],
  async ({ event, step, logger }) => {
    // Manual trigger passes userId in event.data; cron falls back to APP_USER_ID.
    // If both are missing, look up the single active user from the DB (single-tenant).
    const rawUserId = (event.data as { userId?: string } | undefined)?.userId?.trim()
      || process.env.APP_USER_ID?.trim()

    const { userId, userEmail } = await step.run('load-user', async () => {
      if (rawUserId) {
        const { data } = await supabase
          .from('users')
          .select('id, email')
          .eq('id', rawUserId)
          .maybeSingle()
        if (!data?.email) throw new Error(`No user found for id ${rawUserId}`)
        return { userId: data.id as string, userEmail: data.email as string }
      }
      // Fallback: pick the user that has active connections (single-tenant app)
      const { data: conn } = await supabase
        .from('connections')
        .select('user_id')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (!conn?.user_id) throw new Error('No active connections found and APP_USER_ID is not set')
      const { data: user } = await supabase
        .from('users')
        .select('id, email')
        .eq('id', conn.user_id)
        .maybeSingle()
      if (!user?.email) throw new Error(`No user found for connection owner ${conn.user_id}`)
      return { userId: user.id as string, userEmail: user.email as string }
    })

    // Manual Re-run pre-creates a runs row and passes its id so the client
    // can watch this exact run live; cron has no runId and creates its own.
    const runId = (event.data as { runId?: string } | undefined)?.runId?.trim() || undefined
    const isManual = !!(event.data as { userId?: string } | undefined)?.userId

    logger.info(`running digest for ${userEmail} (${userId})`)

    const summary = await step.run('run-digest', async () =>
      runDigestForUser({ userId, userEmail, trigger: isManual ? 'manual' : 'cron', runId })
    )

    logger.info('digest complete', summary)
    return summary
  }
)
