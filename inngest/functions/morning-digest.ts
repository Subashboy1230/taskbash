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
  async ({ step, logger }) => {
    const userId = process.env.APP_USER_ID
    if (!userId) throw new Error('APP_USER_ID is not set')

    // Load the user's email from the DB — never hardcoded.
    const userEmail = await step.run('load-user-email', async () => {
      const { data } = await supabase
        .from('users')
        .select('email')
        .eq('id', userId)
        .maybeSingle()
      if (!data?.email) throw new Error(`No email found for user ${userId}`)
      return data.email as string
    })

    logger.info(`running digest for ${userEmail} (${userId})`)

    const summary = await step.run('run-digest', async () =>
      runDigestForUser({ userId, userEmail })
    )

    logger.info('digest complete', summary)
    return summary
  }
)
