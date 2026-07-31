// Inngest webhook receiver. This is the endpoint Inngest calls to invoke
// your functions. You register the deployed URL in the Inngest dashboard:
//   https://your-domain.com/api/inngest
//
// In local dev, run `npm run inngest` (the Inngest CLI) and it'll auto-detect
// this route at http://localhost:3000/api/inngest.

import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { morningDigest } from '@/inngest/functions/morning-digest'
import { gmailPoll } from '@/inngest/functions/gmail-poll'
import { evalCron } from '@/inngest/functions/eval-cron'
import { draftCleanup } from '@/inngest/functions/draft-cleanup'
import { whatsappMorningDigest } from '@/inngest/functions/whatsapp-morning-digest'
import { whatsappMeetingScheduler } from '@/inngest/functions/whatsapp-meeting-scheduler'
import { whatsappMeetingReminder } from '@/inngest/functions/whatsapp-meeting-reminder'

// Ask Vercel for the max serverless budget on Pro (300s / 5 min). Needed
// because morning-digest runs Gmail + Granola extractors in parallel via
// Promise.all, and each source can spend up to SOURCE_TIMEOUT_MS (240s)
// on LLM extract + judge over its batch. Default Vercel timeout is much
// lower and kills the function mid-source.
export const maxDuration = 300

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    morningDigest,
    gmailPoll,
    evalCron,
    draftCleanup,
    whatsappMorningDigest,
    whatsappMeetingScheduler,
    whatsappMeetingReminder,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
